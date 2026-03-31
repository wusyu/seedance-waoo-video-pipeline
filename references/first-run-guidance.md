# First Run Guidance

## Goal

If the user is running the pipeline for the first time, guide them through minimum configuration **and local media-tool prerequisites** before any production attempt.

## Ask in this order

### Step 0: Auto-detect pipeline mode
Read `runtime.pipelineMode` first:
- `minimax_full`: full upstream+downstream pipeline
- `vidu_simple`: lightweight direct video pipeline (Vidu/MiniMax)
- `seedance_simple`: lightweight direct video pipeline (Seedance)

If missing, default to `minimax_full`.

### Step 1: Local media tools
First confirm whether the runtime can access:
- `ffmpeg`
- `ffprobe`

Resolution order should be portable:
1. explicit command arguments like `--ffmpeg` / `--ffprobe`
2. shared config values such as `runtime.ffmpeg` / `runtime.ffprobe`
3. environment variables such as `FFMPEG_PATH` / `FFPROBE_PATH`
4. binaries available from PATH

Do not rely on one machine’s fixed absolute path.

Without these tools, local mixing / final packaging should not be claimed as runnable.

### Step 2: Mode-specific model config

For `minimax_full` ask for:
- upstream Seedance: 厂商 / 接口地址 / 模型名 / API Key
- downstream image: 厂商 / 接口地址 / 模型名 / API Key
- downstream video: 厂商 / 接口地址 / 模型名 / API Key
- downstream TTS: 厂商 / 接口地址 / 模型名 / API Key

For `vidu_simple` ask only for:
- downstream video: 厂商 / 接口地址 / 模型名 / API Key

For `seedance_simple` ask only for:
- downstream video: 厂商 / 接口地址 / 模型名 / API Key

Then ask TTS only if user wants spoken voice in final output.

Adapter note:
- `vidu_simple` has built-in direct-video adapters for `minimax` / `vidu` / `seedance`
- if vendor is anything else, return clear unsupported-vendor guidance

### Step 2.5: Seedance strict-script profile (recommended)

When user asks “按剧本锁定” or fidelity is more important than speed, switch to Seedance full-doc-style request body:

- use `content` with:
  - one `text` block (strict panel prompt + subtitle semantics)
  - one `image_url` block with `role=first_frame` (anchor character/scene continuity)
- set explicit fields:
  - `duration` (panel-level clip length)
  - `resolution`
  - `generate_audio=true`
  - `camera_fixed=true`
  - `draft=false`
  - stable `seed`
  - `return_last_frame=true` for continuity chaining

Hard guard:
- do **not** mix `first_frame/last_frame` with `reference_image` in one request body (provider will reject with `InvalidParameter`).

Practical policy:
- script-fidelity run: prefer panelized `5s + 5s` and then merge
- quick preview run: text-only video is allowed but must be labeled as low-fidelity preview

### Step 3: Ambience policy
Ask whether to:
- 优先本地环境音素材
- or use AI ambience

If AI ambience is used, ask for:
- 厂商
- 接口地址
- 模型名
- API Key

## Guidance style

- keep the questionnaire short
- avoid technical jargon like `provider`
- explain missing pieces plainly
- do not dump all possible fields at once unless the user asks for a full template

## Minimum run-ready config

For `minimax_full`:
- upstream Seedance config
- downstream image/video/TTS config
- locally available `ffmpeg` and `ffprobe` for mix/export stages

For `vidu_simple` / `seedance_simple`:
- downstream video config
- (optional) downstream TTS when narration is required
- locally available `ffmpeg` and `ffprobe` for mix/export stages

Ambience can remain optional depending on workflow stage.
