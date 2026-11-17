import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { installModelSet, isInstalled, MARKER_FILE, ModelDownloadError, modelSetFolder, PART_SUFFIX } from './download.ts'
import type { DownloadProgress, ModelSet } from './model-set.ts'

/** What the server holds, by path. Large enough to arrive in several pieces. */
const BIG = randomBytes(600_000)
const SMALL = randomBytes(2_000)
const content: Record<string, Buffer> = { '/big.bin': BIG, '/nested/small.bin': SMALL }

/** One request the server received. */
interface Seen {
  path: string
  range: string | undefined
}

/** How the server misbehaves for the next requests. Reset before each test. */
interface Faults {
  /** Answer with the whole file whatever range is asked for. */
  ignoreRange: boolean
  /** Send this many bytes of the body, then cut the connection. Applies to this many requests. */
  cutAfter: { bytes: number; requests: number } | undefined
  /** Send bytes of the right length that are not the file's. Applies to this many requests. */
  damaged: number
  /** Answer every request with this status. */
  status: number | undefined
  /** Hold back the second half of each body for a moment, so that a test can act in the middle of a download. */
  pause: boolean
}

let server: Server
let origin: string
let seen: Seen[]
let faults: Faults

function answer(request: IncomingMessage, response: ServerResponse): void {
  const path = request.url ?? ''
  const range = request.headers.range
  seen.push({ path, range })

  const whole = content[path]
  if (faults.status !== undefined || !whole) {
    response.writeHead(faults.status ?? 404).end('no')
    return
  }

  const start = range && !faults.ignoreRange ? Number(/^bytes=(\d+)-$/.exec(range)?.[1]) : 0
  if (start >= whole.length) {
    response.writeHead(416, { 'content-range': `bytes */${whole.length}` }).end()
    return
  }
  let body = whole.subarray(start)
  if (faults.damaged > 0) {
    faults.damaged--
    body = Buffer.alloc(body.length, 7)
  }
  response.writeHead(start > 0 ? 206 : 200, {
    'content-length': body.length,
    ...(start > 0 && { 'content-range': `bytes ${start}-${whole.length - 1}/${whole.length}` })
  })

  const cut = faults.cutAfter
  if (cut && cut.requests > 0) {
    cut.requests--
    // The cut comes a moment after the bytes, so that they reach the client first: a connection that is
    // destroyed at once drops what is still on its way, and how much that is differs from system to system.
    response.write(body.subarray(0, cut.bytes), () => setTimeout(() => response.destroy(), 100))
    return
  }
  // In two pieces, so that a test can act between them.
  const half = Math.ceil(body.length / 2)
  response.write(body.subarray(0, half), () => {
    setTimeout(() => response.end(body.subarray(half)), faults.pause ? 200 : 0)
  })
}

beforeAll(async () => {
  server = createServer(answer)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => {
  server.closeAllConnections()
  server.close()
})

const folders: string[] = []
function folder(): string {
  const created = mkdtempSync(join(tmpdir(), 'models-test-'))
  folders.push(created)
  return created
}
afterEach(() => {
  for (const created of folders.splice(0)) rmSync(created, { recursive: true, force: true, maxRetries: 5 })
})

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

function testSet(): ModelSet {
  seen = []
  faults = { ignoreRange: false, cutAfter: undefined, damaged: 0, status: undefined, pause: false }
  return {
    id: 'test-set',
    purpose: 'voice',
    name: 'the test voice',
    licence: 'MIT',
    files: [
      { path: 'big.bin', url: `${origin}/big.bin`, bytes: BIG.length, sha256: sha256(BIG) },
      { path: 'nested/small.bin', url: `${origin}/nested/small.bin`, bytes: SMALL.length, sha256: sha256(SMALL) }
    ]
  }
}

const TOTAL = BIG.length + SMALL.length

/** Every file under a folder, as paths relative to it. */
function filesIn(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      join(entry.parentPath, entry.name)
        .slice(directory.length + 1)
        .replaceAll('\\', '/')
    )
    .sort()
}

