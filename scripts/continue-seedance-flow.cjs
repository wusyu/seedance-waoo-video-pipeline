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

function readConfig(configPath) {
  const full = path.resolve(configPath);
  if (!fs.existsSync(full)) throw new Error(`配置文件不存在: ${full}`);
  const raw = fs.readFileSync(full, 'utf8').trim();
  if (!raw) throw new Error(`配置文件为空: ${full}`);
  return { full, config: JSON.parse(raw) };
}

function looksPlaceholder(value) {
  const text = String(value || '').trim().toLowerCase();
  return !text || text === 'demo' || text.includes('placeholder') || text === 'your_api_key';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = args.config;
  const entryResultPath = args['entry-result'];
  const confirmed = String(args.confirmed || '').toLowerCase();
  const resultJson = args['result-json'];
  const panelIndex = Number(args['panel-index'] || '1');
  const revisionNote = String(args['revision-note'] || '').trim();

  if (!configPath || !entryResultPath) {
    throw new Error('用法: node continue-seedance-flow.cjs --config <json> --entry-result <json> --confirmed true [--panel-index 1] [--result-json <json>]');
  }
  if (confirmed !== 'true' && confirmed !== 'yes' && confirmed !== '1') {
    throw new Error('继续后续流程前，必须显式传入 --confirmed true');
  }

  const entry = readJson(entryResultPath);
  if (!entry?.confirmationRequired || !entry?.confirmationBundle) {
    throw new Error('当前入口结果不在四件套确认阶段，无法继续');
  }

  const outDir = path.resolve(path.dirname(entryResultPath), 'next');
  const firstImageResultPath = path.resolve(outDir, `P${String(panelIndex).padStart(2, '0')}.first-image.result.json`);
  ensureDirForFile(firstImageResultPath);

  const child = spawnSync(
    process.execPath,
    [
      path.resolve(__dirname, 'generate-first-image-pack.cjs'),
      '--config', configPath,
      '--entry-result', entryResultPath,
      '--panel-index', String(panelIndex),
      '--out-dir', outDir,
      '--result-json', firstImageResultPath,
      ...(revisionNote ? ['--revision-note', revisionNote] : []),
    ],
    { stdio: 'pipe', encoding: 'utf8', cwd: process.cwd() },
  );

  if (child.status !== 0) {
    const failure = {
      ok: false,
      stage: 'first-image-pack',
      status: 'stop',
      summary: '四件套确认后，首图确认包生成失败。',
      reasons: [child.stderr || child.stdout || '未知错误'],
      nextStep: '先修正首图确认包生成错误，再继续后续流程。',
    };
    writeJson(resultJson, failure);
    process.exit(child.status || 1);
  }

  const firstImage = readJson(firstImageResultPath);
  const { config } = readConfig(configPath);
  const imageStage = config?.downstream?.waoo?.image;
  const imageConfigReady = Boolean(imageStage?.厂商 && imageStage?.接口地址 && imageStage?.模型名 && !looksPlaceholder(imageStage?.APIKey));
  const firstImageAssetResultPath = path.resolve(outDir, `P${String(panelIndex).padStart(2, '0')}.first-image.asset.result.json`);

  if (!imageConfigReady) {
    const output = {
      ok: true,
      currentStage: 'first-image-asset-blocked',
      confirmationRequired: false,
      firstImageBundle: firstImage,
      checkpoint: {
        stage: 'first-image-approved',
        status: 'stop',
        summary: '首图内部规格已生成，但真实首图图片生成仍缺少可用的 downstream.waoo.image 配置。',
        reasons: ['缺少真实可用的 downstream.waoo.image 厂商 / 接口地址 / 模型名 / API Key'],
        nextStep: '补齐首图图片生成配置后，继续由 skill 内部生成真实首图图片，再把图片发给用户确认。',
      },
      nextStep: '先补齐 downstream.waoo.image 配置。',
    };
    writeJson(resultJson, output);
    return;
  }

  const assetChild = spawnSync(
    process.execPath,
    [
      path.resolve(__dirname, 'generate-first-image-asset.cjs'),
      '--config', configPath,
      '--first-image-result', firstImageResultPath,
      '--out-dir', outDir,
      '--result-json', firstImageAssetResultPath,
    ],
    { stdio: 'pipe', encoding: 'utf8', cwd: process.cwd() },
  );

  if (assetChild.status !== 0) {
    const output = {
      ok: false,
      currentStage: 'first-image-asset-blocked',
      confirmationRequired: false,
      firstImageBundle: firstImage,
      checkpoint: {
        stage: 'first-image-approved',
        status: 'stop',
        summary: '首图内部规格已生成，但真实首图图片生成失败。',
        reasons: [assetChild.stderr || assetChild.stdout || '未知错误'],
        nextStep: '先修正首图图片生成错误，再由 skill 内部继续。',
      },
    };
    writeJson(resultJson, output);
    process.exit(assetChild.status || 1);
  }

  const firstImageAsset = readJson(firstImageAssetResultPath);
  const output = {
    ok: true,
    currentStage: 'first-image-asset-confirm',
    confirmationRequired: true,
    firstImageBundle: firstImage,
    firstImageAsset,
    userMessage: firstImageAsset.caption,
    nextStep: '把真实首图图片发给用户确认；用户确认前不要进入视频生成。',
  };
  writeJson(resultJson, output);
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
