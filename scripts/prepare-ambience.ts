import fs from 'node:fs'
import path from 'node:path'
import { getStringArg, parseArgs, writeJsonMaybe } from './_shared'

type AmbienceResult = {
  mode: 'local' | 'none'
  ambienceAudio: string
  found: boolean
  notes: string[]
}

function firstExisting(paths: string[]): string {
  for (const item of paths) {
    const full = path.resolve(item)
    if (fs.existsSync(full)) return full
  }
  return ''
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2))
  const preferred = getStringArg(args, 'preferred')
  const fallbackDir = getStringArg(args, 'dir')
  const outputPath = getStringArg(args, 'out') || undefined
  const candidates = [preferred]
  if (fallbackDir) {
    candidates.push(
      path.join(fallbackDir, 'snow-ambience.mp3'),
      path.join(fallbackDir, 'wind-snow.mp3'),
      path.join(fallbackDir, 'snowstorm.mp3'),
    )
  }
  const found = firstExisting(candidates.filter(Boolean))
  const result: AmbienceResult = found
    ? { mode: 'local', ambienceAudio: found, found: true, notes: ['使用本地环境音'] }
    : { mode: 'none', ambienceAudio: '', found: false, notes: ['未找到本地环境音，需走后续 AI fallback'] }

  writeJsonMaybe(result, outputPath)
}
