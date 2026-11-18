import { existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { folder, removeFolders } from '../../test/sessions.ts'
import { createWorkspace } from './workspace.ts'

afterEach(removeFolders)

const bytes = (text: string) => new TextEncoder().encode(text)

async function setup() {
  const root = realpathSync.native(folder())
  const workspace = await createWorkspace(join(root, 'workspace'))
  return { root, workspace, at: (...parts: string[]) => join(root, 'workspace', ...parts) }
}

describe('the assistant’s folder', () => {
  it('is made when missing, and lists what is in it with kinds, sizes and places', async () => {
    const { workspace, at } = await setup()
    mkdirSync(at('inbox'))
    writeFileSync(at('inbox', 'a.txt'), 'hello')
    writeFileSync(at('plan.md'), '# Plan')
    const top = await workspace.list('')
    expect(top?.map((item) => [item.path, item.kind, item.size])).toEqual(
      expect.arrayContaining([
        ['inbox', 'folder', 1],
        ['plan.md', 'file', 6]
      ])
    )
    const inbox = await workspace.list('inbox')
    expect(inbox).toEqual([expect.objectContaining({ path: 'inbox/a.txt', name: 'a.txt', location: at('inbox', 'a.txt') })])
  })

  it('reaches nothing outside itself, by a path or by a link inside it', async () => {
    const { root, workspace, at } = await setup()
    mkdirSync(join(root, 'secret'))
    writeFileSync(join(root, 'secret', 'key.txt'), 'key')
    expect(await workspace.list('../secret')).toBeUndefined()
    expect(await workspace.read({ path: '../secret/key.txt' }, 0, 10)).toBeUndefined()
    if (process.platform !== 'win32') {
      symlinkSync(join(root, 'secret'), at('away'))
      expect(await workspace.list('away')).toBeUndefined()
      expect(await workspace.read({ path: 'away/key.txt' }, 0, 10)).toBeUndefined()
    }
  })

  it('reads a file a piece at a time', async () => {
    const { workspace, at } = await setup()
    writeFileSync(at('notes.txt'), 'abcdefghij')
    const piece = await workspace.read({ path: 'notes.txt' }, 3, 4)
    expect(new TextDecoder().decode(piece?.bytes)).toBe('defg')
    expect(piece?.item.size).toBe(10)
    const end = await workspace.read({ path: 'notes.txt' }, 8, 100)
    expect(new TextDecoder().decode(end?.bytes)).toBe('ij')
  })

  it('reads a file elsewhere on the computer by where it is', async () => {
    const { root, workspace } = await setup()
    writeFileSync(join(root, 'elsewhere.txt'), 'there')
    const read = await workspace.read({ location: join(root, 'elsewhere.txt') }, 0, 100)
    expect(new TextDecoder().decode(read?.bytes)).toBe('there')
    expect(read?.item.path).toBe(join(root, 'elsewhere.txt'))
  })

  it('names a place inside it by its path, and none outside it', async () => {
    const { root, workspace, at } = await setup()
    expect(workspace.pathOf(at('inbox', 'a.txt'))).toBe('inbox/a.txt')
    expect(workspace.pathOf(at())).toBe('')
    expect(workspace.pathOf(join(root, 'elsewhere.txt'))).toBeUndefined()
    expect(workspace.pathOf(join(root, 'workspace-2', 'a.txt'))).toBeUndefined()
  })

  it('keeps a new file under its name, or the first free one like it, and never writes over one', async () => {
    const { workspace, at } = await setup()
    const first = await workspace.create('inbox/2026-11-18', 'photo.png')
    await first.write(bytes('one'))
    await first.close()
    const second = await workspace.create('inbox/2026-11-18', 'photo.png')
    await second.write(bytes('two'))
    const kept = await second.close()
    expect(first.path).toBe('inbox/2026-11-18/photo.png')
    expect(second.path).toBe('inbox/2026-11-18/photo (2).png')
    expect(kept).toMatchObject({ name: 'photo (2).png', size: 3, kind: 'file' })
    expect(readFileSync(at('inbox', '2026-11-18', 'photo.png'), 'utf8')).toBe('one')
  })

  it('removes a file left unfinished, and one taken back', async () => {
    const { workspace, at } = await setup()
    const left = await workspace.create('inbox', 'a.txt')
    await left.write(bytes('half'))
    await left.abort()
    expect(existsSync(at('inbox', 'a.txt'))).toBe(false)
    const kept = await workspace.create('inbox', 'b.txt')
    await kept.close()
    await workspace.remove('inbox/b.txt')
    expect(existsSync(at('inbox', 'b.txt'))).toBe(false)
  })

  it('makes no file outside itself', async () => {
    const { workspace } = await setup()
    await expect(workspace.create('../elsewhere', 'a.txt')).rejects.toThrow()
  })
})
