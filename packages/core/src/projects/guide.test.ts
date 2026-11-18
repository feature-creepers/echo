import { describe, expect, it } from 'vitest'
import { GUIDE_LIMIT, guideText, readGuide } from './guide.ts'

const encoder = new TextEncoder()

/** A computer holding these files, by path, and links from one path to another, followed as the system does. */
function holding(files: Record<string, string | 'too-large'>, links: Record<string, string> = {}) {
  return {
    locate: async (path: string) => {
      const real = links[path] ?? path
      return files[real] === undefined ? undefined : { path: real, kind: 'file' as const }
    },
    read: async (path: string) => {
      const text = files[path]
      return text === undefined ? undefined : text === 'too-large' ? ('too-large' as const) : encoder.encode(text)
    }
  }
}

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

  it('follows a link inside the project, and never one that leads out of it', async () => {
    const files = { '/p/docs/agents.md': 'Rules.', '/home/ada/.ssh/id_ed25519': 'PRIVATE KEY' }
    expect((await readGuide(holding(files, { '/p/AGENTS.md': '/p/docs/agents.md' }), '/p'))?.files).toEqual([{ name: 'AGENTS.md', text: 'Rules.' }])
    expect(await readGuide(holding(files, { '/p/AGENTS.md': '/home/ada/.ssh/id_ed25519' }), '/p')).toBeUndefined()
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
