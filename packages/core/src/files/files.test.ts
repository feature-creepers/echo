import { describe, expect, it } from 'vitest'
import type { Blobs } from '../ports/blobs.ts'
import { memoryRecords } from '../records/memory.ts'
import { createFiles } from './files.ts'

/** Blobs kept in memory, under a made-up hash. */
function memoryBlobs(): Blobs {
  const kept = new Map<string, Uint8Array>()
  return {
    put(bytes) {
      const hash = `h${kept.size}`
      kept.set(hash, bytes)
      return hash
    },
    get: (hash) => kept.get(hash)
  }
}

function setup() {
  let ids = 0
  const files = createFiles({ records: memoryRecords(), blobs: memoryBlobs(), now: () => new Date('2026-11-17T08:00:00Z'), newId: () => `file-${++ids}` })
  const [write, read] = files.tools(() => 'thread-1')
  if (!write || !read) throw new Error('Two tools are expected.')
  return { files, write, read }
}

describe('files', () => {
  it('writes a document and says how to show it', async () => {
    const { files, write } = setup()
    const result = await write.run({ name: 'Letter', content: '# Dear landlord\n\nThe boiler.' })
    expect(result.ok).toBe(true)
    expect(result.text).toContain('"FilePreview"')
    expect(files.read('file-1')).toMatchObject({
      name: 'Letter',
      format: 'markdown',
      version: 1,
      mime: 'text/markdown',
      thread: 'thread-1',
      text: '# Dear landlord\n\nThe boiler.'
    })
  })

  it('writes a new version of the same file', async () => {
    const { files, write } = setup()
    await write.run({ name: 'Letter', content: 'One' })
    await write.run({ name: 'Letter', content: 'Two', file: 'file-1' })
    expect(files.read('file-1')).toMatchObject({ version: 2, text: 'Two' })
  })

  it('refuses a new version of a file that does not exist', async () => {
    expect((await setup().write.run({ name: 'X', content: 'Y', file: 'nope' })).ok).toBe(false)
  })

  it('reads a file back for the session', async () => {
    const { write, read } = setup()
    await write.run({ name: 'List', format: 'csv', content: 'a,b\n1,2' })
    expect((await read.run({ file: 'file-1' })).text).toBe('"List", version 1, csv:\n\na,b\n1,2')
  })
})
