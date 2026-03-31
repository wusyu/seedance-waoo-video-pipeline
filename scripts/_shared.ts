import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { loadConfig, type PipelineUserConfig, type RuntimeConfig, type StageConfig, type AmbienceConfig } from './load-config'

export type ArgMap = Record<string, string | boolean>

export type MediaProbeStream = {
  index: number
  codecType: string
  codecName: string
  durationSeconds?: number
  bitRate?: number
  width?: number
  height?: number
  sampleRate?: number
  channels?: number
}

export type MediaProbeSummary = {
  file: string
  formatName: string
  durationSeconds: number
  sizeBytes: number
  bitRate: number
  streamCount: number
  videoStreams: number
  audioStreams: number
  hasVideo: boolean
  hasAudio: boolean
  streams: MediaProbeStream[]
}

export type MediaValidationSummary = {
  ok: boolean
  errors: string[]
  warnings: string[]
  expectedAudio: boolean
  outputHasVideo: boolean
  outputHasAudio: boolean
  inputDurationSeconds?: number
  outputDurationSeconds?: number
  durationDeltaSeconds?: number
}

export function parseArgs(argv: string[]): ArgMap {
  const result: ArgMap = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      result[key] = true
      continue
    }
    result[key] = next
    i += 1
  }
  return result
}

export function getStringArg(args: ArgMap, key: string, fallback = ''): string {
  const value = args[key]
  return typeof value === 'string' ? value : fallback
}

export function hasFlag(args: ArgMap, key: string): boolean {
  return args[key] === true
}

export function canonicalVendor(name?: string): string {
  const value = (name || '').trim().toLowerCase()
  if (!value) return ''
  if (value.includes('minimax') || value.includes('mini max')) return 'minimax'
  if (value.includes('openai兼容') || value.includes('openai-compatible') || value.includes('openai compatible')) return 'openai-compatible'
  if (value.includes('openai')) return 'openai'
  if (value.includes('vidu')) return 'vidu'
  if (value.includes('eleven')) return 'elevenlabs'
  return value
}

export function trimSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

export function ensureDirForFile(filePath: string) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true })
}

export function writeJsonMaybe(data: unknown, outputPath?: string) {
  const text = JSON.stringify(data, null, 2)
  if (outputPath) {
    ensureDirForFile(outputPath)
    fs.writeFileSync(outputPath, text, 'utf8')
  }
  console.log(text)
}

export function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8')) as T
}

export function loadSkillConfig(configPath?: string): PipelineUserConfig {
  return loadConfig(configPath)
}

export function getVideoConfig(config: PipelineUserConfig): StageConfig | undefined {
  return config.downstream?.waoo?.video
}

export function getTtsConfig(config: PipelineUserConfig): StageConfig | undefined {
  return config.downstream?.waoo?.tts
}

export function getAmbienceConfig(config: PipelineUserConfig): AmbienceConfig | undefined {
  return config.downstream?.waoo?.ambience
}

export function getRuntimeConfig(config: PipelineUserConfig): RuntimeConfig | undefined {
  return config.runtime
}

export function guessMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'image/jpeg'
}

