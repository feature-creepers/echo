import { z } from 'zod'
import { allowanceSchema } from '../access.ts'
import { accessUseSchema } from '../activity.ts'
import { eventPrefixSchema } from '../envelope.ts'

/** What was allowed for the session changed: given, forgotten, or ended. Carries it whole. */
export const allowancesChangedSchema = eventPrefixSchema.extend({
  name: z.literal('allowances.changed'),
  allowances: z.array(allowanceSchema)
})

/** A use of the computer was decided, or what came of it is known, or it was undone. Carries it as it stands. */
export const activityUsedSchema = eventPrefixSchema.extend({
  name: z.literal('activity.used'),
  use: accessUseSchema
})
