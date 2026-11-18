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
  caseless: true
}
