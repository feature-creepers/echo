import { posix as path } from 'node:path'

/** Where Codex is usually installed on macOS: by its own installer, by Homebrew, inside its desktop app, or by npm. */
export function installLocations(home: string): string[] {
  return [
    path.join(home, '.local', 'bin', 'codex'),
    '/opt/homebrew/bin/codex',
    '/Applications/Codex.app/Contents/Resources/codex',
    '/usr/local/bin/codex',
    '/usr/bin/codex',
    path.join(home, '.npm-global', 'bin', 'codex')
  ]
}
