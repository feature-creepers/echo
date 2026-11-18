import { join } from 'node:path'
import type { ProtectedPath } from '@repo/core'
import type { Where } from './system.ts'

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
