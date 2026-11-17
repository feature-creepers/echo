import { z } from 'zod'
import { eventPrefixSchema } from '../envelope.ts'
import { viewSchema } from '../views.ts'

/** The assistant shows a view. It goes on top of the stream; on the stage, it takes the place of the one shown before. */
export const viewShownSchema = eventPrefixSchema.extend({
  name: z.literal('view.shown'),
  view: viewSchema
})

/**
 * A view is no longer shown. Given, that view leaves the stream. Left out, the topic in focus has nothing to show:
 * the stage is empty, and the views already in the stream stay there.
 */
export const viewClearedSchema = eventPrefixSchema.extend({
  name: z.literal('view.cleared'),
  view: z.string().min(1).max(64).optional()
})

/** The assistant pauses, resumes or stops what the media player plays, on every client. */
export const MEDIA_ACTIONS = ['pause', 'resume', 'stop'] as const
export const mediaControlSchema = eventPrefixSchema.extend({
  name: z.literal('media.control'),
  action: z.enum(MEDIA_ACTIONS)
})
