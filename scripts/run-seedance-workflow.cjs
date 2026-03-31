const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      result[key] = true;
      continue;
    }
    result[key] = next;
    i += 1;
  }
  return result;
}

function ensureDirForFile(filePath) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function writeJson(outputPath, data) {
  const text = JSON.stringify(data, null, 2);
  if (outputPath) {
    ensureDirForFile(outputPath);
    fs.writeFileSync(path.resolve(outputPath), text + '\n', 'utf8');
  }
  console.log(text);
}

function runNodeScript(scriptPath, scriptArgs, cwd) {
  return spawnSync(process.execPath, [scriptPath, ...scriptArgs], {
    stdio: 'pipe',
    encoding: 'utf8',
    cwd,
  });
}

function isPlaceholder(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return true;
  return text.includes('your-') || text.includes('placeholder') || text === 'demo';
}

function getPipelineMode(config) {
  const mode = String(config?.runtime?.pipelineMode || 'minimax_full').trim().toLowerCase();
  return mode || 'minimax_full';
}

function canonicalVendor(name) {
  const value = String(name || '').trim().toLowerCase();
  if (!value) return '';
  if (value.includes('minimax') || value.includes('mini max')) return 'minimax';
  if (value.includes('vidu')) return 'vidu';
  if (value.includes('seedance') || value.includes('doubao') || value.includes('ark') || value.includes('volc')) return 'seedance';
  return value;
}

