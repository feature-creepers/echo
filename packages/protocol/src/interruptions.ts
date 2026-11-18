import { z } from 'zod'

/**
 * What the assistant does when an answer finishes out of sight, while the person is on another topic (docs/SPEC.md,
 * section 7.4): `mention` says in a sentence at the next pause that it is ready, `chip` only shows its "ready" chip,
 * and `speak` says the answer itself at the next pause, with its view.
 */
export const BACKGROUND_RESULTS = ['mention', 'chip', 'speak'] as const
export type BackgroundResult = (typeof BACKGROUND_RESULTS)[number]

/** When the assistant speaks up by itself, as the person set it. */
export const interruptionsSchema = z.object({
  /** An answer finished out of sight. */
  results: z.enum(BACKGROUND_RESULTS)
})
export type Interruptions = z.infer<typeof interruptionsSchema>

/** Until the person sets it: an answer finished out of sight is mentioned at the next pause. */
export const DEFAULT_INTERRUPTIONS: Interruptions = { results: 'mention' }
