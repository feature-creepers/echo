import { z } from 'zod'
import { desktopControlSchema } from '../desktop.ts'
import { eventPrefixSchema } from '../envelope.ts'
import { notificationSchema, scheduleViewSchema } from '../schedule.ts'

/** A reminder or task was set, changed, rang, or was deleted, or the quiet hours changed. Carries the schedule whole. */
export const scheduleChangedSchema = eventPrefixSchema.extend({
  name: z.literal('schedule.changed'),
  schedule: scheduleViewSchema
})

/**
 * Show a notification with the system's own: a reminder rang, a scheduled task or an answer finished in the
 * background. A device that declared `notify` shows it; the others ignore it.
 */
export const deviceNotifySchema = eventPrefixSchema.extend({
  name: z.literal('device.notify'),
  notification: notificationSchema
})

/**
 * The assistant took hold of a window of another app, moved on to another, or let go (`control: null`). A device that
 * declared `screen` marks the window while it is held, so the person always sees what the assistant operates.
 */
export const deviceDesktopSchema = eventPrefixSchema.extend({
  name: z.literal('device.desktop'),
  control: desktopControlSchema
})
