import { posix as path } from 'node:path'
import { gitSettings, programFolders } from './everywhere.ts'
import type { ComputerSystem } from './system.ts'

export const linux: ComputerSystem = {
  protectedPaths({ home, env }) {
    const config = env.XDG_CONFIG_HOME ?? path.join(home, '.config')
    return [
      { label: 'Chrome profiles', path: path.join(config, 'google-chrome') },
      { label: 'Chromium profiles', path: path.join(config, 'chromium') },
      { label: 'Edge profiles', path: path.join(config, 'microsoft-edge') },
      { label: 'Brave profiles', path: path.join(config, 'BraveSoftware', 'Brave-Browser') },
      { label: 'Firefox profiles', path: path.join(home, '.mozilla', 'firefox') },
      { label: '1Password data', path: path.join(config, '1Password') },
      { label: 'Bitwarden data', path: path.join(config, 'Bitwarden') },
      { label: 'Keyrings', path: path.join(home, '.local', 'share', 'keyrings') },
      { label: 'Password store', path: path.join(home, '.password-store') }
    ]
  },
  shellPath: (path) => path,
  caseless: false,
  watchesTrees: false,
  watchesLate: false,
  // Apps keep their data in folders whose name starts with a dot: `.config`, `.local`, `.cache`.
  appData: () => [],
  confines: true,
  caches({ home, env }) {
    return [
      env.XDG_CACHE_HOME ?? path.join(home, '.cache'),
      path.join(env.XDG_DATA_HOME ?? path.join(home, '.local', 'share'), 'pnpm'),
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
  },
  programs(where) {
    return [...programFolders(where.env.PATH, where, ':', path.isAbsolute), ...gitSettings(where, path.join)]
  }
}
