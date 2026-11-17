import { z } from 'zod'
import { activitySchema, enginesChangedSchema, speechSaySchema, turnEndedSchema, turnStartedSchema } from './events/conversation.ts'
import { libraryChangedSchema } from './events/library.ts'
import { assistantStateChangedSchema, memoryChangedSchema } from './events/memory.ts'
import { settingsChangedSchema } from './events/settings.ts'
import { threadsChangedSchema } from './events/threads.ts'
import { viewClearedSchema, viewShownSchema } from './events/views.ts'

/** Every event a core can send, assembled from the groups in `events/`. */
export const eventSchema = z.discriminatedUnion('name', [
  settingsChangedSchema,
  turnStartedSchema,
  speechSaySchema,
  turnEndedSchema,
  activitySchema,
  enginesChangedSchema,
  viewShownSchema,
  viewClearedSchema,
  threadsChangedSchema,
  memoryChangedSchema,
  assistantStateChangedSchema,
  libraryChangedSchema
])
export type Event = z.infer<typeof eventSchema>
export type EventName = Event['name']
/** The event of one name. */
export type EventOf<Name extends EventName> = Extract<Event, { name: Name }>
