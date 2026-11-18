/**
 * How each system's clipboard is read and written, as programs to run: the same table on every system, so each is
 * tested anywhere. Text goes through standard input and output; Windows PowerShell reads and writes them in the
 * console's code page, so its text crosses as Base64 of UTF-8, which every character survives.
 */

export type ClipboardSystem = 'win32' | 'darwin' | 'linux'

export interface ClipboardProgram {
  command: string
  args: string[]
  /** How the text crosses: as it is, or as Base64 of its UTF-8. */
  encoding: 'utf8' | 'base64'
  /** Variables the program needs on top of those it inherits. */
  env?: Record<string, string>
  /** Exit codes that mean the clipboard holds no text, not a failure. */
  empty?: number[]
}

export interface ClipboardCommands {
  read: ClipboardProgram
  write: ClipboardProgram
}

const POWERSHELL = ['-NoProfile', '-NonInteractive', '-Command']
const UTF8 = { LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' }

const WINDOWS_READ =
  "$text = Get-Clipboard -Raw; if ($null -eq $text) { $text = '' }; [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$text)))"
const WINDOWS_WRITE = 'Set-Clipboard -Value ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())))'

/** The programs for a system; on Linux, Wayland's when the session is one, X11's otherwise. */
export function clipboardCommands(system: ClipboardSystem, env: Record<string, string | undefined> = {}): ClipboardCommands {
  switch (system) {
    case 'win32':
      return {
        read: { command: 'powershell.exe', args: [...POWERSHELL, WINDOWS_READ], encoding: 'base64' },
        write: { command: 'powershell.exe', args: [...POWERSHELL, WINDOWS_WRITE], encoding: 'base64' }
      }
    case 'darwin':
      return {
        read: { command: 'pbpaste', args: [], encoding: 'utf8', env: UTF8 },
        write: { command: 'pbcopy', args: [], encoding: 'utf8', env: UTF8 }
      }
    case 'linux':
      return env.WAYLAND_DISPLAY
        ? {
            read: { command: 'wl-paste', args: ['--no-newline', '--type', 'text'], encoding: 'utf8', empty: [1] },
            write: { command: 'wl-copy', args: ['--type', 'text/plain;charset=utf-8'], encoding: 'utf8' }
          }
        : {
            read: { command: 'xclip', args: ['-selection', 'clipboard', '-out', '-target', 'UTF8_STRING'], encoding: 'utf8', empty: [1] },
            write: { command: 'xclip', args: ['-selection', 'clipboard', '-in'], encoding: 'utf8' }
          }
  }
}
