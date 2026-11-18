import { createHash } from 'node:crypto'
import { createReadStream, readFileSync, statSync } from 'node:fs'
import { type FileHandle, mkdir, open, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { bytesOf } from './catalogue.ts'
import type { DownloadProgress, ModelFile, ModelSet } from './model-set.ts'

/**
 * Downloading a model set into the device's model folder.
 *
 * A file is written beside its final place under a `.part` name, checked against the size and the SHA-256
 * the catalogue records, and only then renamed. So a file with its final name is always whole, and a
 * download that was cut off is continued from where it stopped. When every file of a set is in place, a
 * marker is written: checking that a set is installed is then a matter of reading the marker and the sizes,
 * with nothing to hash.
 */

/** Written in a set's folder once every file has been verified. It records what was verified. */
export const MARKER_FILE = 'installed.json'

/** What a file is called while it is being downloaded. */
export const PART_SUFFIX = '.part'

/** How many times in a row a download may be cut off without having received anything, before giving up. */
const ATTEMPTS = 3

/** Progress is reported at most this often, and always when a file is complete. */
const REPORT_EVERY_MS = 100

export interface InstallOptions {
  /** Told how far the download has got: often while bytes arrive, and once at the end. */
  onProgress?: (progress: DownloadProgress) => void
  /** Stops the download. What was received stays on disk and the next call continues from it. */
  signal?: AbortSignal
}

/** A set could not be downloaded. The message is written for the user. */
export class ModelDownloadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ModelDownloadError'
  }
}

/** The connection failed or ended early: worth another attempt, which continues from what is on disk. */
class Interrupted extends ModelDownloadError {}

/** The folder that holds one set, inside the model folder. */
export function modelSetFolder(folder: string, set: ModelSet): string {
  return join(folder, set.id)
}

/**
 * Whether every file of the set is in place and was verified. Cheap enough to call at every launch:
 * it reads the marker and the size of each file.
 */
export function isInstalled(folder: string, set: ModelSet): boolean {
  const directory = modelSetFolder(folder, set)
  try {
    if (readFileSync(join(directory, MARKER_FILE), 'utf8') !== markerOf(set)) return false
    return set.files.every((file) => statSync(join(directory, file.path)).size === file.bytes)
  } catch {
    return false // No marker, or a file is gone.
  }
}

/** The downloads under way in this process, by folder, so that two calls for one set never write the same file. */
const installing = new Map<string, Promise<void>>()

/**
 * Download the set into `<folder>/<set.id>/`. Does nothing when the set is already installed, and continues
 * a download that was cut off. Rejects with a `ModelDownloadError`, or with the signal's reason when stopped.
 */
export async function installModelSet(folder: string, set: ModelSet, options: InstallOptions = {}): Promise<void> {
  const directory = modelSetFolder(folder, set)
  // A second call for the same set waits for the first, then finds the work done, or finishes it.
  const before = installing.get(directory) ?? Promise.resolve()
  const run = before.catch(() => undefined).then(() => install(folder, set, options))
  installing.set(directory, run)
  try {
    await run
  } finally {
    if (installing.get(directory) === run) installing.delete(directory)
  }
}

async function install(folder: string, set: ModelSet, { onProgress, signal }: InstallOptions): Promise<void> {
  signal?.throwIfAborted()
  if (isInstalled(folder, set)) return

  const directory = modelSetFolder(folder, set)
  const places = set.files.map((file) => placeOf(directory, file))
  await mkdir(directory, { recursive: true })

  // What is on disk for each file. A file already in place counts as whole until its turn comes to be checked.
  const received = await Promise.all(
    set.files.map(async (file, index) => {
      const place = places[index] as Place
      if ((await sizeOf(place.final)) === file.bytes) return file.bytes
      return Math.min(await sizeOf(place.part), file.bytes)
    })
  )
  const total = bytesOf(set)
  let reported = 0
  const report = (now: boolean) => {
    if (!onProgress) return
    const time = Date.now()
    if (!now && time - reported < REPORT_EVERY_MS) return
    reported = time
    onProgress({ set: set.id, received: received.reduce((sum, bytes) => sum + bytes, 0), total })
  }

  try {
    for (const [index, file] of set.files.entries()) {
      const place = places[index] as Place
      await settle(set, file, place, signal, (bytes) => {
        received[index] = bytes
        report(bytes === file.bytes)
      })
      received[index] = file.bytes
    }
    await writeFile(join(directory, MARKER_FILE + PART_SUFFIX), markerOf(set))
    await rename(join(directory, MARKER_FILE + PART_SUFFIX), join(directory, MARKER_FILE))
  } catch (error) {
    if (signal?.aborted) throw signal.reason
    if (isFull(error)) {
      throw new ModelDownloadError(`Could not download ${set.name}: the disk is full. It takes ${megabytes(total)} MB.`, { cause: error })
    }
    throw error
  }
  report(true)
}

interface Place {
  /** Where the file ends up. */
  final: string
  /** Where it is written until it has been verified. */
  part: string
}

