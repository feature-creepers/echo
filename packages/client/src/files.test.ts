import { decodeBase64, encodeBase64, FILE_PIECE_BYTES } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { HandOverCancelled, handOver, readFile, runsWhenOpened, type Sendable } from './files.ts'
import type { Session } from './session.ts'

/** A session whose core keeps one file in memory: what was handed over, and a file to read. */
function fakeCore(stored = new Uint8Array()) {
  const calls: { name: string; input: Record<string, unknown> }[] = []
  let received = new Uint8Array()
  const session = {
    run: async (name: string, input: Record<string, unknown>) => {
      calls.push({ name, input: name === 'attachment.write' ? { ...input, data: `${String(input.data).length} characters` } : input })
      switch (name) {
        case 'attachment.open':
          return { attachment: 'a1' }
        case 'attachment.write': {
          const piece = decodeBase64(String(input.data)) ?? new Uint8Array()
          const joined = new Uint8Array(received.length + piece.length)
          joined.set(received)
          joined.set(piece, received.length)
          received = joined
          return { received: received.length }
        }
        case 'attachment.close':
          return { attachment: { id: 'a1', name: 'photo.png', path: 'inbox/d/photo.png', type: 'image/png', size: received.length, image: true } }
        case 'workspace.read': {
          const offset = Number(input.offset)
          const piece = stored.slice(offset, offset + Number(input.length))
          return {
            data: encodeBase64(piece),
            size: stored.length,
            entry: { path: 'a.bin', name: 'a.bin', kind: 'file', size: stored.length, modified: '', location: '/w/a.bin' }
          }
        }
        default:
          return {}
      }
    },
    onEvent: () => () => undefined,
    close: () => undefined
  } as unknown as Session
  return { session, calls, received: () => received }
}

const sendable = (bytes: Uint8Array): Sendable => ({
  name: 'photo.png',
  type: 'image/png',
  size: bytes.length,
  slice: async (start, end) => bytes.slice(start, end)
})

describe('handing a file over', () => {
  it('sends it in pieces that each fit in a message, telling the progress', async () => {
    const { session, calls, received } = fakeCore()
    const bytes = new Uint8Array(FILE_PIECE_BYTES * 2 + 10).map((_, index) => index % 256)
    const progress: number[] = []
    const attachment = await handOver(session, sendable(bytes), { onProgress: (sent) => progress.push(sent) })
    expect(attachment.id).toBe('a1')
    expect(received()).toEqual(bytes)
    expect(progress).toEqual([FILE_PIECE_BYTES, FILE_PIECE_BYTES * 2, FILE_PIECE_BYTES * 2 + 10])
    expect(calls.map((call) => call.name)).toEqual(['attachment.open', 'attachment.write', 'attachment.write', 'attachment.write', 'attachment.close'])
  })

  it('takes the file back when it is removed on the way', async () => {
    const { session, calls } = fakeCore()
    const cancel = { aborted: false }
    const bytes = new Uint8Array(FILE_PIECE_BYTES * 3)
    const going = handOver(session, sendable(bytes), { onProgress: () => (cancel.aborted = true), cancel })
    await expect(going).rejects.toBeInstanceOf(HandOverCancelled)
    expect(calls.map((call) => call.name)).toEqual(['attachment.open', 'attachment.write', 'attachment.discard'])
  })
})

describe('reading a file of the assistant', () => {
  it('reads it a piece at a time, up to the limit', async () => {
    const stored = new Uint8Array(FILE_PIECE_BYTES + 100).map((_, index) => index % 7)
    const { session } = fakeCore(stored)
    const whole = await readFile(session, 'a.bin', 10 * FILE_PIECE_BYTES)
    expect(whole.bytes).toEqual(stored)
    expect(whole.size).toBe(stored.length)
    const start = await readFile(session, 'a.bin', 50)
    expect(start.bytes).toEqual(stored.slice(0, 50))
    expect(start.size).toBe(stored.length)
  })
})

describe('opening a file', () => {
  it.each([
    ['trip.md', false],
    ['photo.PNG', false],
    ['setup.exe', true],
    ['Install.MSI', true],
    ['script.ps1', true],
    ['run.sh', true],
    ['shortcut.lnk', true],
    ['Calculator.app', true],
    ['README', false]
  ])('of %s would run a program: %s', (name, runs) => {
    expect(runsWhenOpened(name)).toBe(runs)
  })
})
