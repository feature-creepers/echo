import { describe, expect, it } from 'vitest'
import { plan as darwin } from './darwin.ts'
import { plan as linux } from './linux.ts'
import { commandLine, quoteWord, words } from './unix.ts'
import { plan as win32 } from './win32.ts'

const signIn = { command: ['/home/ada/.local/bin/claude', 'auth', 'login'], title: 'Claude Code sign-in', variables: {} }
const elsewhere = { ...signIn, variables: { CLAUDE_CONFIG_DIR: '/home/ada/my claude' } }

describe('a command for a terminal on macOS and Linux', () => {
  it('quotes a word only when a shell would read it otherwise', () => {
    expect(quoteWord('/usr/bin/claude')).toBe('/usr/bin/claude')
    expect(quoteWord('my claude')).toBe("'my claude'")
    expect(quoteWord("it's")).toBe("'it'\\''s'")
    expect(quoteWord('')).toBe("''")
  })

  it('sets the variables the command needs in front of it', () => {
    expect(words(signIn)).toEqual(signIn.command)
    expect(words(elsewhere)).toEqual(['env', 'CLAUDE_CONFIG_DIR=/home/ada/my claude', ...signIn.command])
    expect(commandLine(elsewhere)).toBe("env 'CLAUDE_CONFIG_DIR=/home/ada/my claude' /home/ada/.local/bin/claude auth login")
  })
})

describe('opening a terminal on macOS', () => {
  it('tells Terminal to run the command and come to the front', () => {
    expect(darwin(signIn)).toEqual({
      file: 'osascript',
      args: ['-e', 'tell application "Terminal" to do script "/home/ada/.local/bin/claude auth login"\ntell application "Terminal" to activate']
    })
  })

  it('writes the command so that AppleScript reads it whole', () => {
    const script = darwin({ command: ['/Users/ada/a "b"\\c/claude', 'auth', 'login'], variables: {} }).args[1]
    expect(script).toContain(`do script "'/Users/ada/a \\"b\\"\\\\c/claude' auth login"`)
  })
})

describe('opening a terminal on Linux', () => {
  it('uses the first terminal program installed, the way that program takes a command', () => {
    const installed = (programs: string[]) => (program: string) => (programs.includes(program) ? `/usr/bin/${program}` : undefined)

    expect(linux(elsewhere, installed(['gnome-terminal', 'xterm']))).toEqual({
      file: '/usr/bin/gnome-terminal',
      args: ['--', 'env', 'CLAUDE_CONFIG_DIR=/home/ada/my claude', '/home/ada/.local/bin/claude', 'auth', 'login']
    })
    expect(linux(elsewhere, installed(['xterm']))).toEqual({
      file: '/usr/bin/xterm',
      args: ['-e', "env 'CLAUDE_CONFIG_DIR=/home/ada/my claude' /home/ada/.local/bin/claude auth login"]
    })
    expect(linux(signIn, installed(['kitty']))).toEqual({ file: '/usr/bin/kitty', args: signIn.command })
    expect(linux(signIn, installed(['x-terminal-emulator', 'konsole']))?.file).toBe('/usr/bin/x-terminal-emulator')
  })

  it('has nothing to start when no terminal program is installed', () => {
    expect(linux(signIn, () => undefined)).toBeUndefined()
  })
})

describe('opening a terminal on Windows', () => {
  it('opens a console that runs the command and stays open', () => {
    expect(win32({ command: ['C:\\Users\\Ada Lovelace\\.local\\bin\\claude.exe', 'auth', 'login'], title: 'Claude Code sign-in' })).toEqual({
      file: 'cmd.exe',
      args: ['/d', '/s', '/c', '"start "Claude Code sign-in" cmd.exe /k ""C:\\Users\\Ada Lovelace\\.local\\bin\\claude.exe" auth login""'],
      verbatim: true
    })
  })
})
