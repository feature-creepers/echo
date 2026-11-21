import { z } from 'zod'
import { eventPrefixSchema } from '../envelope.ts'
import { topicAnswersSchema, topicIdSchema } from '../topics.ts'

/**
 * Topics changed: one was opened, answered, renamed, brought back or put away, or lost or gained an answer in a move
 * or a merge. Each comes with its latest answer. Those in `gone` have no answer left: they are no longer topics.
 */
export const topicsChangedSchema = eventPrefixSchema.extend({
  name: z.literal('topics.changed'),
  topics: z.array(topicAnswersSchema),
  gone: z.array(topicIdSchema)
})
