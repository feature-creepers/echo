import { z } from 'zod'
import { settingsChangedSchema } from './events/settings.ts'

/** Every event a core can send, assembled from the groups in `events/`. */
export const eventSchema = z.discriminatedUnion('name', [settingsChangedSchema])
export type Event = z.infer<typeof eventSchema>
export type EventName = Event['name']
