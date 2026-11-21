import type { z } from 'zod'

/**
 * A building block of the generated interface: a kind of content or arrangement the assistant can use,
 * whatever the subject. A block says what its properties are and how to use it; it draws nothing. Each
 * renderer draws the same blocks its own way.
 *
 * Nothing here is made for one subject: there is no weather block and no recipe block. The assistant
 * composes those, each time, from the blocks below (docs/SPEC.md, section 9.6).
 */
export interface Block {
  /** What it is for and when to use it, written for a model. One or two sentences. */
  description: string
  /** Its properties. */
  props: z.ZodObject
  /** Whether other blocks go inside it. */
  children: boolean
  /**
   * What is wrong with properties that each passed, taken together, in a sentence a model acts on: a Button needs
   * `say` or `act`, one of the two. Nothing when they hold together.
   */
  check?: (props: Record<string, unknown>) => string | undefined
}

/** The colours a block may be given: the ones of the app, by role, so everything the assistant composes looks like the app. */
export const TONES = ['normal', 'soft', 'faint', 'accent', 'ok', 'warn', 'danger'] as const
