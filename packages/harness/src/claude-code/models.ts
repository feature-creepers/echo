import type { HarnessEffort, HarnessModels, Role } from '@repo/core'

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

/**
 * The levels of reasoning the CLI takes with `--effort`, from the lightest to the deepest. None is the default
 * here: left alone, the CLI picks the level for the model and the account.
 */
const EFFORTS: Record<'low' | 'medium' | 'high' | 'xhigh' | 'max', HarnessEffort> = {
  low: { id: 'low', name: 'Low', description: 'Answers quickest, thinking little first.' },
  medium: { id: 'medium', name: 'Medium', description: 'Some thought before answering.' },
  high: { id: 'high', name: 'High', description: 'Thinks things through. Slower, uses more of your plan.' },
  xhigh: { id: 'xhigh', name: 'Extra high', description: 'Deeper still, for hard problems.' },
  max: { id: 'max', name: 'Max', description: 'As deep as it goes. Slowest, and uses the most of your plan.' }
}

/** The models the user can choose from for the answers, from the quickest to the most capable. Haiku has no level to choose. */
export const CLAUDE_CODE_CHOICES: HarnessModels = {
  models: [
    { id: 'haiku', name: 'Haiku', description: 'Fast and inexpensive. Right for most of what you ask.' },
    {
      id: 'sonnet',
      name: 'Sonnet',
      description: 'More thorough, a little slower. Uses more of your plan.',
      efforts: [EFFORTS.low, EFFORTS.medium, EFFORTS.high, EFFORTS.max]
    },
    {
      id: 'opus',
      name: 'Opus',
      description: 'The most capable, for hard problems. Slowest, and uses the most of your plan.',
      efforts: [EFFORTS.low, EFFORTS.medium, EFFORTS.high, EFFORTS.xhigh, EFFORTS.max]
    }
  ],
  default: CLAUDE_CODE_MODELS.thread
}
