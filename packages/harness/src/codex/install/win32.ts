import { win32 as path } from 'node:path'
import type { Environment } from '../../process/environment.ts'

/** Where Codex is usually installed on Windows: by its own installer or by npm (a `.cmd` script). */
export function installLocations(home: string, env: Environment): string[] {
  const roaming = env.APPDATA ?? path.join(home, 'AppData', 'Roaming')
  const local = env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local')
  return [
    path.join(local, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'),
    path.join(roaming, 'npm', 'codex.cmd'),
    path.join(home, '.local', 'bin', 'codex.exe')
  ]
}
