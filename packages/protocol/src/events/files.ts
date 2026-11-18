import { z } from 'zod'
import { eventPrefixSchema } from '../envelope.ts'

/**
 * Something in the assistant's folder was made or changed: a file the person handed over, or one the assistant
 * wrote. Each path is where it is in the folder, its parts joined by "/".
 */
export const workspaceChangedSchema = eventPrefixSchema.extend({
  name: z.literal('workspace.changed'),
  paths: z.array(z.string()).max(200)
})
