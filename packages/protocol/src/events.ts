import { z } from 'zod'
import { activitySchema, enginesChangedSchema, speechSaySchema, turnEndedSchema, turnStartedSchema } from './events/conversation.ts'
import { settingsChangedSchema } from './events/settings.ts'

/** Every event a core can send, assembled from the groups in `events/`. */
export const eventSchema = z.discriminatedUnion('name', [
  settingsChangedSchema,
  turnStartedSchema,
  speechSaySchema,
  turnEndedSchema,
  activitySchema,
  enginesChangedSchema
])
export type Event = z.infer<typeof eventSchema>
export type EventName = Event['name']
/** The event of one name. */
export type EventOf<Name extends EventName> = Extract<Event, { name: Name }>
