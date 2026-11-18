import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createComputer } from './computer.ts'

const made: string[] = []
const folder = async () => {
  const path = await mkdtemp(join(tmpdir(), 'computer-'))
  made.push(path)
  return path
}
afterEach(async () => {
  for (const path of made.splice(0)) await rm(path, { recursive: true, force: true })
})

/** Wait for something the system reports in its own time, a few seconds at most. */
async function eventually(check: () => boolean): Promise<void> {
  for (let tries = 0; tries < 100 && !check(); tries++) await new Promise((resolve) => setTimeout(resolve, 30))
}

describe('watching a folder on this computer', () => {
  it('reports the path of a file written in it, and stops when told', async () => {
    const watched = await folder()
    const computer = await createComputer({ workspace: join(await folder(), 'workspace') })
    const seen: string[] = []
    const stop = computer.watch?.(watched, (paths) => seen.push(...paths))
    await writeFile(join(watched, 'report.pdf'), 'hello')
    await eventually(() => seen.includes(join(watched, 'report.pdf')))
    expect(seen).toContain(join(watched, 'report.pdf'))
    expect(await computer.fileAt?.(join(watched, 'report.pdf'))).toEqual({ size: 5 })
    stop?.()
  })

  it('describes no file where there is none, or a folder', async () => {
    const watched = await folder()
    const computer = await createComputer({ workspace: join(await folder(), 'workspace') })
    expect(await computer.fileAt?.(join(watched, 'missing.txt'))).toBeUndefined()
    expect(await computer.fileAt?.(watched)).toBeUndefined()
  })

  it('throws for a folder that is not there, for the core to say so', async () => {
    const computer = await createComputer({ workspace: join(await folder(), 'workspace') })
    expect(() => computer.watch?.(join(tmpdir(), 'no-such-folder-for-a-watch'), () => undefined)).toThrow()
  })
})
