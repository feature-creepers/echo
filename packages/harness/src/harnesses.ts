import { join } from 'node:path'
import type { Harness, Log, Role } from '@repo/core'
import { CLAUDE_CODE_ID, createClaudeCode } from './claude-code/adapter.ts'
import { CODEX_ID, createCodex } from './codex/adapter.ts'

export interface HarnessesOptions {
  /** A folder the harnesses own. Each works in a folder of its own inside it. Created when missing. */
  folder: string
  log: Log
  /** The model a role runs on, where a harness's own choice is not wanted, by the harness's `id`. Model names differ from one harness to the next. */
  models?: Partial<Record<string, Partial<Record<Role, string>>>>
}

/** Every harness this package drives, whether or not it is installed on this machine: `status()` tells. */
export function createHarnesses(options: HarnessesOptions): Harness[] {
  const { folder, log } = options
  const chosen = (id: string) => {
    const models = options.models?.[id]
    return models ? { models } : {}
  }
  return [
    createClaudeCode({ folder: join(folder, CLAUDE_CODE_ID), log, ...chosen(CLAUDE_CODE_ID) }),
    createCodex({ folder: join(folder, CODEX_ID), log, ...chosen(CODEX_ID) })
  ]
}