describe('installing a model set', () => {
  it('downloads every file, verifies it, and marks the set installed', async () => {
    const set = testSet()
    const at = folder()
    const progress: DownloadProgress[] = []
    expect(isInstalled(at, set)).toBe(false)

    await installModelSet(at, set, { onProgress: (step) => progress.push(step) })

    const directory = modelSetFolder(at, set)
    expect(directory).toBe(join(at, 'test-set'))
    expect(readFileSync(join(directory, 'big.bin')).equals(BIG)).toBe(true)
    expect(readFileSync(join(directory, 'nested', 'small.bin')).equals(SMALL)).toBe(true)
    expect(filesIn(directory)).toEqual(['big.bin', MARKER_FILE, 'nested/small.bin'])
    expect(isInstalled(at, set)).toBe(true)

    expect(progress.every((step) => step.set === 'test-set' && step.total === TOTAL)).toBe(true)
    expect(progress.map((step) => step.received)).toEqual([...progress.map((step) => step.received)].sort((a, b) => a - b))
    expect(progress.at(-1)?.received).toBe(TOTAL)
    expect(seen).toEqual([
      { path: '/big.bin', range: undefined },
      { path: '/nested/small.bin', range: undefined }
    ])
  })

  it('does nothing when the set is already installed', async () => {
    const set = testSet()
    const at = folder()
    await installModelSet(at, set)
    seen = []
    const progress: DownloadProgress[] = []

    await installModelSet(at, set, { onProgress: (step) => progress.push(step) })

    expect(seen).toEqual([])
    expect(progress).toEqual([])
  })

  it('gives a file its final name only once it is whole and verified', async () => {
    const set = testSet()
    const at = folder()
    const final = join(modelSetFolder(at, set), 'big.bin')
    const duringDownload: Array<{ final: boolean; part: boolean }> = []
    faults.pause = true

    await installModelSet(at, set, { onProgress: () => duringDownload.push({ final: existsSync(final), part: existsSync(final + PART_SUFFIX) }) })

    // The first report comes with the first bytes, the last ones once everything is in place.
    expect(duringDownload[0]).toEqual({ final: false, part: true })
    expect(duringDownload.at(-1)).toEqual({ final: true, part: false })
    expect(existsSync(final)).toBe(true)
    expect(existsSync(final + PART_SUFFIX)).toBe(false)
  })

  it('continues a partial file with a range request', async () => {
    const set = testSet()
    const at = folder()
    mkdirSync(modelSetFolder(at, set), { recursive: true })
    writeFileSync(join(modelSetFolder(at, set), `big.bin${PART_SUFFIX}`), BIG.subarray(0, 250_000))
    const progress: DownloadProgress[] = []

    await installModelSet(at, set, { onProgress: (step) => progress.push(step) })

    expect(seen[0]).toEqual({ path: '/big.bin', range: 'bytes=250000-' })
    expect(readFileSync(join(modelSetFolder(at, set), 'big.bin')).equals(BIG)).toBe(true)
    expect(isInstalled(at, set)).toBe(true)
    // What was already on disk counts from the first report.
    expect(progress[0]?.received).toBeGreaterThanOrEqual(250_000)
  })

  it('picks up by itself where a cut connection left off', async () => {
    const set = testSet()
    const at = folder()
    faults.cutAfter = { bytes: 100_000, requests: 1 }

    await installModelSet(at, set)

    // The download goes on from what had arrived when the connection was cut: the 100 000 bytes, or fewer on a slow system.
    const requests = seen.filter((request) => request.path === '/big.bin')
    expect(requests.length).toBe(2)
    expect(requests[0]?.range).toBeUndefined()
    const continuedFrom = Number(/^bytes=(\d+)-$/.exec(requests[1]?.range ?? '')?.[1])
    expect(continuedFrom).toBeGreaterThan(0)
    expect(continuedFrom).toBeLessThanOrEqual(100_000)
    expect(readFileSync(join(modelSetFolder(at, set), 'big.bin')).equals(BIG)).toBe(true)
  })

  it('gives up, with a message for the user, when the connection keeps failing without delivering anything', async () => {
    const set = testSet()
    const at = folder()
    faults.cutAfter = { bytes: 0, requests: 100 }

    const failure = await installModelSet(at, set).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ModelDownloadError)
    expect((failure as Error).message).toBe('Could not download the test voice: the server could not be reached. Check the connection and try again.')
    expect(seen.length).toBe(3)
    expect(isInstalled(at, set)).toBe(false)
  })

  it('starts a file again when the server ignores the range', async () => {
    const set = testSet()
    const at = folder()
    mkdirSync(modelSetFolder(at, set), { recursive: true })
    writeFileSync(join(modelSetFolder(at, set), `big.bin${PART_SUFFIX}`), BIG.subarray(0, 250_000))
    faults.ignoreRange = true

    await installModelSet(at, set)

    expect(readFileSync(join(modelSetFolder(at, set), 'big.bin')).equals(BIG)).toBe(true)
  })

  it('refuses bytes that do not match the hash, and leaves nothing that looks installed', async () => {
    const set = testSet()
    const at = folder()
    faults.damaged = 2

    const failure = await installModelSet(at, set).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ModelDownloadError)
    expect((failure as Error).message).toBe('Could not download the test voice: "big.bin" arrived damaged, twice. Try again later.')
    // Asked for twice: a damaged file is fetched again once before giving up.
    expect(seen).toEqual([
      { path: '/big.bin', range: undefined },
      { path: '/big.bin', range: undefined }
    ])
    expect(filesIn(modelSetFolder(at, set))).toEqual([])
    expect(isInstalled(at, set)).toBe(false)
  })

  it('recovers from one damaged download by fetching the file again', async () => {
    const set = testSet()
    const at = folder()
    faults.damaged = 1

    await installModelSet(at, set)

    expect(readFileSync(join(modelSetFolder(at, set), 'big.bin')).equals(BIG)).toBe(true)
    expect(isInstalled(at, set)).toBe(true)
  })

  it('starts again from nothing when the partial file on disk is not the start of the file', async () => {
    const set = testSet()
    const at = folder()
    mkdirSync(modelSetFolder(at, set), { recursive: true })
    writeFileSync(join(modelSetFolder(at, set), `big.bin${PART_SUFFIX}`), Buffer.alloc(250_000, 1))

    await installModelSet(at, set)

    expect(seen.filter((request) => request.path === '/big.bin')).toEqual([
      { path: '/big.bin', range: 'bytes=250000-' },
      { path: '/big.bin', range: undefined }
    ])
    expect(readFileSync(join(modelSetFolder(at, set), 'big.bin')).equals(BIG)).toBe(true)
  })

  it('stops when cancelled, keeps what it received, and continues from it next time', async () => {
    const set = testSet()
    const at = folder()
    const stop = new AbortController()
    faults.pause = true

    // Stopped at the first report, which comes once the first bytes are on disk.
    const failure = await installModelSet(at, set, { signal: stop.signal, onProgress: () => stop.abort() }).catch((error: unknown) => error)

    expect((failure as Error).name).toBe('AbortError')
    const part = join(modelSetFolder(at, set), `big.bin${PART_SUFFIX}`)
    const kept = readFileSync(part)
    expect(kept.length).toBeGreaterThan(0)
    expect(kept.equals(BIG.subarray(0, kept.length))).toBe(true)
    expect(existsSync(join(modelSetFolder(at, set), 'big.bin'))).toBe(false)
    expect(isInstalled(at, set)).toBe(false)

    seen = []
    faults.pause = false
    await installModelSet(at, set)

    expect(seen[0]).toEqual({ path: '/big.bin', range: `bytes=${kept.length}-` })
    expect(isInstalled(at, set)).toBe(true)
  })

  it('does not start when it is cancelled beforehand', async () => {
    const set = testSet()
    const failure = await installModelSet(folder(), set, { signal: AbortSignal.abort() }).catch((error: unknown) => error)

    expect((failure as Error).name).toBe('AbortError')
    expect(seen).toEqual([])
  })

  it('says what the server answered when it refuses', async () => {
    const set = testSet()
    faults.status = 503

    const failure = await installModelSet(folder(), set).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ModelDownloadError)
    expect((failure as Error).message).toBe('Could not download the test voice: the server answered 503 for "big.bin".')
    expect(seen.length).toBe(1)
  })

  it('keeps a file already in place when it is the right one, and replaces it when it is not', async () => {
    const set = testSet()
    const at = folder()
    mkdirSync(join(modelSetFolder(at, set), 'nested'), { recursive: true })
    writeFileSync(join(modelSetFolder(at, set), 'big.bin'), BIG)
    writeFileSync(join(modelSetFolder(at, set), 'nested', 'small.bin'), Buffer.alloc(SMALL.length, 9))

    await installModelSet(at, set)

    expect(seen).toEqual([{ path: '/nested/small.bin', range: undefined }])
    expect(readFileSync(join(modelSetFolder(at, set), 'nested', 'small.bin')).equals(SMALL)).toBe(true)
    expect(isInstalled(at, set)).toBe(true)
  })

  it('downloads once when asked twice at the same time', async () => {
    const set = testSet()
    const at = folder()

    await Promise.all([installModelSet(at, set), installModelSet(at, set)])

    expect(seen.length).toBe(2)
    expect(isInstalled(at, set)).toBe(true)
  })

  it('refuses a file whose path leads out of the set', async () => {
    const set = testSet()
    const at = folder()
    set.files[0] = { ...(set.files[0] as ModelSet['files'][number]), path: '../outside.bin' }

    await expect(installModelSet(at, set)).rejects.toThrow('"../outside.bin" is not a path inside a model set.')
    expect(seen).toEqual([])
    expect(existsSync(join(at, 'outside.bin'))).toBe(false)
  })
})

