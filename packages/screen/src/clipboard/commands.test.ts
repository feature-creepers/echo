import { describe, expect, it } from 'vitest'
import { clipboardCommands } from './commands.ts'

describe('the clipboard on each system', () => {
  it.each([
    ['win32', {}, 'powershell.exe', 'powershell.exe', 'base64'],
    ['darwin', {}, 'pbpaste', 'pbcopy', 'utf8'],
    ['linux', { WAYLAND_DISPLAY: 'wayland-0' }, 'wl-paste', 'wl-copy', 'utf8'],
    ['linux', { DISPLAY: ':0' }, 'xclip', 'xclip', 'utf8']
  ] as const)('on %s %j, reads with %s and writes with %s', (system, env, reader, writer, encoding) => {
    const { read, write } = clipboardCommands(system, env)
    expect([read.command, write.command, read.encoding, write.encoding]).toEqual([reader, writer, encoding, encoding])
  })

  it('reads an empty clipboard on Linux as no text, not a failure', () => {
    expect(clipboardCommands('linux', { WAYLAND_DISPLAY: 'w' }).read.empty).toEqual([1])
    expect(clipboardCommands('linux', {}).read.empty).toEqual([1])
  })
})
