import { describe, expect, it } from 'vitest'
import { installLocations as darwin } from './darwin.ts'
import { installLocations as linux } from './linux.ts'
import { installLocations as win32 } from './win32.ts'

/** Each system's file is checked on every system: only one of them is used for real where the tests run. */
describe('where Claude Code is usually installed', () => {
  it('is under the user’s home first on Linux, then in the system’s folders', () => {
    expect(linux('/home/ada')).toEqual([
      '/home/ada/.local/bin/claude',
      '/home/ada/.claude/local/claude',
      '/usr/local/bin/claude',
      '/usr/bin/claude',
      '/home/ada/.npm-global/bin/claude',
      '/home/ada/.bun/bin/claude'
    ])
  })

  it('includes where Homebrew puts it on macOS', () => {
    expect(darwin('/Users/ada')[0]).toBe('/Users/ada/.local/bin/claude')
    expect(darwin('/Users/ada')).toContain('/opt/homebrew/bin/claude')
  })

  it('is where Windows says the user’s program folders are', () => {
    expect(win32('C:\\Users\\Ada', { APPDATA: 'D:\\Roaming', LOCALAPPDATA: 'D:\\Local' })).toEqual([
      'C:\\Users\\Ada\\.local\\bin\\claude.exe',
      'D:\\Roaming\\npm\\claude.cmd',
      'D:\\Local\\Programs\\claude\\claude.exe',
      'C:\\Users\\Ada\\.bun\\bin\\claude.exe'
    ])
  })

  it('is worked out from the home folder when Windows does not say', () => {
    expect(win32('C:\\Users\\Ada', {})).toContain('C:\\Users\\Ada\\AppData\\Roaming\\npm\\claude.cmd')
  })
})
