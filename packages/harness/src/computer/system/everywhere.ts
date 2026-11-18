import { join } from 'node:path'
import type { ProtectedPath } from '@repo/core'
import type { Where } from './system.ts'

/**
 * The folders of a search path that hold programs: absolute, and neither a root nor the home folder or one above
 * it, which a stray entry would otherwise open whole. `separator` is the system's, `;` or `:`.
 */
export function programFolders(searchPath: string | undefined, { home }: Where, separator: string, isAbsolute: (path: string) => boolean): string[] {
  const trimmed = (path: string) => path.replace(/[\\/]+$/, '')
  const above = (path: string) => {
    const folder = trimmed(path).toLowerCase()
    const own = trimmed(home).toLowerCase()
    return folder === '' || /^[a-z]:$/.test(folder) || own === folder || own.startsWith(`${folder}/`) || own.startsWith(`${folder}\\`)
  }
  const folders = (searchPath ?? '')
    .split(separator)
    .map((entry) => entry.trim().replace(/^"(.*)"$/, '$1'))
    .filter((entry) => entry !== '' && isAbsolute(entry) && !above(entry))
  return [...new Set(folders)]
}

/** The person's git settings, in the home folder and in the configuration folder of their programs, joined as the system does. */
export function gitSettings({ home, env }: Where, joined: (...parts: string[]) => string): string[] {
  return [joined(home, '.gitconfig'), joined(env.XDG_CONFIG_HOME ?? joined(home, '.config'), 'git')]
}

/** Keys and credentials every system keeps in the home folder, and password databases wherever they are. */
export function everywhere({ home }: Where): ProtectedPath[] {
  return [
    { label: 'SSH keys', path: join(home, '.ssh') },
    { label: 'GnuPG keys', path: join(home, '.gnupg') },
    { label: 'AWS credentials', path: join(home, '.aws') },
    { label: 'Azure credentials', path: join(home, '.azure') },
    { label: 'Kubernetes credentials', path: join(home, '.kube') },
    { label: 'Google Cloud credentials', path: join(home, '.config', 'gcloud') },
    { label: 'Docker credentials', path: join(home, '.docker', 'config.json') },
    { label: 'Network passwords', path: join(home, '.netrc') },
    { label: 'Git credentials', path: join(home, '.git-credentials') },
    { label: 'KeePass databases', ending: '.kdbx' },
    { label: 'KeePass databases', ending: '.kdb' },
    { label: '1Password vaults', ending: '.opvault' }
  ]
}
