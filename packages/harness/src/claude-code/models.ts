import type { HarnessModels, Role } from '@repo/core'

/**
 * The model each role runs on unless the user chose otherwise. These are the CLI's own aliases, which
 * follow the newest model of each size, so nothing here names a version that will age.
 *
 * The assistant answers with the small model by default: it is quick to speak, and spends little of the
 * user's allowance. The user can pick a stronger one for the answers in settings; the orchestrator, which
 * hears every utterance before anyone answers, stays on the small one whatever is chosen, since its delay
 * is added to every reply.
 */
export const CLAUDE_CODE_MODELS: Record<Role, string> = {
  orchestrator: 'haiku',
  thread: 'haiku',
  utility: 'haiku'
}

/** The models the user can choose from for the answers, from the quickest to the most capable. */
export const CLAUDE_CODE_CHOICES: HarnessModels = {
  models: [
    { id: 'haiku', name: 'Haiku', description: 'Fast and inexpensive. Right for most of what you ask.' },
    { id: 'sonnet', name: 'Sonnet', description: 'More thorough, a little slower. Uses more of your plan.' },
    { id: 'opus', name: 'Opus', description: 'The most capable, for hard problems. Slowest, and uses the most of your plan.' }
  ],
  default: CLAUDE_CODE_MODELS.thread
}
