import { z } from 'zod'
import { answerIdSchema, topicAnswersSchema, topicIdSchema } from '../topics.ts'

const titleSchema = z.string().trim().min(1).max(80)
const nothing = z.object({})

export const topicCommands = {
  /**
   * Read the topics for the main screen, the one last active first, a page at a time: each with its latest answer.
   * With `before`, those last active before that moment. The first page also holds every topic in progress, however
   * long ago it was active, so what is being worked on is there from the start. `next` is the `before` of the page
   * after this one, left out at the end. Topics put away are left out; with `archived`, they are the ones read.
   */
  'topics.read': {
    input: z.object({
      limit: z.number().int().min(1).max(50).default(12),
      before: z.string().min(1).max(40).optional(),
      archived: z.boolean().default(false)
    }),
    output: z.object({ topics: z.array(topicAnswersSchema), next: z.string().optional() })
  },

  /** Read a topic's answers, the latest first, a page at a time: with `before`, those before that answer. */
  'topic.read': {
    input: z.object({ topic: topicIdSchema, limit: z.number().int().min(1).max(20).default(6), before: answerIdSchema.optional() }),
    output: topicAnswersSchema.extend({ more: z.boolean() })
  },

  /** Give a topic another name. */
  'topic.rename': {
    input: z.object({ topic: topicIdSchema, title: titleSchema }),
    output: nothing
  },

  /** Put a topic away from the main screen, or bring it back. Nothing of it is lost. */
  'topic.archive': {
    input: z.object({ topic: topicIdSchema, archived: z.boolean() }),
    output: nothing
  },

  /**
   * Move an answer to another topic, when the assistant filed it where it does not belong: to the topic given, or,
   * with a title, to a new topic of that name. Says which topic it is in now.
   */
  'topic.move': {
    input: z.object({ answer: answerIdSchema, topic: topicIdSchema.optional(), title: titleSchema.optional() }).refine(
      // One or the other: where it goes, or what the new topic is called.
      (input) => (input.topic === undefined) !== (input.title === undefined)
    ),
    output: z.object({ topic: topicIdSchema })
  },

  /** Merge a topic into another: its answers become the other's, and so does what its threads answer next. */
  'topic.merge': {
    input: z.object({ topic: topicIdSchema, into: topicIdSchema }),
    output: nothing
  }
}
