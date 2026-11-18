import { posix as path } from 'node:path'
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
  caseless: false
}
