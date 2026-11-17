import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Role } from '@repo/core'
import type { Environment } from '../process/environment.ts'
import { asArray, asObject, asString } from '../process/json.ts'
import { platform } from '../process/platform/index.ts'

/** Codex's models when its own list cannot be read, its workhorse first. */
export const CODEX_MODELS = ['gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna']

/** The small, fast model, for the roles where speed or cost matters more than depth. */
const FAST_MODEL = 'gpt-6-luna'

/** The folder where Codex keeps the user's settings, sign-in and list of models. */
export function codexHome(env: Environment): string {
  return env.CODEX_HOME || join(platform.home(env), '.codex')
}

/** The models Codex offers this user, from the list the CLI keeps up to date itself, its workhorse first. */
export async function listedModels(home: string): Promise<string[]> {
  try {
    const cache = asObject(JSON.parse(await readFile(join(home, 'models_cache.json'), 'utf8')))
    const listed = asArray(cache?.models)
      .map(asObject)
      .filter((model) => model?.visibility === 'list')
      .map((model) => asString(model?.slug))
      .filter((slug): slug is string => slug !== undefined && slug !== '')
    if (listed.length > 0) return listed
  } catch {
    // Codex has not written its list yet, or writes it another way now.
  }
  return CODEX_MODELS
}

/**
 * The model each role runs on: what the user chose, else Codex's workhorse for threads and its fast model
 * for the rest. An account that is not offered the fast model gets the workhorse everywhere.
 */
export async function codexModels(home: string, chosen: Partial<Record<Role, string>> = {}): Promise<Record<Role, string>> {
  const listed = await listedModels(home)
  const strong = listed[0] ?? FAST_MODEL
  const fast = listed.includes(FAST_MODEL) ? FAST_MODEL : strong
  return { orchestrator: fast, thread: strong, utility: fast, ...chosen }
}
