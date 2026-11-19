import { deviceNotifySchema, SNOOZES } from '@repo/protocol'
import { type BrowserWindow, Notification, nativeImage } from 'electron'
import type { CoreProcess } from './core-process.ts'
import { appIcon } from './mark.ts'

/** How many notifications are held at once, so a press on one is still heard once the system has shown it. */
const HELD = 20

/** What a reminder's notification offers to snooze it by, in minutes: the shortest and the longest of the card's. */
const NOTIFIED_SNOOZES = [SNOOZES[0], SNOOZES[2]] as const

/** A snooze as a button says it: "Snooze 10 min", "Snooze 1 hour". */
const snoozeWords = (minutes: number) => `Snooze ${minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? '' : 's'}` : `${minutes} min`}`

/**
 * The `notify` capability of this device (docs/SPEC.md, section 12.1): the core's notifications, shown with the
 * system's own, the app's icon on them. Pressing one brings the window forward. One meant only for when the window
 * is not in front of the person is left out while it is, since they see the answer there already. A reminder's has
 * buttons to snooze it, where the system shows them (Windows; macOS once the app is signed).
 */
export function serveNotifications(core: CoreProcess, window: BrowserWindow, bringForward: () => void): void {
  const icon = nativeImage.createFromBuffer(appIcon(256, 'round'))
  // A notification no longer referenced can be collected while it is on screen, and its press is then lost.
  const held: Notification[] = []

  core.observe((message) => {
    if ((message as { name?: unknown } | null)?.name !== 'device.notify') return
    const read = deviceNotifySchema.safeParse(message)
    if (!read.success) return
    const { title, body, silent, unlessFocused, snooze } = read.data.notification
    const inFront = !window.isDestroyed() && window.isVisible() && !window.isMinimized() && window.isFocused()
    // A Linux desktop without a notification service has none to show it with.
    if ((unlessFocused && inFront) || !Notification.isSupported()) return
    const actions = snooze === undefined ? [] : NOTIFIED_SNOOZES.map((minutes) => ({ type: 'button' as const, text: snoozeWords(minutes) }))
    const notification = new Notification({ title, body, silent, icon, actions })
    notification.on('click', bringForward)
    notification.on('action', (details) => {
      const minutes = NOTIFIED_SNOOZES[details.actionIndex]
      if (snooze === undefined || minutes === undefined) return
      core.send({ type: 'command', id: `snooze-${Date.now()}`, name: 'schedule.snooze', input: { job: snooze, minutes } })
    })
    held.push(notification)
    if (held.length > HELD) held.shift()
    notification.show()
  })
}