describe('checking that a set is installed', () => {
  it('says no when a file has lost bytes or is gone', async () => {
    const set = testSet()
    const at = folder()
    await installModelSet(at, set)

    writeFileSync(join(modelSetFolder(at, set), 'nested', 'small.bin'), SMALL.subarray(0, 100))
    expect(isInstalled(at, set)).toBe(false)

    rmSync(join(modelSetFolder(at, set), 'nested', 'small.bin'))
    expect(isInstalled(at, set)).toBe(false)
  })

  it('says no when the catalogue now records another file than the one verified, and installs the new one', async () => {
    const set = testSet()
    const at = folder()
    await installModelSet(at, set)
    const changed = Buffer.from(SMALL).fill(3, 0, 10)
    content['/nested/small.bin'] = changed
    const updated: ModelSet = {
      ...set,
      files: [set.files[0] as ModelSet['files'][number], { ...(set.files[1] as ModelSet['files'][number]), sha256: sha256(changed) }]
    }

    try {
      expect(isInstalled(at, updated)).toBe(false)
      seen = []
      await installModelSet(at, updated)

      // The file that did not change is kept: only the other one is fetched.
      expect(seen).toEqual([{ path: '/nested/small.bin', range: undefined }])
      expect(isInstalled(at, updated)).toBe(true)
      expect(isInstalled(at, set)).toBe(false)
    } finally {
      content['/nested/small.bin'] = SMALL
    }
  })
})
