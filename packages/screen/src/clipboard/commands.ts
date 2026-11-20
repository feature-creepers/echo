import { POWERSHELL_UTF8, type Program, powershell } from '../program.ts'
import type { SystemName } from '../system-name.ts'

/**
 * How each system's clipboard is read and written, as programs to run: the same table on every system, so each is
 * tested anywhere. Text goes through standard input and output; Windows PowerShell reads and writes them in the
 * console's code page, so its text crosses as Base64 of UTF-8, which every character survives.
 */

export interface ClipboardProgram extends Program {
  /** How the text crosses: as it is, or as Base64 of its UTF-8. */
  encoding: 'utf8' | 'base64'
  /** Exit codes that mean the clipboard holds no text, not a failure. */
  empty?: number[]
  /** Said when the program is not installed, on Linux, where it must be. */
  missing?: string
}

interface ClipboardCommands {
  read: ClipboardProgram
  write: ClipboardProgram
}

const UTF8 = { LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' }
const NO_WAYLAND = 'This computer has no wl-clipboard: install it (wl-paste, wl-copy) to use the clipboard.'
const NO_X11 = 'This computer has no xclip: install it to use the clipboard.'

const WINDOWS_READ = powershell(
  "$text = Get-Clipboard -Raw; if ($null -eq $text) { $text = '' }; [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$text)))"
)
const WINDOWS_WRITE = powershell(`Set-Clipboard -Value (${POWERSHELL_UTF8.input})`)

/** The programs for a system; on Linux, Wayland's when the session is one, X11's otherwise. */
export function clipboardCommands(system: SystemName, env: Record<string, string | undefined> = {}): ClipboardCommands {
  switch (system) {
    case 'win32':
      return { read: { ...WINDOWS_READ, encoding: 'base64' }, write: { ...WINDOWS_WRITE, encoding: 'base64' } }
    case 'darwin':
      return {
        read: { command: 'pbpaste', args: [], encoding: 'utf8', env: UTF8 },
        write: { command: 'pbcopy', args: [], encoding: 'utf8', env: UTF8 }
      }
    case 'linux':
      return env.WAYLAND_DISPLAY
        ? {
            read: { command: 'wl-paste', args: ['--no-newline', '--type', 'text'], encoding: 'utf8', empty: [1], missing: NO_WAYLAND },
            write: { command: 'wl-copy', args: ['--type', 'text/plain;charset=utf-8'], encoding: 'utf8', missing: NO_WAYLAND }
          }
        : {
            read: { command: 'xclip', args: ['-selection', 'clipboard', '-out', '-target', 'UTF8_STRING'], encoding: 'utf8', empty: [1], missing: NO_X11 },
            write: { command: 'xclip', args: ['-selection', 'clipboard', '-in'], encoding: 'utf8', missing: NO_X11 }
          }
  }
}
