import { z } from 'zod'

/**
 * What the assistant does when an answer finishes out of sight, while the person is on another topic (docs/SPEC.md,
 * section 7.4): `mention` says in a sentence at the next pause that it is ready, `chip` only shows its "ready" chip,
 * and `speak` says the answer itself at the next pause, with its view.
 */
export const BACKGROUND_RESULTS = ['mention', 'chip', 'speak'] as const
export type BackgroundResult = (typeof BACKGROUND_RESULTS)[number]

/** The most the cap on interruptions can be set to, in an hour. */
export const MAX_INTERRUPTIONS_PER_HOUR = 60

/** Until the person sets it: the assistant speaks up by itself at most this often in an hour. */
export const DEFAULT_INTERRUPTIONS_PER_HOUR = 12

/** When the assistant speaks up by itself, as the person set it. */
export const interruptionsSchema = z.object({
  /** An answer finished out of sight. */
  results: z.enum(BACKGROUND_RESULTS),
  /**
   * How many times an hour at most it speaks up by itself: reminders said aloud, scheduled tasks' answers, answers
   * finished out of sight (docs/SPEC.md, section 7.10). Past it, what it would say is shown, with a silent
   * notification, and not said. `null`: no cap.
   */
  perHour: z.number().int().min(1).max(MAX_INTERRUPTIONS_PER_HOUR).nullable().default(DEFAULT_INTERRUPTIONS_PER_HOUR)
})
export type Interruptions = z.infer<typeof interruptionsSchema>

/** Until the person sets it: an answer finished out of sight is mentioned at the next pause, twelve times an hour at most. */
export const DEFAULT_INTERRUPTIONS: Interruptions = { results: 'mention', perHour: DEFAULT_INTERRUPTIONS_PER_HOUR }
