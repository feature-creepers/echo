import { posix as path } from 'node:path'

/** Where Claude Code is usually installed on macOS: by its own installer, by Homebrew, by npm or by Bun. */
export function installLocations(home: string): string[] {
  return [
    path.join(home, '.local', 'bin', 'claude'),
    path.join(home, '.claude', 'local', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    '/usr/bin/claude',
    path.join(home, '.npm-global', 'bin', 'claude'),
    path.join(home, '.bun', 'bin', 'claude')
  ]
}
