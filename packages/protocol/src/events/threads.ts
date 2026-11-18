import { z } from 'zod'
import { eventPrefixSchema } from '../envelope.ts'
import { threadsSchema } from '../threads.ts'

/** A thread was opened, changed state, or the focus moved. Carries them all. */
export const threadsChangedSchema = eventPrefixSchema.extend({
  name: z.literal('threads.changed'),
  threads: threadsSchema
})
