import { MODEL_IMAGE_MAX_BYTES, MODEL_IMAGE_MAX_SIDE } from '@repo/protocol'

/**
 * The ways a picture is written again, smallest last: its own kind first, so a screenshot keeps its sharp text. Only
 * the kinds a model takes that are still pictures; a GIF, which may move, is never written again.
 */
const ATTEMPTS: Record<string, { type: string; quality?: number }[]> = {
  'image/png': [{ type: 'image/png' }, { type: 'image/webp', quality: 0.92 }, { type: 'image/webp', quality: 0.82 }, { type: 'image/jpeg', quality: 0.72 }],
  'image/jpeg': [
    { type: 'image/jpeg', quality: 0.9 },
    { type: 'image/jpeg', quality: 0.8 },
    { type: 'image/jpeg', quality: 0.68 }
  ],
  'image/webp': [
    { type: 'image/webp', quality: 0.9 },
    { type: 'image/webp', quality: 0.8 },
    { type: 'image/jpeg', quality: 0.7 }
  ]
}

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

/** A name with the extension of the kind it was written again as, when that changed. */
export function renamedFor(name: string, from: string, to: string): string {
  if (from === to) return name
  const dot = name.lastIndexOf('.')
  return `${dot > 0 ? name.slice(0, dot) : name}.${EXTENSIONS[to] ?? 'img'}`
}

/** The size a picture is made, to fit within the long side a model takes, its proportions kept. */
export function fittedSize(width: number, height: number, longest = MODEL_IMAGE_MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, longest / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/**
 * A picture as a model takes it: one larger than a model takes, or longer than its longest side, is made smaller and
 * written again before it is sent. Anything else, an animation included, goes as it is.
 */
export async function fitForModel(file: File): Promise<File> {
  const attempts = ATTEMPTS[file.type]
  if (!attempts) return file
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file
  }
  try {
    if (Math.max(bitmap.width, bitmap.height) <= MODEL_IMAGE_MAX_SIDE && file.size <= MODEL_IMAGE_MAX_BYTES) return file
    const { width, height } = fittedSize(bitmap.width, bitmap.height)
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) return file
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, width, height)
    let written: Blob | undefined
    for (const attempt of attempts) {
      written = await canvas.convertToBlob(attempt)
      if (written.size <= MODEL_IMAGE_MAX_BYTES) break
    }
    if (!written) return file
    return new File([written], renamedFor(file.name, file.type, written.type), { type: written.type, lastModified: file.lastModified })
  } finally {
    bitmap.close()
  }
}
