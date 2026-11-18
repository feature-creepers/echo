import { z } from 'zod'
import { activityUsedSchema, allowancesChangedSchema } from './events/access.ts'
import { activitySchema, answerWrittenSchema, enginesChangedSchema, speechSaySchema, turnEndedSchema, turnStartedSchema } from './events/conversation.ts'
import { workspaceChangedSchema } from './events/files.ts'
import { libraryChangedSchema } from './events/library.ts'
import { assistantStateChangedSchema, memoryChangedSchema } from './events/memory.ts'
import { deviceDesktopSchema, deviceNotifySchema, scheduleChangedSchema } from './events/schedule.ts'
import { settingsChangedSchema } from './events/settings.ts'
import { threadsChangedSchema } from './events/threads.ts'
import { mediaControlSchema, viewClearedSchema, viewShownSchema } from './events/views.ts'

/** Every event a core can send, assembled from the groups in `events/`. */
export const eventSchema = z.discriminatedUnion('name', [
  settingsChangedSchema,
  turnStartedSchema,
  speechSaySchema,
  turnEndedSchema,
  activitySchema,
  answerWrittenSchema,
  enginesChangedSchema,
  viewShownSchema,
  viewClearedSchema,
  mediaControlSchema,
  threadsChangedSchema,
  memoryChangedSchema,
  assistantStateChangedSchema,
  libraryChangedSchema,
  scheduleChangedSchema,
  deviceNotifySchema,
  deviceDesktopSchema,
  workspaceChangedSchema,
  allowancesChangedSchema,
  activityUsedSchema
])
export type Event = z.infer<typeof eventSchema>
export type EventName = Event['name']
/** The event of one name. */
export type EventOf<Name extends EventName> = Extract<Event, { name: Name }>
