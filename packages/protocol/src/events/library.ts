import { z } from 'zod'
import { eventPrefixSchema } from '../envelope.ts'
import { libraryViewSchema } from '../library.ts'

/** A widget was saved, changed, pinned or deleted, on this device or another. Carries the library whole. */
export const libraryChangedSchema = eventPrefixSchema.extend({
  name: z.literal('library.changed'),
  library: libraryViewSchema
})
