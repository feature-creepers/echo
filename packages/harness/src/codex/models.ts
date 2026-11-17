import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HarnessModel, HarnessModels, Role } from '@repo/core'
import type { Environment } from '../process/environment.ts'
import { asArray, asObject, asString } from '../process/json.ts'
import { platform } from '../process/platform/index.ts'

/** Codex's models when its own list cannot be read, its most capable first. */
export const CODEX_MODELS = ['gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna']

/** The small, fast model, for the roles where speed or cost matters more than depth. */
const FAST_MODEL = 'gpt-6-luna'

/**
 * What each family of Codex models is good for, in plain words. Codex's own descriptions are written for
 * programmers; a family not here keeps the one Codex gives.
 */
const FAMILIES: { family: string; description: string }[] = [
  { family: 'terra', description: 'Balanced: quick, and thorough enough for most of what you ask.' },
  { family: 'luna', description: 'The fastest and lightest. Fine for short questions.' },
  { family: 'sol', description: 'The most capable, for hard problems. Slower, and uses more of your plan.' }
]

/** The family the assistant answers with by default: balanced, and inexpensive enough to talk to all day. */
const DEFAULT_FAMILY = 'terra'

/** The folder where Codex keeps the user's settings, sign-in and list of models. */
export function codexHome(env: Environment): string {
  return env.CODEX_HOME || join(platform.home(env), '.codex')
}

/** A model's name as a person reads it, from its identifier: "gpt-6.1-terra" is "GPT-6.1 Terra". */
export function modelName(slug: string): string {
  const words = slug.split('-').filter((word) => word !== '')
  const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)
  if (words[0]?.toLowerCase() === 'gpt' && words[1] !== undefined) return [`GPT-${words[1]}`, ...words.slice(2).map(capital)].join(' ')
  return words.map(capital).join(' ')
}

function describe(slug: string, given: string | undefined): string {
  const known = FAMILIES.find(({ family }) => slug.includes(family))
  return known?.description ?? given ?? 'Offered by Codex for your account.'
}

/** The models Codex offers this user, from the list the CLI keeps up to date itself, in its order. */
export async function listedModels(home: string): Promise<HarnessModel[]> {
  try {
    const cache = asObject(JSON.parse(await readFile(join(home, 'models_cache.json'), 'utf8')))
    const listed = asArray(cache?.models)
      .map(asObject)
      .filter((model) => model?.visibility === 'list')
      .flatMap((model) => {
        const slug = asString(model?.slug)
        if (slug === undefined || slug === '') return []
        const shown = asString(model?.display_name)
        const name = shown && shown !== slug ? shown : modelName(slug)
        return [{ id: slug, name, description: describe(slug, asString(model?.description)) }]
      })
    if (listed.length > 0) return listed
  } catch {
    // Codex has not written its list yet, or writes it another way now.
  }
  return CODEX_MODELS.map((slug) => ({ id: slug, name: modelName(slug), description: describe(slug, undefined) }))
}

/** The models the user can choose from for the answers, and the balanced one as the default, else Codex's first. */
export async function codexChoices(home: string): Promise<HarnessModels> {
  const models = await listedModels(home)
  const preferred = models.find((model) => model.id.includes(DEFAULT_FAMILY)) ?? models[0]
  return { models, default: preferred?.id ?? FAST_MODEL }
}

/**
 * The model each role runs on: what was chosen, else the balanced model for threads and the fast one for the
 * rest. An account that is not offered the fast model gets the threads' model everywhere.
 */
export async function codexModels(home: string, chosen: Partial<Record<Role, string>> = {}): Promise<Record<Role, string>> {
  const { models, default: answering } = await codexChoices(home)
  const fast = models.some((model) => model.id === FAST_MODEL) ? FAST_MODEL : answering
  return { orchestrator: fast, thread: answering, utility: fast, ...chosen }
}
