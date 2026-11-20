import { describe, expect, it } from 'vitest'
import { readMarkedPath, unix } from './unix.ts'
import { quoteArgument, win32 } from './win32.ts'

describe('starting a program on macOS and Linux', () => {
  it('reads the search path out of what a login shell prints around it', () => {
    expect(readMarkedPath('Welcome back!\n__SEARCH_PATH__/usr/bin:/home/ada/.local/bin__SEARCH_PATH__\nbye\n')).toBe('/usr/bin:/home/ada/.local/bin')
    expect(readMarkedPath('__SEARCH_PATH____SEARCH_PATH__')).toBeUndefined()
    expect(readMarkedPath('no mark at all')).toBeUndefined()
  })

  it.skipIf(process.platform === 'win32')('asks the shell for the search path the user has in a terminal', async () => {
    expect(await unix.loginPath({ ...process.env, SHELL: '/bin/sh' })).toMatch(/\//)
  })

  it.skipIf(process.platform === 'win32')('goes on without it when the shell cannot be asked', async () => {
    expect(await unix.loginPath({ SHELL: '/nowhere/shell' })).toBeUndefined()
  })

  it('starts a program as it is', () => {
    expect(unix.invocation('/usr/bin/claude', ['--tools', '', 'a b'])).toEqual({ file: '/usr/bin/claude', args: ['--tools', '', 'a b'], shell: false })
    expect(unix.fileNames('claude', {})).toEqual(['claude'])
  })

  it('reads the home folder and the search path from the environment', () => {
    expect(unix.home({ HOME: '/home/ada' })).toBe('/home/ada')
    expect(unix.searchPath({ PATH: '/a:/b' })).toBe('/a:/b')
    expect(unix.withSearchPath({ PATH: '/a', OTHER: '1' }, '/b')).toEqual({ PATH: '/b', OTHER: '1' })
    expect(unix.usualFolders('/home/ada')).toContain('/home/ada/.local/bin')
  })
})

describe('starting a program on Windows', () => {
  it('starts a program file as it is', () => {
    expect(win32.invocation('C:\\Users\\Ada\\.local\\bin\\claude.exe', ['--tools', ''])).toEqual({
      file: 'C:\\Users\\Ada\\.local\\bin\\claude.exe',
      args: ['--tools', ''],
      shell: false
    })
  })

  it('starts a script through the command interpreter, quoted so that each argument arrives whole', () => {
    expect(win32.invocation('C:\\Users\\Ada Lovelace\\AppData\\Roaming\\npm\\claude.cmd', ['--tools', '', '--model', 'haiku'])).toEqual({
      file: '"C:\\Users\\Ada Lovelace\\AppData\\Roaming\\npm\\claude.cmd"',
      args: ['--tools', '""', '--model', 'haiku'],
      shell: true
    })
    expect(win32.invocation('C:\\tools\\codex.BAT', []).shell).toBe(true)
  })

  it('quotes an argument only when the command interpreter would read it otherwise', () => {
    expect(quoteArgument('--strict-mcp-config')).toBe('--strict-mcp-config')
    expect(quoteArgument('C:\\Users\\Ada\\x.txt')).toBe('C:\\Users\\Ada\\x.txt')
    expect(quoteArgument('')).toBe('""')
    expect(quoteArgument('C:\\Users\\Ada Lovelace\\x.txt')).toBe('"C:\\Users\\Ada Lovelace\\x.txt"')
    expect(quoteArgument('a&b')).toBe('"a&b"')
    expect(quoteArgument('C:\\Users\\Ada (work)\\x.txt')).toBe('"C:\\Users\\Ada (work)\\x.txt"')
    expect(quoteArgument('model_instructions_file="C:/x.txt"')).toBe('"model_instructions_file=""C:/x.txt"""')
  })

  it('keeps the backslashes before a quote, which the program would otherwise read as escaping it', () => {
    expect(quoteArgument('C:\\Users\\Ada Lovelace\\')).toBe('"C:\\Users\\Ada Lovelace\\\\"')
    expect(quoteArgument('mcp_servers."a \\"b\\"".enabled=false')).toBe('"mcp_servers.""a \\\\""b\\\\"""".enabled=false"')
    expect(quoteArgument('C:\\Users\\Ada\\')).toBe('C:\\Users\\Ada\\')
  })

  it('tries each extension Windows runs, in its order', () => {
    expect(win32.fileNames('claude', { PATHEXT: '.COM;.EXE;.BAT;.CMD' })).toEqual(['claude.com', 'claude.exe', 'claude.bat', 'claude.cmd'])
    expect(win32.fileNames('claude', {})).toEqual(['claude.com', 'claude.exe', 'claude.bat', 'claude.cmd'])
    // Scripts for other hosts are named by PATHEXT too, and cannot be started as a program.
    expect(win32.fileNames('claude', { PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.JS;.PY;.PS1' })).toEqual(['claude.com', 'claude.exe', 'claude.bat', 'claude.cmd'])
  })

  it('reads variables whatever the case of their names', () => {
    expect(win32.searchPath({ Path: 'C:\\Windows;C:\\Tools' })).toBe('C:\\Windows;C:\\Tools')
    expect(win32.home({ UserProfile: 'C:\\Users\\Ada' })).toBe('C:\\Users\\Ada')
    expect(win32.withSearchPath({ Path: 'C:\\Windows' }, 'C:\\Tools')).toEqual({ Path: 'C:\\Tools' })
    expect(win32.withSearchPath({}, 'C:\\Tools')).toEqual({ Path: 'C:\\Tools' })
  })

  it('has the same search path from the desktop as from a terminal', async () => {
    expect(await win32.loginPath({})).toBeUndefined()
    expect(win32.usualFolders('C:\\Users\\Ada')).toEqual([])
  })
})
