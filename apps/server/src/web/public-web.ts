import { isIP } from 'node:net'
import type { Web } from '@repo/core'

/**
 * Whether an address points at this machine or its local network rather than the public web. The core reads
 * what a model names, so it must not be turned into a way to reach services that are not public.
 */
export function isPrivateHost(host: string): boolean {
  const name = host.replace(/^\[|\]$/g, '').toLowerCase()
  if (name === 'localhost' || name.endsWith('.localhost') || name.endsWith('.local') || name.endsWith('.internal')) return true
  const version = isIP(name)
  if (version === 4) {
    const [a = 0, b = 0] = name.split('.').map(Number)
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    )
  }
  if (version === 6)
    return name === '::1' || name === '::' || name.startsWith('fc') || name.startsWith('fd') || name.startsWith('fe80') || name.startsWith('::ffff:')
  return false
}

/** The public web as the core reads it: https only, never a private address, within a size and a time. */
export const publicWeb: Web = {
  async read(url, { maxBytes, timeoutMs }) {
    let address: URL
    try {
      address = new URL(url)
    } catch {
      return { ok: false, reason: 'it is not a web address.' }
    }
    if (address.protocol !== 'https:') return { ok: false, reason: 'only https:// addresses are read.' }
    if (isPrivateHost(address.hostname)) return { ok: false, reason: 'it is not a public address.' }
    try {
      const response = await fetch(address, {
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
        headers: { accept: 'application/geo+json, application/json;q=0.9, */*;q=0.5' }
      })
      if (response.url && isPrivateHost(new URL(response.url).hostname)) return { ok: false, reason: 'it leads to an address that is not public.' }
      if (!response.ok)
        return {
          ok: false,
          reason: `the address answered ${response.status}${response.statusText ? ` ${response.statusText}` : ''}. Check it, or find another source.`
        }
      const declared = Number(response.headers.get('content-length') ?? 0)
      if (declared > maxBytes) return { ok: false, reason: tooLarge(declared, maxBytes) }
      // Read piece by piece, so a file larger than it said stops being read at the limit.
      const reader = response.body?.getReader()
      if (!reader) return { ok: true, text: '' }
      const pieces: Uint8Array[] = []
      let received = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        if (received > maxBytes) {
          await reader.cancel()
          return { ok: false, reason: tooLarge(received, maxBytes) }
        }
        pieces.push(value)
      }
      return { ok: true, text: Buffer.concat(pieces).toString('utf8') }
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
      return {
        ok: false,
        reason: timedOut ? 'the address took too long to answer.' : `it could not be reached (${error instanceof Error ? error.message : String(error)}).`
      }
    }
  }
}

const tooLarge = (_bytes: number, maxBytes: number) => `the file is over ${Math.round(maxBytes / 1024 / 1024)} MB. Find a simplified, lower-resolution version.`
