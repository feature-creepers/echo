import { z } from 'zod'
import { eventPrefixSchema } from '../envelope.ts'
import { viewSchema } from '../views.ts'

/** The assistant shows a view. It replaces the one shown before. */
export const viewShownSchema = eventPrefixSchema.extend({
  name: z.literal('view.shown'),
  view: viewSchema
})

/** Nothing is shown any more. */
export const viewClearedSchema = eventPrefixSchema.extend({
  name: z.literal('view.cleared')
})