export function resolveImageInput(input: string): string {
  if (!input) throw new Error('缺少图片输入')
  if (/^data:/i.test(input)) return input
  if (/^https?:\/\//i.test(input)) return input
  const full = path.resolve(input)
  if (!fs.existsSync(full)) {
    throw new Error(`图片文件不存在: ${full}`)
  }
  const base64 = fs.readFileSync(full).toString('base64')
  return `data:${guessMime(full)};base64,${base64}`
}

export async function fetchBinaryToFile(url: string, outputPath: string, headers?: Record<string, string>) {
  const res = await fetch(url, { headers })
  if (!res.ok) {
    throw new Error(`下载失败: ${res.status} ${await res.text()}`)
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  ensureDirForFile(outputPath)
  fs.writeFileSync(outputPath, buffer)
  return { outputPath: path.resolve(outputPath), bytes: buffer.length }
}

function commandExists(command: string): boolean {
  const checker = process.platform === 'win32' ? 'where' : 'which'
  const res = spawnSync(checker, [command], { stdio: 'ignore' })
  return res.status === 0
}

function resolveExplicitBinary(customPath: string | undefined, envKeys: string[], commandName: string): string {
  const candidate = (customPath || '').trim()
  if (candidate) {
    const full = path.resolve(candidate)
    if (fs.existsSync(full)) return full
    throw new Error(`${commandName} 不存在: ${full}`)
  }

  for (const key of envKeys) {
    const envValue = (process.env[key] || '').trim()
    if (!envValue) continue
    const full = path.resolve(envValue)
    if (fs.existsSync(full)) return full
    throw new Error(`${commandName} 环境变量 ${key} 指向的文件不存在: ${full}`)
  }

  if (commandExists(commandName)) return commandName
  throw new Error(`未找到 ${commandName}。请安装到 PATH，或通过参数/环境变量传入路径。`)
}

export function resolveFfmpegBinary(customPath?: string, configPath?: string): string {
  return resolveExplicitBinary(customPath || configPath, ['FFMPEG_PATH', 'FFMPEG_BIN'], 'ffmpeg')
}

export function resolveFfprobeBinary(customPath?: string, configPath?: string): string {
  return resolveExplicitBinary(customPath || configPath, ['FFPROBE_PATH', 'FFPROBE_BIN'], 'ffprobe')
}

export function checkFfmpegPrerequisites(runtime?: RuntimeConfig): { ffmpeg: string; ffprobe: string } {
  return {
    ffmpeg: resolveFfmpegBinary(undefined, runtime?.ffmpeg),
    ffprobe: resolveFfprobeBinary(undefined, runtime?.ffprobe),
  }
}

function toNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export function probeMediaFile(filePath: string, ffprobePath: string): MediaProbeSummary {
  const full = path.resolve(filePath)
  if (!fs.existsSync(full)) {
    throw new Error(`媒体文件不存在: ${full}`)
  }

  const raw = execFileSync(
    ffprobePath,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', full],
    { encoding: 'utf8' },
  )
  const data = JSON.parse(raw) as {
    format?: Record<string, unknown>
    streams?: Array<Record<string, unknown>>
  }

  const streams = Array.isArray(data.streams) ? data.streams : []
  const normalizedStreams: MediaProbeStream[] = streams.map((stream, index) => ({
    index,
    codecType: String(stream.codec_type || ''),
    codecName: String(stream.codec_name || ''),
    durationSeconds: toNumber(stream.duration),
    bitRate: toNumber(stream.bit_rate),
    width: toNumber(stream.width) || undefined,
    height: toNumber(stream.height) || undefined,
    sampleRate: toNumber(stream.sample_rate) || undefined,
    channels: toNumber(stream.channels) || undefined,
  }))

  const videoStreams = normalizedStreams.filter((item) => item.codecType === 'video').length
  const audioStreams = normalizedStreams.filter((item) => item.codecType === 'audio').length
  const format = data.format || {}

  return {
    file: full,
    formatName: String(format.format_name || ''),
    durationSeconds: toNumber(format.duration),
    sizeBytes: toNumber(format.size),
    bitRate: toNumber(format.bit_rate),
    streamCount: normalizedStreams.length,
    videoStreams,
    audioStreams,
    hasVideo: videoStreams > 0,
    hasAudio: audioStreams > 0,
    streams: normalizedStreams,
  }
}

export function validateMixedMedia(inputProbe: MediaProbeSummary, outputProbe: MediaProbeSummary, expectedAudio: boolean): MediaValidationSummary {
  const errors: string[] = []
  const warnings: string[] = []
  const inputDurationSeconds = inputProbe.durationSeconds || 0
  const outputDurationSeconds = outputProbe.durationSeconds || 0
  const durationDeltaSeconds = Number((outputDurationSeconds - inputDurationSeconds).toFixed(3))

  if (!outputProbe.hasVideo) {
    errors.push('输出文件缺少视频流')
  }
  if (expectedAudio && !outputProbe.hasAudio) {
    errors.push('输出文件缺少音频流')
  }
  if (outputDurationSeconds <= 0) {
    errors.push('输出文件时长无效')
  }
  if (inputDurationSeconds > 0 && outputDurationSeconds > 0 && outputDurationSeconds < inputDurationSeconds - 0.3) {
    errors.push(`输出时长明显短于输入：input=${inputDurationSeconds.toFixed(3)}s output=${outputDurationSeconds.toFixed(3)}s`)
  }
  if (inputDurationSeconds > 0 && outputDurationSeconds > inputDurationSeconds + 0.3) {
    warnings.push(`输出时长长于输入：input=${inputDurationSeconds.toFixed(3)}s output=${outputDurationSeconds.toFixed(3)}s`)
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    expectedAudio,
    outputHasVideo: outputProbe.hasVideo,
    outputHasAudio: outputProbe.hasAudio,
    inputDurationSeconds,
    outputDurationSeconds,
    durationDeltaSeconds,
  }
}
