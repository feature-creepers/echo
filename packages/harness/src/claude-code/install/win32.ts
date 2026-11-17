import { win32 as path } from 'node:path'
import type { Environment } from '../../process/environment.ts'

/** Where Claude Code is usually installed on Windows: by its own installer, by npm (a `.cmd` script) or by Bun. */
export function installLocations(home: string, env: Environment): string[] {
  const roaming = env.APPDATA ?? path.join(home, 'AppData', 'Roaming')
  const local = env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local')
  return [
    path.join(home, '.local', 'bin', 'claude.exe'),
    path.join(roaming, 'npm', 'claude.cmd'),
    path.join(local, 'Programs', 'claude', 'claude.exe'),
    path.join(home, '.bun', 'bin', 'claude.exe')
  ]
}
