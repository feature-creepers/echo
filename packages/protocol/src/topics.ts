import { z } from 'zod'
import { exchangeSchema } from './conversation.ts'
import { type ShownView, viewSchema } from './views.ts'

/**
 * A topic: one subject of the conversation, as the person sees it on the main screen (docs/SPEC.md, section 7.3). It
 * is a conversation in its own right, made of answers, each one a version of it. Threads are how the work is done,
 * a topic is what it is about: it gathers the answers of as many threads as it takes.
 */
export const topicIdSchema = z.string().min(1).max(64)

export const topicSchema = z.object({
  id: topicIdSchema,
  /** What it is about, in a few words. */
  title: z.string(),
  /** When it was last active, its latest answer or the last time it was brought back: an ISO 8601 date in UTC. */
  at: z.string(),
  /** How many answers it has. */
  answers: z.number().int().nonnegative(),
  /** Put away by the person: it leaves the main screen. Work on it, or asking for it again, brings it back. */
  archived: z.boolean().optional()
})
export type Topic = z.infer<typeof topicSchema>

/**
 * Identifies an answer for good: its turn. What is shown outside a turn is an answer of its own: a saved widget the
 * person had shown is one answer however often they show it, under the widget's identifier; any other view, under its own.
 */
export const answerIdSchema = z.string().min(1).max(64)

/** The answer a view is a card of. */
export const answerIdOf = (view: Pick<ShownView, 'id' | 'turn' | 'widget'>): string => view.turn ?? view.widget ?? view.id

/** One answer of a topic: a version of it. */
export const answerSchema = z.object({
  id: answerIdSchema,
  /** When it was asked for: an ISO 8601 date in UTC. */
  at: z.string(),
  /** The line of the conversation it answers. Left out for what the person had shown themselves: a saved widget. */
  exchange: exchangeSchema.optional(),
  /** Its cards, in the order they were shown. */
  views: z.array(viewSchema)
})
export type Answer = z.infer<typeof answerSchema>

/** A topic with the answers of it that were read, the latest first. */
export const topicAnswersSchema = z.object({ topic: topicSchema, answers: z.array(answerSchema) })
export type TopicAnswers = z.infer<typeof topicAnswersSchema>
