import { type LookupAddress, type LookupAllOptions, type LookupOptions, lookup } from 'node:dns'
import { BlockList, isIP } from 'node:net'
import type { Web } from '@repo/core'
import { Agent, fetch } from 'undici'

/**
 * The addresses that are not on the public web: this machine, its local network, and what no public host has. One
 * list for each family, since Node's BlockList reads an IPv4-mapped rule (`::ffff:0:0/96`) as covering every IPv4
 * address, and an IPv4 address is checked against IPv4 rules only.
 */
const NOT_PUBLIC = {
  ipv4: [
    ['0.0.0.0', 8], // This network
    ['10.0.0.0', 8], // Private
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
    ['100.64.0.0', 10], // Shared address space (CGNAT)
    ['127.0.0.0', 8], // Loopback
    ['169.254.0.0', 16], // Link-local
    ['192.0.0.0', 24], // Protocol assignments
    ['198.18.0.0', 15], // Benchmarking
    ['240.0.0.0', 4], // Reserved, with the broadcast address
    ['224.0.0.0', 4] // Multicast
  ],
  ipv6: [
    ['::1', 128], // Loopback
    ['fe80::', 10], // Link-local
    ['ff00::', 8], // Multicast
    ['::', 96], // Unspecified, and IPv4-compatible
    ['::ffff:0:0', 96], // IPv4-mapped, whatever address it carries
    ['64:ff9b::', 96], // IPv4 translated (NAT64)
    ['64:ff9b:1::', 48],
    ['fc00::', 7], // Unique local
    ['fec0::', 10] // The former site-local
  ]
} as const

const blocked = { ipv4: new BlockList(), ipv6: new BlockList() }
for (const family of ['ipv4', 'ipv6'] as const) {
  for (const [network, prefix] of NOT_PUBLIC[family]) blocked[family].addSubnet(network, prefix, family)
}

/** Whether an address is one a public host may have. Anything that is not an address is not. */
export function isPublicAddress(address: string): boolean {
  const version = isIP(address)
  if (version === 0) return false
  const family = version === 4 ? 'ipv4' : 'ipv6'
  return !blocked[family].check(address, family)
}

/**
 * Whether a host, as an address names it, points at this machine or its local network rather than the public web.
 * The core reads what a model names, so it must not be turned into a way to reach services that are not public.
 */
export function isPrivateHost(host: string): boolean {
  const name = host.replace(/^\[|\]$/g, '').toLowerCase()
  if (name === 'localhost' || name.endsWith('.localhost') || name.endsWith('.local') || name.endsWith('.internal')) return true
  return isIP(name) !== 0 && !isPublicAddress(name)
}

/** Looks a name up: every address it leads to. `dns.lookup` by default; a test's own map otherwise. */
export type Resolve = (hostname: string, options: LookupAllOptions, callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void

/** A name refused by the lookup, for an address it leads to that is not public. */
class NotPublic extends Error {
  readonly code = 'ENOTPUBLIC'
  constructor(hostname: string) {
    super(`${hostname} leads to an address that is not public`)
  }
}

/**
 * Look a name up as `net.connect` asks its `lookup` to, and refuse the whole name when any address it leads to is not
 * public. The socket connects to an address given here, already checked, so the name cannot lead elsewhere between
 * the check and the connection. With `all`, which Node asks for while it tries IPv6 and IPv4 in turn, every address
 * is given; otherwise the first.
 */
export function checkedLookup(
  hostname: string,
  options: LookupOptions,
  callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
  resolve: Resolve = lookup
): void {
  resolve(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, '')
    const [first] = addresses
    if (!first || !addresses.every(({ address }) => isPublicAddress(address))) return callback(new NotPublic(hostname), '')
    if (options.all) callback(null, addresses)
    else callback(null, first.address, first.family)
  })
}

/** An HTTP agent that connects to public addresses only: each name it is asked for is looked up once, and checked. */
export function publicAgent(resolve: Resolve = lookup): Agent {
  return new Agent({ connect: { lookup: (hostname, options, callback) => checkedLookup(hostname, options, callback, resolve) } })
}

/** How many redirects an address may lead through before it is given up. */
const MAX_REDIRECTS = 5

/** Why an address is not read, before it is asked for, or nothing when it is an https address with a public host. */
function refusal(address: URL): string | undefined {
  if (address.protocol !== 'https:') return 'only https:// addresses are read.'
  if (isPrivateHost(address.hostname)) return 'it is not a public address.'
  return undefined
}

/** Whether an error was caused by the lookup refusing a name, however deep the HTTP client wrapped it. */
function refusedByLookup(error: unknown): boolean {
  for (let cause = error; cause instanceof Error; cause = cause.cause) if (cause instanceof NotPublic) return true
  return false
}

interface PublicWebOptions {
  /** Looks a name up. Left out, the system's own lookup. */
  resolve?: Resolve
}

/**
 * The public web as the core reads it: https only, never a private address, within a size and a time. An address is
 * checked by its name, and by every address its name leads to when it is connected to, at each redirect.
 */
export function createPublicWeb({ resolve = lookup }: PublicWebOptions = {}): Web {
  const agent = publicAgent(resolve)
  return {
    async read(url, { maxBytes, timeoutMs }) {
      let address: URL
      try {
        address = new URL(url)
      } catch {
        return { ok: false, reason: 'it is not a web address.' }
      }
      const signal = AbortSignal.timeout(timeoutMs)
      let redirects = 0
      try {
        let response: Awaited<ReturnType<typeof fetch>>
        // Each redirect is checked before it is followed, and asked for through the same agent, so a public address
        // never sends the request to a private one, nor off https.
        for (; ; redirects++) {
          const refused = refusal(address)
          if (refused) return { ok: false, reason: redirects === 0 ? refused : 'it leads to an address that is not public.' }
          response = await fetch(address, {
            signal,
            redirect: 'manual',
            dispatcher: agent,
            headers: { accept: 'application/geo+json, application/json;q=0.9, */*;q=0.5' }
          })
          const location = response.headers.get('location')
          if (response.status < 300 || response.status > 399 || location === null) break
          await response.body?.cancel()
          if (redirects === MAX_REDIRECTS) return { ok: false, reason: 'it redirects too many times.' }
          address = new URL(location, address)
        }
        if (!response.ok)
          return {
            ok: false,
            reason: `the address answered ${response.status}${response.statusText ? ` ${response.statusText}` : ''}. Check it, or find another source.`
          }
        const declared = Number(response.headers.get('content-length') ?? 0)
        if (declared > maxBytes) return { ok: false, reason: tooLarge(maxBytes) }
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
            return { ok: false, reason: tooLarge(maxBytes) }
          }
          pieces.push(value)
        }
        return { ok: true, text: Buffer.concat(pieces).toString('utf8') }
      } catch (error) {
        if (refusedByLookup(error)) return { ok: false, reason: redirects === 0 ? 'it is not a public address.' : 'it leads to an address that is not public.' }
        const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
        return {
          ok: false,
          reason: timedOut ? 'the address took too long to answer.' : `it could not be reached (${error instanceof Error ? error.message : String(error)}).`
        }
      }
    }
  }
}

const tooLarge = (maxBytes: number) => `the file is over ${Math.round(maxBytes / 1024 / 1024)} MB. Find a simplified, lower-resolution version.`
