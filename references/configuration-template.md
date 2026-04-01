# Configuration Template

## User-facing configuration language

Use these user-facing labels in setup guidance:
- 厂商
- 接口地址
- 模型名
- API Key

Do not ask normal users to understand internal `provider` terminology.

## Recommended configuration shape

```yaml
upstream:
  seedance:
    厂商: ""      # 独立配置：可与 downstream.video / downstream.tts 使用不同厂商
    接口地址: ""  # 独立配置
    模型名: ""    # 独立配置：可与视频模型、TTS 模型不同
    APIKey: ""   # 必填：正式 Seedance 剧本层不可留空、不可 demo、不可 placeholder

downstream:
  waoo:
    image:
      厂商: ""
      接口地址: ""
      模型名: ""
      APIKey: ""

    # Optional image-provider map for text-only first-image fallback
    images:
      seedance:
        厂商: "Seedance"
        接口地址: "https://ark.cn-beijing.volces.com"
        模型名: "seedance-image-1"
        APIKey: ""
      minimax:
        厂商: "MiniMax"
        接口地址: "https://api.minimaxi.com/v1"
        模型名: "image-01"
        APIKey: ""

    video:
      厂商: ""
      接口地址: ""
      模型名: ""
      APIKey: ""

    # Optional multi-provider map for capability-based routing
    videos:
      seedance:
        厂商: "Seedance"
        接口地址: "https://ark.cn-beijing.volces.com"
        模型名: "doubao-seedance-1-5-pro-251215"
        APIKey: ""
      vidu:
        厂商: "Vidu"
        接口地址: "https://toapis.com"
        模型名: "viduq3-pro"
        APIKey: ""
      minimax:
        厂商: "MiniMax"
        接口地址: "https://api.minimaxi.com/v1"
        模型名: "T2V-01-Director"
        APIKey: ""

    tts:
      厂商: ""
      接口地址: ""
      模型名: ""
      APIKey: ""

    ambience:
      优先本地环境音素材: true
      厂商: ""
      接口地址: ""
      模型名: ""
      APIKey: ""

runtime:
  pipelineMode: "minimax_full"  # minimax_full | vidu_simple | seedance_simple
  routing:
    videoPriorityImageText: ["seedance", "vidu", "minimax"]
    videoPriorityTextOnly: ["seedance", "vidu", "minimax"]
    imagePriorityTextOnly: ["seedance", "minimax"]
    defaultVideoVendor: ""
    defaultImageVendor: ""
  时长秒数: 6
  分辨率: "768P"
  每日Fast视频额度: 2
  单条主视频优先: true
  ffmpeg: ""   # 可选：优先 PATH；必要时填显式路径
  ffprobe: ""  # 可选：优先 PATH；必要时填显式路径
```

## Vidu simple mode template

When users want direct video flow and minimal setup, use:

```yaml
runtime:
  pipelineMode: "vidu_simple"

downstream:
  waoo:
    video:
      厂商: "Vidu"
      接口地址: "https://toapis.com"
      模型名: "viduq3-pro"
      APIKey: "<VIDU_KEY>"
```

In this mode, upstream/image/tts can be added later as optional capabilities.

## Seedance simple mode template

When users want direct video flow with Seedance body-style controls, use:

```yaml
runtime:
  pipelineMode: "seedance_simple"

downstream:
  waoo:
    video:
      厂商: "Seedance"
      接口地址: "https://ark.cn-beijing.volces.com"
      模型名: "doubao-seedance-1-5-pro-251215"
      APIKey: "<SEEDANCE_KEY>"
```

Note: current `vidu_simple/seedance_simple` flow supports `Vidu` / `MiniMax` / `Seedance` direct video adapters out of the box.

## Portability rules

- Do not hardcode one machine's absolute paths into shared configs.
- Resolution should prefer, in order:
  1. explicit command flags like `--ffmpeg` / `--ffprobe`
  2. shared config values `runtime.ffmpeg` / `runtime.ffprobe`
  3. environment variables `FFMPEG_PATH` / `FFPROBE_PATH`
  4. binaries available from PATH
- Sample values should stay obviously generic, not look like a real local machine.

## Internal mapping idea

The runtime may internally map:
- 厂商 -> provider
- 接口地址 -> baseUrl
- 模型名 -> model
- APIKey -> apiKey

But this translation should remain internal.
