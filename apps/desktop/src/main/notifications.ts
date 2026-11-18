import { deviceNotifySchema } from '@repo/protocol'
import { type BrowserWindow, Notification, nativeImage } from 'electron'
import type { CoreProcess } from './core-process.ts'
import { appIcon } from './mark.ts'

/** How many notifications are held at once, so a press on one is still heard once the system has shown it. */
const HELD = 20

/**
 * The `notify` capability of this device (docs/SPEC.md, section 12.1): the core's notifications, shown with the
 * system's own, the app's icon on them. Pressing one brings the window forward. One meant only for when the window
 * is not in front of the person is left out while it is, since they see the answer there already.
 */
export function serveNotifications(core: CoreProcess, window: BrowserWindow, bringForward: () => void): void {
  const icon = nativeImage.createFromBuffer(appIcon(256, 'round'))
  // A notification no longer referenced can be collected while it is on screen, and its press is then lost.
  const held: Notification[] = []

  core.observe((message) => {
    if ((message as { name?: unknown } | null)?.name !== 'device.notify') return
    const read = deviceNotifySchema.safeParse(message)
    if (!read.success) return
    const { title, body, silent, unlessFocused } = read.data.notification
    const inFront = !window.isDestroyed() && window.isVisible() && !window.isMinimized() && window.isFocused()
    // A Linux desktop without a notification service has none to show it with.
    if ((unlessFocused && inFront) || !Notification.isSupported()) return
    const notification = new Notification({ title, body, silent, icon })
    notification.on('click', bringForward)
    held.push(notification)
    if (held.length > HELD) held.shift()
    notification.show()
  })
}
