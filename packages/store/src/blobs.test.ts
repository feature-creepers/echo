import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBlobs } from './blobs.ts'

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true, maxRetries: 5 })
})
const folder = () => {
  const made = mkdtempSync(join(tmpdir(), 'blobs-'))
  folders.push(made)
  return join(made, 'files')
}

describe('blobs', () => {
  it('keeps bytes by their hash and gives them back', () => {
    const blobs = createBlobs(folder())
    const hash = blobs.put(new TextEncoder().encode('hello'))
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    expect(new TextDecoder().decode(blobs.get(hash))).toBe('hello')
  })

  it('keeps the same content once', () => {
    const at = folder()
    const blobs = createBlobs(at)
    blobs.put(new Uint8Array([1, 2, 3]))
    blobs.put(new Uint8Array([1, 2, 3]))
    expect(readdirSync(at)).toHaveLength(1)
  })

  it('gives nothing for an unknown hash, or for anything that is not a hash', () => {
    const blobs = createBlobs(folder())
    expect(blobs.get('0'.repeat(64))).toBeUndefined()
    expect(blobs.get('../store.sqlite')).toBeUndefined()
  })
})
