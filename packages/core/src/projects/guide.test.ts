import { describe, expect, it } from 'vitest'
import { folderName, GUIDE_LIMIT, guideText, inFolder, readGuide } from './guide.ts'

const encoder = new TextEncoder()

/** A computer holding these files, by path. */
function holding(files: Record<string, string | 'too-large'>) {
  return {
    read: async (path: string) => {
      const text = files[path]
      return text === undefined ? undefined : text === 'too-large' ? ('too-large' as const) : encoder.encode(text)
    }
  }
}

describe('inFolder and folderName', () => {
  it.each([
    ['/home/ada/echo', 'AGENTS.md', '/home/ada/echo/AGENTS.md'],
    ['/home/ada/echo/', 'AGENTS.md', '/home/ada/echo/AGENTS.md'],
    ['C:\\dev\\echo', 'AGENTS.md', 'C:\\dev\\echo\\AGENTS.md'],
    ['C:\\dev\\echo\\', 'CLAUDE.md', 'C:\\dev\\echo\\CLAUDE.md']
  ])('puts %s and %s together as %s', (folder, name, path) => {
    expect(inFolder(folder, name)).toBe(path)
  })

  it.each([
    ['/home/ada/echo', 'echo'],
    ['/home/ada/echo/', 'echo'],
    ['C:\\dev\\my project', 'my project']
  ])('names %s %s', (folder, name) => {
    expect(folderName(folder)).toBe(name)
  })
})

describe('readGuide', () => {
  it('reads AGENTS.md, then CLAUDE.md, in that order', async () => {
    const guide = await readGuide(holding({ '/p/CLAUDE.md': 'Use pnpm.', '/p/AGENTS.md': '\uFEFF# Rules\nRun the checks.\n' }), '/p')
    expect(guide).toEqual({
      files: [
        { name: 'AGENTS.md', text: '# Rules\nRun the checks.' },
        { name: 'CLAUDE.md', text: 'Use pnpm.' }
      ],
      cut: false
    })
  })

  it('leaves out a CLAUDE.md that only points at the AGENTS.md already read', async () => {
    const guide = await readGuide(holding({ '/p/AGENTS.md': 'Rules.', '/p/CLAUDE.md': '@AGENTS.md\n' }), '/p')
    expect(guide?.files.map((file) => file.name)).toEqual(['AGENTS.md'])
  })

  it('keeps a CLAUDE.md that points at a file it did not read', async () => {
    const guide = await readGuide(holding({ '/p/CLAUDE.md': '@docs/rules.md' }), '/p')
    expect(guide?.files).toEqual([{ name: 'CLAUDE.md', text: '@docs/rules.md' }])
  })

  it('gives nothing for a folder with no instructions, or empty ones', async () => {
    expect(await readGuide(holding({}), '/p')).toBeUndefined()
    expect(await readGuide(holding({ '/p/AGENTS.md': '  \n' }), '/p')).toBeUndefined()
  })

  it('cuts what is too long, and says so', async () => {
    const long = 'x'.repeat(GUIDE_LIMIT + 10)
    const guide = await readGuide(holding({ '/p/AGENTS.md': long, '/p/CLAUDE.md': 'More.' }), '/p')
    expect(guide?.cut).toBe(true)
    expect(guide?.files).toHaveLength(1)
    expect(guide?.files[0]?.text).toHaveLength(GUIDE_LIMIT)
    expect(await readGuide(holding({ '/p/AGENTS.md': 'too-large' }), '/p')).toEqual({ files: [], cut: true })
  })

  it('reads a Windows folder with its own separator', async () => {
    const guide = await readGuide(holding({ 'C:\\dev\\echo\\AGENTS.md': 'Rules.' }), 'C:\\dev\\echo')
    expect(guide?.files[0]?.name).toBe('AGENTS.md')
  })
})

describe('guideText', () => {
  it('frames the files as the project’s, below what the person decides', () => {
    const text = guideText({ files: [{ name: 'AGENTS.md', text: 'Run pnpm check.' }], cut: true })
    expect(text).toContain('--- AGENTS.md\nRun pnpm check.')
    expect(text).toContain('do not change who you are')
    expect(text).toContain('read the rest with your tools')
  })
})
