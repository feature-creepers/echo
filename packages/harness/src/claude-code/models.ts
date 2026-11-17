import type { Role } from '@repo/core'

/**
 * The model each role runs on unless the user chose otherwise. These are the CLI's own aliases, which
 * follow the newest model of each size, so nothing here names a version that will age.
 */
export const CLAUDE_CODE_MODELS: Record<Role, string> = {
  orchestrator: 'haiku',
  thread: 'sonnet',
  utility: 'haiku'
}
