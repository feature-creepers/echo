import { win32 as path } from 'node:path'
import { gitSettings, programFolders } from './everywhere.ts'
import type { ComputerSystem, Where } from './system.ts'

/** Windows' own folders under the profile, from its variables, or where they are by default. */
const folders = ({ home, env }: Where) => ({
  roaming: env.APPDATA ?? path.join(home, 'AppData', 'Roaming'),
  local: env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local')
})

export const win32: ComputerSystem = {
  protectedPaths(where) {
    const { roaming, local } = folders(where)
    return [
      { label: 'Chrome profiles', path: path.join(local, 'Google', 'Chrome', 'User Data') },
      { label: 'Edge profiles', path: path.join(local, 'Microsoft', 'Edge', 'User Data') },
      { label: 'Brave profiles', path: path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data') },
      { label: 'Firefox profiles', path: path.join(roaming, 'Mozilla', 'Firefox') },
      { label: 'Firefox profiles', path: path.join(local, 'Mozilla', 'Firefox') },
      { label: 'Windows credentials', path: path.join(roaming, 'Microsoft', 'Credentials') },
      { label: 'Windows credentials', path: path.join(local, 'Microsoft', 'Credentials') },
      { label: 'Windows data protection keys', path: path.join(roaming, 'Microsoft', 'Protect') },
      { label: '1Password data', path: path.join(local, '1Password') },
      { label: 'Bitwarden data', path: path.join(roaming, 'Bitwarden') },
      { label: 'Google Cloud credentials', path: path.join(roaming, 'gcloud') },
      { label: 'Network passwords', path: path.join(where.home, '_netrc') }
    ]
  },
  shellPath(path) {
    // Git Bash writes a drive as a folder at the root: `/c/Users/me`, or `/cygdrive/c/Users/me`.
    const drive = /^\/(?:cygdrive\/)?([A-Za-z])(\/.*)?$/.exec(path)
    if (!drive) return path
    return `${(drive[1] as string).toUpperCase()}:\\${(drive[2] ?? '').slice(1).replace(/\//g, '\\')}`
  },
  caseless: true,
  // Claude Code has no sandbox on Windows itself, only inside WSL2.
  confines: false,
  // Where package managers keep what they download, for a command confined by another program's sandbox (Codex's).
  caches(where) {
    const { home, env } = where
    const { local } = folders(where)
    return [
      path.join(local, 'npm-cache'),
      path.join(local, 'pnpm'),
      path.join(local, 'pnpm-cache'),
      path.join(local, 'pnpm-state'),
      path.join(local, 'Yarn'),
      path.join(local, 'pip'),
      path.join(local, 'uv'),
      path.join(local, 'node-gyp'),
      path.join(home, '.cache'),
      path.join(home, '.bun'),
      path.join(home, '.cargo', 'registry'),
      path.join(home, '.cargo', 'git'),
      path.join(home, 'go', 'pkg'),
      path.join(home, '.nuget', 'packages'),
      path.join(home, '.gradle', 'caches'),
      path.join(home, '.m2', 'repository'),
      env.TEMP ?? path.join(local, 'Temp')
    ]
  },
  programs(where) {
    // Windows names the search path `Path`, and a copy of the environment may keep either spelling.
    const searchPath = where.env.Path ?? where.env.PATH ?? where.env.path
    return [...programFolders(searchPath, where, ';', path.isAbsolute), ...gitSettings({ ...where, env: {} }, path.join)]
  }
}
