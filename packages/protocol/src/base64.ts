/**
 * Bytes as text and back, in base64: how a file's content crosses a protocol made of JSON lines. Written out
 * here rather than taken from the runtime, which differs between Node, a browser and a phone's engine.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Each character's value, by its code. -1 for a character base64 does not use. */
const VALUES = (() => {
  const values = new Int16Array(128).fill(-1)
  for (let index = 0; index < ALPHABET.length; index++) values[ALPHABET.charCodeAt(index)] = index
  return values
})()

export function encodeBase64(bytes: Uint8Array): string {
  const parts: string[] = []
  // Built in slices, so a long file never makes one string grow a character at a time.
  for (let start = 0; start < bytes.length; start += 3 * 4096) {
    const end = Math.min(bytes.length, start + 3 * 4096)
    let text = ''
    for (let at = start; at < end; at += 3) {
      const first = bytes[at] ?? 0
      const second = bytes[at + 1] ?? 0
      const third = bytes[at + 2] ?? 0
      const group = (first << 16) | (second << 8) | third
      text += ALPHABET[(group >> 18) & 63]
      text += ALPHABET[(group >> 12) & 63]
      text += at + 1 < end ? ALPHABET[(group >> 6) & 63] : '='
      text += at + 2 < end ? ALPHABET[group & 63] : '='
    }
    parts.push(text)
  }
  return parts.join('')
}

/** The bytes a base64 text stands for. Nothing when it is not base64: a character outside it, or a broken end. */
export function decodeBase64(text: string): Uint8Array | undefined {
  const length = text.length
  if (length % 4 !== 0) return undefined
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0
  const bytes = new Uint8Array((length / 4) * 3 - padding)
  let written = 0
  for (let at = 0; at < length; at += 4) {
    const last = at + 4 === length
    let group = 0
    for (let offset = 0; offset < 4; offset++) {
      const code = text.charCodeAt(at + offset)
      const padded = code === 61 && last && offset >= 4 - padding
      const value = padded ? 0 : code < 128 ? (VALUES[code] ?? -1) : -1
      if (value < 0) return undefined
      group = (group << 6) | value
    }
    if (written < bytes.length) bytes[written++] = (group >> 16) & 255
    if (written < bytes.length) bytes[written++] = (group >> 8) & 255
    if (written < bytes.length) bytes[written++] = group & 255
  }
  return bytes
}
