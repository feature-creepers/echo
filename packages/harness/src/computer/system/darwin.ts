import { posix as path } from 'node:path'
import type { ComputerSystem } from './system.ts'

export const darwin: ComputerSystem = {
  protectedPaths({ home }) {
    const support = path.join(home, 'Library', 'Application Support')
    return [
      { label: 'Chrome profiles', path: path.join(support, 'Google', 'Chrome') },
      { label: 'Edge profiles', path: path.join(support, 'Microsoft Edge') },
      { label: 'Brave profiles', path: path.join(support, 'BraveSoftware', 'Brave-Browser') },
      { label: 'Firefox profiles', path: path.join(support, 'Firefox') },
      { label: 'Keychains', path: path.join(home, 'Library', 'Keychains') },
      { label: '1Password data', path: path.join(home, 'Library', 'Group Containers', '2BUA8C4S2C.com.1password') },
      { label: '1Password data', path: path.join(support, '1Password') },
      { label: 'Bitwarden data', path: path.join(support, 'Bitwarden') },
      { label: 'Bitwarden data', path: path.join(home, 'Library', 'Containers', 'com.bitwarden.desktop') }
    ]
  },
  shellPath: (path) => path,
  caseless: true,
  confines: true,
  caches({ home, env }) {
    return [
      path.join(home, 'Library', 'Caches'),
      path.join(home, 'Library', 'pnpm'),
      path.join(home, '.cache'),
      path.join(home, '.npm'),
      path.join(home, '.yarn'),
      path.join(home, '.bun'),
      path.join(home, '.cargo', 'registry'),
      path.join(home, '.cargo', 'git'),
      path.join(home, 'go', 'pkg'),
      path.join(home, '.gradle', 'caches'),
      path.join(home, '.m2', 'repository'),
      env.TMPDIR ?? '/tmp'
    ]
  }
}
