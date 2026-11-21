import { z } from 'zod'

/**
 * The messages between a widget app's page and the window that shows it (docs/SPEC.md, section 9.9), each marked
 * `echo: 1`. The page is not trusted: the window reads every message against these, and the core decides what it reaches.
 */

/** A question a widget app's page asks the window that shows it, which answers with its `id`. */
export const frameQuestionSchema = z.discriminatedUnion('type', [
  z.object({
    echo: z.literal(1),
    type: z.literal('call'),
    id: z.number(),
    url: z.string().max(4000),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    headers: z.record(z.string().max(64), z.string().max(2000)),
    body: z
      .string()
      .max(256 * 1024)
      .optional()
  }),
  z.object({ echo: z.literal(1), type: z.literal('state'), id: z.number() }),
  z.object({ echo: z.literal(1), type: z.literal('keep'), id: z.number(), key: z.string().min(1).max(100), value: z.unknown() }),
  z.object({ echo: z.literal(1), type: z.literal('notify'), id: z.number(), title: z.string().min(1).max(120), body: z.string().max(500) }),
  z.object({ echo: z.literal(1), type: z.literal('open'), id: z.number(), url: z.string().max(4000) }),
  z.object({
    echo: z.literal(1),
    type: z.literal('media'),
    id: z.number(),
    action: z.enum(['play', 'pause', 'resume', 'stop', 'volume', 'state']),
    /** What to play: a stream or file of a declared address, and how the player names it. */
    source: z
      .object({
        url: z.string().max(4000),
        title: z.string().min(1).max(200),
        subtitle: z.string().max(200).optional(),
        artwork: z.string().max(4000).optional(),
        live: z.boolean().default(false)
      })
      .optional(),
    /** The volume to set, from 0 to 1. */
    level: z.number().min(0).max(1).optional()
  })
])
/** What a widget app's page tells the window of itself: how it started, or how tall it is. */
export const frameNewsSchema = z.discriminatedUnion('type', [
  z.object({ echo: z.literal(1), type: z.literal('report'), outcome: z.enum(['started', 'failed']), message: z.string().max(2000).optional() }),
  z.object({ echo: z.literal(1), type: z.literal('size'), height: z.number().nonnegative() })
])
export type FrameQuestion = z.infer<typeof frameQuestionSchema>
export type FrameNews = z.infer<typeof frameNewsSchema>
