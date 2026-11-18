import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HarnessEffort, HarnessModel, HarnessModels, Role } from '@repo/core'
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

/** The levels of reasoning Codex names, in plain words. A level not here keeps the words Codex gives. */
const LEVELS: Record<string, { name: string; description: string }> = {
  none: { name: 'None', description: 'Answers at once, without thinking first.' },
  minimal: { name: 'Minimal', description: 'Barely thinks before answering. Quickest.' },
  low: { name: 'Low', description: 'Answers quickly, thinking little first.' },
  medium: { name: 'Medium', description: 'Some thought before answering.' },
  high: { name: 'High', description: 'Thinks things through. Slower, uses more of your plan.' },
  xhigh: { name: 'Extra high', description: 'As deep as it goes, for hard problems. Slowest.' }
}

/** The levels offered when Codex has not written its list, and the one it uses by default. */
const USUAL_LEVELS = ['low', 'medium', 'high', 'xhigh']
const USUAL_LEVEL = 'medium'

/** A level as Codex names it: lower-case letters, which also keeps it safe to hand back to Codex in its settings. */
const LEVEL = /^[a-z]{1,32}$/

function level(id: string, given?: string): HarnessEffort {
  const known = LEVELS[id]
  return { id, name: known?.name ?? id.charAt(0).toUpperCase() + id.slice(1), description: known?.description ?? given ?? '' }
}

/** The levels a model of Codex's list offers, from `supported_reasoning_levels`, and its default. */
function levelsOf(model: Record<string, unknown> | undefined): Pick<HarnessModel, 'efforts' | 'defaultEffort'> {
  const efforts = asArray(model?.supported_reasoning_levels)
    .map(asObject)
    .flatMap((one) => {
      const id = asString(one?.effort)
      return id !== undefined && LEVEL.test(id) ? [level(id, asString(one?.description))] : []
    })
  if (efforts.length === 0) return {}
  const fallback = asString(model?.default_reasoning_level)
  return { efforts, ...(fallback !== undefined && efforts.some((one) => one.id === fallback) ? { defaultEffort: fallback } : {}) }
}

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
        return [{ id: slug, name, description: describe(slug, asString(model?.description)), ...levelsOf(model) }]
      })
    if (listed.length > 0) return listed
  } catch {
    // Codex has not written its list yet, or writes it another way now.
  }
  return CODEX_MODELS.map((slug) => ({
    id: slug,
    name: modelName(slug),
    description: describe(slug, undefined),
    efforts: USUAL_LEVELS.map((id) => level(id)),
    defaultEffort: USUAL_LEVEL
  }))
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
