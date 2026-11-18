import { posix as path } from 'node:path'

/** Where Codex is usually installed on Linux: by its own installer or by npm. */
export function installLocations(home: string): string[] {
  return [path.join(home, '.local', 'bin', 'codex'), '/usr/local/bin/codex', '/usr/bin/codex', path.join(home, '.npm-global', 'bin', 'codex')]
}
