import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { selfCheckFolder } from './scratch.ts'

const HOUR_S = 60 * 60

describe('the folder of a self-check', () => {
  let temporary: string
  afterEach(() => rmSync(temporary, { recursive: true, force: true }))

  it.each<[name: string, kind: 'folder' | 'file', ageSeconds: number, kept: boolean]>([
    ['self-check-old', 'folder', 2 * HOUR_S, false],
    ['self-check-running', 'folder', 60, true],
    ['self-check-a-file', 'file', 2 * HOUR_S, true],
    ['someone-else', 'folder', 2 * HOUR_S, true]
  ])('%s, a %s %d seconds old, is kept: %s', (name, kind, ageSeconds, kept) => {
    temporary = mkdtempSync(join(tmpdir(), 'scratch-test-'))
    const path = join(temporary, name)
    if (kind === 'folder') {
      mkdirSync(path)
      writeFileSync(join(path, 'Local State'), '{}')
    } else writeFileSync(path, '')
    const then = Date.now() / 1000 - ageSeconds
    utimesSync(path, then, then)

    const made = selfCheckFolder(temporary)

    expect(existsSync(path)).toBe(kept)
    expect(basename(made)).toMatch(/^self-check-/)
    expect(existsSync(made)).toBe(true)
  })
})