function checkConfigReadiness(configPath) {
  if (!fs.existsSync(configPath)) {
    return {
      ready: false,
      mode: 'minimax_full',
      missing: [{ item: 'config', reason: `配置文件不存在: ${configPath}` }],
      guidance: ['先创建配置文件，再继续流程。'],
    };
  }

  const config = readJson(configPath);
  const mode = getPipelineMode(config);
  const missing = [];

  function checkBlock(label, block, requiredKeys = ['厂商', '接口地址', '模型名', 'APIKey']) {
    if (!block) {
      missing.push({ item: label, reason: '配置块缺失' });
      return;
    }
    for (const key of requiredKeys) {
      const value = block[key];
      if (!value || (key === 'APIKey' && isPlaceholder(value))) {
        missing.push({ item: `${label}.${key}`, reason: key === 'APIKey' ? '未填写或仍是占位符' : '缺失' });
      }
    }
  }

  if (['vidu_simple', 'seedance_simple'].includes(mode)) {
    checkBlock('downstream.waoo.video', config?.downstream?.waoo?.video);
    const vendor = canonicalVendor(config?.downstream?.waoo?.video?.厂商);
    if (vendor && !['vidu', 'minimax', 'seedance'].includes(vendor)) {
      missing.push({ item: 'downstream.waoo.video.厂商', reason: `simple 模式当前仅支持 minimax/vidu/seedance，收到: ${config?.downstream?.waoo?.video?.厂商}` });
    }
  } else {
    checkBlock('upstream.seedance', config?.upstream?.seedance);
    checkBlock('downstream.waoo.image', config?.downstream?.waoo?.image);
    checkBlock('downstream.waoo.video', config?.downstream?.waoo?.video);
    checkBlock('downstream.waoo.tts', config?.downstream?.waoo?.tts);
  }

  const guidance = ['vidu_simple', 'seedance_simple'].includes(mode)
    ? [
      `当前是 ${mode} 模式：只要求先配视频模型四要素（厂商/接口地址/模型名/APIKey）。`,
      '如需语音再额外补 downstream.waoo.tts。',
    ]
    : [
      '当前是 minimax_full 模式：需先配 upstream.seedance + downstream.waoo(image/video/tts)。',
      '全部补齐后再进入正式流水线。',
    ];

  return {
    ready: missing.length === 0,
    mode,
    missing,
    guidance,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const action = args.action || 'start';
  const configPath = args.config || './config/pipeline.config.json';
  const workdir = process.cwd();
  const resultJson = args['result-json'];

  if (action === 'start') {
    const topic = args.topic;
    const episode = args.episode || 'E01';
    const outDir = args['out-dir'] || `./work/seedance/${episode}`;
    const revisionNote = String(args['revision-note'] || '').trim();

    const readiness = checkConfigReadiness(configPath);
    if (!readiness.ready) {
      writeJson(resultJson || path.resolve(outDir, 'workflow.config-guidance.json'), {
        ok: false,
        currentStage: 'configuration-guidance',
        workflow: { action: 'start', driver: 'run-seedance-workflow.cjs', blocked: true },
        pipelineMode: readiness.mode,
        missing: readiness.missing,
        guidance: readiness.guidance,
      });
      return;
    }

    if (!topic) throw new Error('start 模式需要 --topic');

    if (['vidu_simple', 'seedance_simple'].includes(readiness.mode)) {
      const resolvedOutDir = path.resolve(outDir);
      fs.mkdirSync(resolvedOutDir, { recursive: true });
      const panelContextPath = path.resolve(resolvedOutDir, 'panel-context.approved.json');
      const config = readJson(configPath);

      const panelContext = {
        panelId: `${episode}-p1`,
        panelIndex: 1,
        title: `Episode ${episode} - Direct Video Run`,
        imageUrl: '',
        videoPrompt: String(topic),
        subtitleText: String(topic),
        isMainClip: true,
      };
      writeJson(panelContextPath, panelContext);

      const duration = String(args.duration || config?.runtime?.时长秒数 || '6');
      const resolution = String(args.resolution || config?.runtime?.分辨率 || '720P');
      const wait = String(args.wait || 'false').toLowerCase() === 'true';
      const download = String(args.download || 'false').toLowerCase() === 'true';
      const chainResultPath = path.resolve(resolvedOutDir, wait ? 'video-submit-chain.poll.result.json' : 'video-submit-chain.result.json');

      const chainArgs = [
        '--config', configPath,
        '--panel', panelContextPath,
        '--out-dir', resolvedOutDir,
        '--duration', duration,
        '--resolution', resolution,
        '--wait', wait ? 'true' : 'false',
        '--download', download ? 'true' : 'false',
        '--result-json', chainResultPath,
      ];
      if (String(args.probe || '').toLowerCase() === 'true') {
        chainArgs.push('--probe');
      }

      const chainChild = runNodeScript(
        path.resolve(__dirname, 'run-video-submit-chain.cjs'),
        chainArgs,
        workdir,
      );

      if (chainChild.status !== 0) {
        console.error(chainChild.stderr || chainChild.stdout || 'simple video start failed');
        process.exit(chainChild.status || 1);
      }

      const chain = readJson(chainResultPath);
      const outputPath = resultJson || path.resolve(outDir, 'workflow.result.json');
      const result = {
        ok: true,
        currentStage: chain.currentStage || 'video-task-submitted',
        pipelineMode: readiness.mode,
        topic,
        episode,
        panelContext,
        submitResult: chain.submitResult || null,
        taskId: chain.taskId || '',
        latestPoll: chain.latestPoll || null,
        downloadResult: chain.downloadResult || null,
        artifacts: {
          panelContextPath,
          chainResultPath,
          outDir: resolvedOutDir,
        },
        workflow: {
          action: 'start',
          driver: 'run-seedance-workflow.cjs',
          mode: readiness.mode,
        },
        nextStep: chain.nextStep || '可继续轮询并下载视频。',
      };
      writeJson(outputPath, result);
      return;
    }

    const child = runNodeScript(
      path.resolve(__dirname, 'run-seedance-entry.cjs'),
      [
        '--config', configPath,
        '--topic', topic,
        '--episode', episode,
        '--out-dir', outDir,
        '--result-json', resultJson || path.resolve(outDir, 'workflow.result.json'),
        ...(revisionNote ? ['--revision-note', revisionNote] : []),
      ],
      workdir,
    );

    if (child.status !== 0) {
      console.error(child.stderr || child.stdout || 'workflow start failed');
      process.exit(child.status || 1);
    }

    const outputPath = resultJson || path.resolve(outDir, 'workflow.result.json');
    const data = readJson(outputPath);
    data.workflow = { action: 'start', driver: 'run-seedance-workflow.cjs' };
    writeJson(resultJson || outputPath, data);
    return;
  }

  if (action === 'continue') {
    const statePath = args.state || args['entry-result'];
    const approval = args.approval || '';
    const panelIndex = args['panel-index'] || '1';
    const revisionNote = String(args['revision-note'] || '').trim();
    if (!statePath) throw new Error('continue 模式需要 --state 或 --entry-result');
    const state = readJson(statePath);

    if (state.currentStage === 'seedance-four-pack-confirm') {
      if (approval === 'revise-four-pack') {
        if (!revisionNote) {
          throw new Error('revise-four-pack 需要同时提供 --revision-note');
        }
        const topic = String(state?.confirmationBundle?.topic || state?.packResult?.topic || '').trim();
        const episode = String(state?.confirmationBundle?.episode || state?.packResult?.episode || 'E01').trim();
        const outDir = path.dirname(path.resolve(statePath));
        if (!topic) {
          throw new Error('无法从当前 state 提取 topic，不能执行 revise-four-pack');
        }

        const child = runNodeScript(
          path.resolve(__dirname, 'run-seedance-entry.cjs'),
          [
            '--config', configPath,
            '--topic', topic,
            '--episode', episode || 'E01',
            '--out-dir', outDir,
            '--result-json', resultJson || statePath,
            '--revision-note', revisionNote,
          ],
          workdir,
        );
        if (child.status !== 0) {
          console.error(child.stderr || child.stdout || 'workflow revise failed');
          process.exit(child.status || 1);
        }
        const outputPath = resultJson || statePath;
        const data = readJson(outputPath);
        data.workflow = { action: 'continue', driver: 'run-seedance-workflow.cjs', approval: 'revise-four-pack', revisionApplied: true };
        writeJson(resultJson || outputPath, data);
        return;
      }

      if (approval !== 'four-pack-approved') {
        throw new Error('当前阶段需要 --approval four-pack-approved 或 --approval revise-four-pack');
      }
      const child = runNodeScript(
        path.resolve(__dirname, 'continue-seedance-flow.cjs'),
        [
          '--config', configPath,
          '--entry-result', statePath,
          '--confirmed', 'true',
          '--panel-index', String(panelIndex),
          '--result-json', resultJson || path.resolve(path.dirname(statePath), 'workflow.continue.result.json'),
          ...(revisionNote ? ['--revision-note', revisionNote] : []),
        ],
        workdir,
      );
      if (child.status !== 0) {
        console.error(child.stderr || child.stdout || 'workflow continue failed');
        process.exit(child.status || 1);
      }
      const outputPath = resultJson || path.resolve(path.dirname(statePath), 'workflow.continue.result.json');
      const data = readJson(outputPath);
      data.workflow = { action: 'continue', driver: 'run-seedance-workflow.cjs', approval: 'four-pack-approved' };
      writeJson(resultJson || outputPath, data);
      return;
    }

    if (
      state.currentStage === 'first-image-confirm'
      || state.currentStage === 'first-image-internal-generated'
      || state.currentStage === 'first-image-asset-confirm'
    ) {
      if (approval === 'revise-first-image') {
        if (!revisionNote) {
          throw new Error('revise-first-image 需要同时提供 --revision-note');
        }
        const baseDir = path.dirname(path.resolve(statePath));
        const entryResultPath = path.resolve(baseDir, 'workflow.result.json');
        if (!fs.existsSync(entryResultPath)) {
          throw new Error(`重生首图时缺少 workflow.result.json: ${entryResultPath}`);
        }
        const revisedPanelIndex = String(state?.firstImageBundle?.panelIndex || panelIndex || '1');

        const child = runNodeScript(
          path.resolve(__dirname, 'continue-seedance-flow.cjs'),
          [
            '--config', configPath,
            '--entry-result', entryResultPath,
            '--confirmed', 'true',
            '--panel-index', revisedPanelIndex,
            '--result-json', resultJson || statePath,
            '--revision-note', revisionNote,
          ],
          workdir,
        );
        if (child.status !== 0) {
          console.error(child.stderr || child.stdout || 'workflow revise first-image failed');
          process.exit(child.status || 1);
        }
        const outputPath = resultJson || statePath;
        const data = readJson(outputPath);
        data.workflow = { action: 'continue', driver: 'run-seedance-workflow.cjs', approval: 'revise-first-image', revisionApplied: true };
        writeJson(resultJson || outputPath, data);
        return;
      }

      if (approval !== 'first-image-approved') {
        throw new Error('当前阶段需要 --approval first-image-approved 或 --approval revise-first-image');
      }
      const child = runNodeScript(
        path.resolve(__dirname, 'continue-after-first-image.cjs'),
        ['--config', configPath, '--state', statePath, '--confirmed', 'true', '--result-json', resultJson || path.resolve(path.dirname(statePath), 'workflow.after-first-image.result.json')],
        workdir,
      );
      if (child.status !== 0) {
        console.error(child.stderr || child.stdout || 'workflow continue failed');
        process.exit(child.status || 1);
      }
      const outputPath = resultJson || path.resolve(path.dirname(statePath), 'workflow.after-first-image.result.json');
      const data = readJson(outputPath);
      data.workflow = { action: 'continue', driver: 'run-seedance-workflow.cjs', approval: 'first-image-approved' };
      writeJson(resultJson || outputPath, data);
      return;
    }

    if (state.currentStage === 'first-image-asset-blocked') {
      if (approval !== 'retry-first-image') {
        throw new Error('当前阶段需要 --approval retry-first-image');
      }
      const panelIndex = String(state?.firstImageBundle?.panelIndex || args['panel-index'] || '1');
      const baseDir = path.dirname(path.resolve(statePath));
      const entryResultPath = path.resolve(baseDir, 'workflow.result.json');
      if (!fs.existsSync(entryResultPath)) {
        throw new Error(`重试首图时缺少 workflow.result.json: ${entryResultPath}`);
      }

      const child = runNodeScript(
        path.resolve(__dirname, 'continue-seedance-flow.cjs'),
        [
          '--config', configPath,
          '--entry-result', entryResultPath,
          '--confirmed', 'true',
          '--panel-index', panelIndex,
          '--result-json', resultJson || path.resolve(baseDir, 'workflow.continue.retry-first-image.result.json'),
          ...(revisionNote ? ['--revision-note', revisionNote] : []),
        ],
        workdir,
      );
      if (child.status !== 0) {
        console.error(child.stderr || child.stdout || 'workflow continue failed');
        process.exit(child.status || 1);
      }
      const outputPath = resultJson || path.resolve(baseDir, 'workflow.continue.retry-first-image.result.json');
      const data = readJson(outputPath);
      data.workflow = { action: 'continue', driver: 'run-seedance-workflow.cjs', approval: 'retry-first-image' };
      writeJson(resultJson || outputPath, data);
      return;
    }

    throw new Error(`当前 workflow driver 暂不支持从阶段继续: ${state.currentStage || 'unknown'}`);
  }

  throw new Error(`未知 action: ${action}`);
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
