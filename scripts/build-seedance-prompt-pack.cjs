const fs = require('node:fs');
const path = require('node:path');

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

function parseBool(value, fallback = false) {
  if (value === undefined) return fallback;
  if (value === true) return true;
  const text = String(value || '').trim().toLowerCase();
  if (!text) return fallback;
  return ['1', 'true', 'yes', 'y', 'on'].includes(text);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function toInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function normalizeMode(mode, hasReferenceImage) {
  const value = String(mode || '').trim().toLowerCase();
  if (['text-only', 'first-last-frame', 'all-reference'].includes(value)) {
    return value;
  }
  return hasReferenceImage ? 'first-last-frame' : 'text-only';
}

function buildAssets(hasReferenceImage, mode) {
  return {
    referenceImage: {
      required: mode !== 'text-only',
      provided: Boolean(hasReferenceImage),
      notes: mode === 'text-only' ? '当前模式不依赖首图' : '用于锁定角色风格和构图连续性',
    },
    script: {
      required: true,
      notes: '使用四件套中的剧本摘要与分镜语义做生成约束',
    },
  };
}

function buildBeats(duration) {
  const sec = clamp(toInt(duration, 10), 4, 20);
  const step = sec <= 8 ? 2 : 3;
  const beats = [];
  let t = 0;
  let idx = 1;
  while (t < sec) {
    const end = Math.min(sec, t + step);
    beats.push({
      id: `B${idx}`,
      start: t,
      end,
      shot: idx === 1
        ? '建立镜头：交代场景与主体'
        : idx === 2
          ? '推进镜头：突出冲突与动作'
          : idx === 3
            ? '转折镜头：强化情绪与节奏'
            : idx === 4
              ? '高潮镜头：动作或对抗爆发'
              : '收束镜头：落点与余韵',
    });
    idx += 1;
    t = end;
  }
  return beats;
}

function buildPrompt({ topic, mode, duration, style, camera, beats }) {
  const beatLines = beats
    .map((b) => `- ${String(b.start).padStart(2, '0')}-${String(b.end).padStart(2, '0')}s: ${b.shot}`)
    .join('\n');

  return [
    '[目标]',
    `围绕主题“${topic}”生成 ${duration}s 的短视频，保持叙事清晰、镜头连贯。`,
    '',
    '[模式]',
    `使用模式：${mode}（text-only / first-last-frame / all-reference）。`,
    '',
    '[镜头与动作]',
    `主镜头语言：${camera}`,
    `视觉风格：${style}`,
    '',
    '[时间节拍（Timecoded Beats）]',
    beatLines,
    '',
    '[负面约束]',
    '- 避免画面闪烁、人物面部崩坏、文字水印、镜头跳变。',
    '- 避免与指定主题无关的元素和违和转场。',
    '',
    '[输出要求]',
    '- 画面主体清晰，动作可读，镜头过渡自然。',
    '- 成片可直接进入字幕/配音后处理。',
  ].join('\n');
}

function writeJson(outputPath, data) {
  const text = JSON.stringify(data, null, 2);
  if (outputPath) {
    const full = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, `${text}\n`, 'utf8');
  }
  console.log(text);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const topic = String(args.topic || '').trim();
  if (!topic) throw new Error('build-seedance-prompt-pack 需要 --topic');

  const duration = clamp(toInt(args.duration, 10), 4, 20);
  const hasReferenceImage = parseBool(args['has-reference-image'], false);
  const mode = normalizeMode(args.mode, hasReferenceImage);
  const style = String(args.style || '电影感写实，细节清晰，色彩统一').trim();
  const camera = String(args.camera || '中近景推进 + 关键动作特写 + 收束全景').trim();

  const beats = buildBeats(duration);
  const assets = buildAssets(hasReferenceImage, mode);
  const prompt = buildPrompt({ topic, mode, duration, style, camera, beats });

  const data = {
    ok: true,
    version: 'prompt-pack.v1',
    topic,
    duration,
    mode,
    style,
    camera,
    assets,
    beats,
    prompt,
    notes: [
      '该输出用于 run-seedance-workflow 前置提示词工程层。',
      '后续可按场景模板（电商/剧情/MV）扩展 shot 与 beat 规则。',
    ],
  };

  writeJson(args['result-json'], data);
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
