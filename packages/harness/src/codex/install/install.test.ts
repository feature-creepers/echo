import { describe, expect, it } from 'vitest'
import { unix as sandboxOnUnix } from '../sandbox/unix.ts'
import { win32 as sandboxOnWin32 } from '../sandbox/win32.ts'
import { installLocations as darwin } from './darwin.ts'
import { installLocations as linux } from './linux.ts'
import { installLocations as win32 } from './win32.ts'

/** Each system's file is checked on every system: only one of them is used for real where the tests run. */
describe('where Codex is usually installed', () => {
  it('is under the user’s home first on Linux, then in the system’s folders', () => {
    expect(linux('/home/ada')).toEqual(['/home/ada/.local/bin/codex', '/usr/local/bin/codex', '/usr/bin/codex', '/home/ada/.npm-global/bin/codex'])
  })

  it('includes its desktop app and Homebrew on macOS', () => {
    expect(darwin('/Users/ada')).toEqual(expect.arrayContaining(['/opt/homebrew/bin/codex', '/Applications/Codex.app/Contents/Resources/codex']))
  })

  it('is where Windows says the user’s program folders are', () => {
    expect(win32('C:\\Users\\Ada', { APPDATA: 'D:\\Roaming', LOCALAPPDATA: 'D:\\Local' })).toEqual([
      'D:\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe',
      'D:\\Roaming\\npm\\codex.cmd',
      'C:\\Users\\Ada\\.local\\bin\\codex.exe'
    ])
    expect(win32('C:\\Users\\Ada', {})).toContain('C:\\Users\\Ada\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe')
  })
})

describe('the sandbox Codex runs in', () => {
  it('needs a setting on Windows only', () => {
    expect(sandboxOnUnix.server).toEqual([])
    expect(sandboxOnWin32.server).toEqual(['-c', 'windows.sandbox="unelevated"'])
  })

  it('holds a profile in Windows’ process isolation, and in the system’s own sandbox elsewhere', () => {
    expect(sandboxOnWin32.confined).toEqual({ windows: { sandbox: 'mxc' } })
    expect(sandboxOnUnix.confined).toEqual({})
  })
})
