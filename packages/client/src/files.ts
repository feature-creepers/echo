import { type Attachment, decodeBase64, encodeBase64, FILE_PIECE_BYTES, type WorkspaceEntry } from '@repo/protocol'
import type { Session } from './session.ts'

/**
 * Files between this device and the core (docs/SPEC.md, section 9.7): one handed over to the assistant, sent a piece
 * at a time, and one of the assistant's folder, read a piece at a time. Bytes cross, never a path of the device.
 */

/** A file as a device holds it: its name, media type and size, and its bytes, a slice at a time. */
export interface Sendable {
  name: string
  type: string
  size: number
  slice(start: number, end: number): Promise<Uint8Array>
}

/** Told when a file handed over is no longer wanted: removed before it was sent. */
export interface Cancel {
  readonly aborted: boolean
}

export class HandOverCancelled extends Error {
  constructor() {
    super('The file was taken back before it was sent.')
    this.name = 'HandOverCancelled'
  }
}

/**
 * Hand a file over to the assistant: it is kept in the inbox of its folder and goes with the next thing said that
 * names it. `onProgress` is told how many bytes have arrived. Taken back on the way, what arrived is removed.
 */
export async function handOver(session: Session, file: Sendable, options: { onProgress?: (sent: number) => void; cancel?: Cancel } = {}): Promise<Attachment> {
  const { attachment } = await session.run('attachment.open', { name: file.name, type: file.type, size: file.size })
  const takeBack = async () => {
    await session.run('attachment.discard', { attachment }).catch(() => undefined)
    throw new HandOverCancelled()
  }
  try {
    for (let start = 0; start < file.size; start += FILE_PIECE_BYTES) {
      if (options.cancel?.aborted) return await takeBack()
      const piece = await file.slice(start, Math.min(file.size, start + FILE_PIECE_BYTES))
      const { received } = await session.run('attachment.write', { attachment, data: encodeBase64(piece) })
      options.onProgress?.(received)
    }
    if (options.cancel?.aborted) return await takeBack()
    return (await session.run('attachment.close', { attachment })).attachment
  } catch (error) {
    if (!(error instanceof HandOverCancelled)) await session.run('attachment.discard', { attachment }).catch(() => undefined)
    throw error
  }
}

/** A file of the assistant's folder, or one it may read on the computer, as far as it was read. */
export interface ReadFile {
  bytes: Uint8Array
  /** Its whole size. More than the bytes read when it was larger than the limit. */
  size: number
  entry: WorkspaceEntry
}

/** Read a file, a piece at a time, up to `limit` bytes. */
export async function readFile(session: Session, path: string, limit: number): Promise<ReadFile> {
  const first = await session.run('workspace.read', { path, offset: 0, length: Math.min(limit, FILE_PIECE_BYTES) })
  const wanted = Math.min(limit, first.size)
  const bytes = new Uint8Array(wanted)
  const take = (data: string, at: number) => {
    const piece = decodeBase64(data) ?? new Uint8Array()
    bytes.set(piece.subarray(0, Math.max(0, wanted - at)), at)
    return piece.length
  }
  let read = take(first.data, 0)
  while (read < wanted) {
    const next = await session.run('workspace.read', { path, offset: read, length: Math.min(FILE_PIECE_BYTES, wanted - read) })
    const length = take(next.data, read)
    if (length === 0) break
    read += length
  }
  return { bytes: bytes.subarray(0, read), size: first.size, entry: first.entry }
}

/**
 * Kinds of file that run a program when opened: the app shows them in their folder instead of opening them, so a
 * file the assistant wrote never runs by a click on Open.
 */
const RUNS = new Set([
  'app',
  'appimage',
  'bat',
  'cmd',
  'com',
  'command',
  'cpl',
  'deb',
  'desktop',
  'dmg',
  'exe',
  'hta',
  'jar',
  'js',
  'jse',
  'lnk',
  'msc',
  'msi',
  'msix',
  'pif',
  'pkg',
  'ps1',
  'psm1',
  'reg',
  'rpm',
  'run',
  'scr',
  'sh',
  'url',
  'vb',
  'vbe',
  'vbs',
  'workflow',
  'ws',
  'wsf',
  'wsh'
])

/** Whether opening a file by its name would run a program rather than show it. */
export function runsWhenOpened(name: string): boolean {
  const dot = name.lastIndexOf('.')
  return dot >= 0 && RUNS.has(name.slice(dot + 1).toLowerCase())
}