function placeOf(directory: string, file: ModelFile): Place {
  const final = resolve(directory, file.path)
  // A path is data: it must not lead out of the set's folder.
  if (!final.startsWith(resolve(directory) + sep)) throw new ModelDownloadError(`"${file.path}" is not a path inside a model set.`)
  return { final, part: final + PART_SUFFIX }
}

/** Bring one file to its final place, verified: keep it if it is there and right, otherwise download it. */
async function settle(set: ModelSet, file: ModelFile, place: Place, signal: AbortSignal | undefined, onBytes: (bytes: number) => void): Promise<void> {
  await mkdir(dirname(place.final), { recursive: true })

  // No marker vouches for a file found in place, so it is hashed before it is trusted.
  if ((await sizeOf(place.final)) === file.bytes && (await sha256Of(place.final, signal)) === file.sha256) return
  await rm(place.final, { force: true })

  for (let round = 1; ; round++) {
    await download(set, file, place.part, signal, onBytes)
    if ((await sha256Of(place.part, signal)) === file.sha256) break
    // The bytes are wrong, and nothing says which: start this file again, once.
    await rm(place.part, { force: true })
    onBytes(0)
    if (round === 2) throw new ModelDownloadError(`Could not download ${set.name}: "${file.path}" arrived damaged, twice. Try again later.`)
  }
  await rename(place.part, place.final)
}

/** Fill the `.part` file up to the size the catalogue records, continuing from what it already holds. */
async function download(set: ModelSet, file: ModelFile, part: string, signal: AbortSignal | undefined, onBytes: (bytes: number) => void): Promise<void> {
  let idle = 0
  for (;;) {
    let have = await sizeOf(part)
    if (have > file.bytes) {
      await rm(part, { force: true })
      have = 0
    }
    if (have === file.bytes) return

    try {
      await request(set, file, part, have, signal, onBytes)
    } catch (error) {
      if (signal?.aborted) throw signal.reason
      if (!(error instanceof Interrupted)) throw error
      // A connection that keeps delivering something is worth following as long as it takes.
      idle = (await sizeOf(part)) > have ? 0 : idle + 1
      if (idle >= ATTEMPTS) throw new ModelDownloadError(error.message, { cause: error.cause })
    }
  }
}

/** One request for what is missing of a file, written to the end of its `.part`. */
async function request(
  set: ModelSet,
  file: ModelFile,
  part: string,
  have: number,
  signal: AbortSignal | undefined,
  onBytes: (bytes: number) => void
): Promise<void> {
  const unreachable = `Could not download ${set.name}: the server could not be reached. Check the connection and try again.`

  let response: Response
  try {
    response = await fetch(file.url, { ...(have > 0 && { headers: { Range: `bytes=${have}-` } }), ...(signal && { signal }) })
  } catch (error) {
    throw new Interrupted(unreachable, { cause: error })
  }

  // The server cannot continue from there, or answered with another part of the file: start the file again.
  if (response.status === 416 || (response.status === 206 && startOf(response) !== have)) {
    await response.body?.cancel()
    await rm(part, { force: true })
    onBytes(0)
    throw new Interrupted(unreachable)
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    throw new ModelDownloadError(`Could not download ${set.name}: the server answered ${response.status} for "${file.path}".`)
  }

  // A server that ignores the range sends the whole file (200): what was on disk is replaced.
  const continued = response.status === 206
  if (!continued) have = 0

  let handle: FileHandle | undefined
  try {
    handle = await open(part, continued ? 'a' : 'w')
    for await (const chunk of response.body) {
      if (have + chunk.length > file.bytes) {
        throw new ModelDownloadError(`Could not download ${set.name}: the server sent more than the ${file.bytes} bytes of "${file.path}".`)
      }
      await handle.appendFile(chunk)
      have += chunk.length
      onBytes(have)
    }
  } catch (error) {
    if (error instanceof ModelDownloadError || isFull(error)) throw error
    throw new Interrupted(unreachable, { cause: error })
  } finally {
    await handle?.close()
  }
  if (have < file.bytes) throw new Interrupted(unreachable)
}

/** Where the body of a partial answer starts in the file, from its Content-Range header. */
function startOf(response: Response): number | undefined {
  const start = /^bytes (\d+)-/.exec(response.headers.get('content-range') ?? '')?.[1]
  return start === undefined ? undefined : Number(start)
}

/** The marker of a set: what was verified. A catalogue that changes a file no longer matches it. */
function markerOf(set: ModelSet): string {
  return JSON.stringify({ set: set.id, files: set.files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })) })
}

/** The size of a file, or 0 when it does not exist. */
async function sizeOf(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

async function sha256Of(path: string, signal: AbortSignal | undefined): Promise<string> {
  const hash = createHash('sha256')
  // Hashing the largest file takes a second or two: long enough to be worth stopping.
  for await (const chunk of createReadStream(path, signal && { signal })) hash.update(chunk)
  return hash.digest('hex')
}

function isFull(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOSPC'
}

function megabytes(bytes: number): number {
  return Math.ceil(bytes / 1_000_000)
}
