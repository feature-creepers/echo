import { z } from 'zod'
import { activityUsedSchema, allowancesChangedSchema } from './events/access.ts'
import { accountsChangedSchema } from './events/accounts.ts'
import { deviceCameraSchema } from './events/camera.ts'
import {
  activitySchema,
  answerWrittenSchema,
  enginesChangedSchema,
  speechSaySchema,
  turnEndedSchema,
  turnPlannedSchema,
  turnStartedSchema
} from './events/conversation.ts'
import { workspaceChangedSchema } from './events/files.ts'
import { libraryChangedSchema } from './events/library.ts'
import { assistantStateChangedSchema, memoryChangedSchema } from './events/memory.ts'
import { deviceDesktopSchema, deviceNotifySchema, scheduleChangedSchema } from './events/schedule.ts'
import { servicesChangedSchema } from './events/services.ts'
import { settingsChangedSchema } from './events/settings.ts'
import { threadsChangedSchema } from './events/threads.ts'
import { topicsChangedSchema } from './events/topics.ts'
import { mediaControlSchema, viewClearedSchema, viewShownSchema } from './events/views.ts'

/** Every event a core can send, assembled from the groups in `events/`. */
export const eventSchema = z.discriminatedUnion('name', [
  settingsChangedSchema,
  turnStartedSchema,
  speechSaySchema,
  turnEndedSchema,
  activitySchema,
  answerWrittenSchema,
  turnPlannedSchema,
  enginesChangedSchema,
  viewShownSchema,
  viewClearedSchema,
  mediaControlSchema,
  threadsChangedSchema,
  topicsChangedSchema,
  memoryChangedSchema,
  assistantStateChangedSchema,
  libraryChangedSchema,
  scheduleChangedSchema,
  deviceNotifySchema,
  deviceDesktopSchema,
  deviceCameraSchema,
  workspaceChangedSchema,
  allowancesChangedSchema,
  activityUsedSchema,
  accountsChangedSchema,
  servicesChangedSchema
])
export type Event = z.infer<typeof eventSchema>
export type EventName = Event['name']
/** The event of one name. */
export type EventOf<Name extends EventName> = Extract<Event, { name: Name }>
