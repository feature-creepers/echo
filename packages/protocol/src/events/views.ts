import { z } from 'zod'
import { eventPrefixSchema } from '../envelope.ts'
import { viewSchema } from '../views.ts'

/** The assistant shows a view: a card of an answer (`answerIdOf`), beside the others of it or in place of one (`withCard`). */
export const viewShownSchema = eventPrefixSchema.extend({
  name: z.literal('view.shown'),
  view: viewSchema
})

/** A card was removed from its answer. */
export const viewClearedSchema = eventPrefixSchema.extend({
  name: z.literal('view.cleared'),
  view: z.string().min(1).max(64)
})

/** What the assistant can do to the media player. */
export const MEDIA_ACTIONS = ['pause', 'resume', 'stop', 'volume', 'seek', 'queue', 'next', 'clear-queue'] as const

/** A stream or a file to add to the media player's queue. */
export const mediaSourceSchema = z.object({
  url: z.url().max(2048),
  kind: z.enum(['audio', 'video']),
  title: z.string().min(1).max(200),
  subtitle: z.string().max(200).optional(),
  artwork: z.url().max(2048).optional(),
  live: z.boolean()
})

/**
 * The assistant drives the media player, on every client: pause, resume or stop it; set its volume (`level`, from
 * 0 to 1) or change it (`step`, from -1 to 1); seek a file (`to` a position, or `by` seconds from where it is); add
 * a stream or a file to the queue (`source`), skip to what is next, or empty the queue.
 */
export const mediaControlSchema = eventPrefixSchema.extend({
  name: z.literal('media.control'),
  action: z.enum(MEDIA_ACTIONS),
  level: z.number().min(0).max(1).optional(),
  step: z.number().min(-1).max(1).optional(),
  to: z.number().min(0).optional(),
  by: z.number().optional(),
  source: mediaSourceSchema.optional()
})
export type MediaControl = Omit<z.infer<typeof mediaControlSchema>, 'type' | 'name'>
