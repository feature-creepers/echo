import { type DesktopControl, deviceDesktopSchema } from '@repo/protocol'
import { type AccentName, accents, neutralAccent } from '@repo/tokens'
import { type BrowserWindow, screen } from 'electron'
import type { CoreProcess } from './core-process.ts'
import { overlayPage, overlayWindow } from './overlay.ts'

/** How far the frame stands out of the window it marks, in pixels of the screen. */
const MARGIN = 3

/** The frame, drawn by the page itself: a ring in the persona's accent and the app's name on a tab above it. */
const page = (app: string, accent: { solid: string; ink: string }) =>
  overlayPage(
    `html,body{margin:0;height:100%;background:transparent;overflow:hidden;font:12px system-ui,-apple-system,"Segoe UI",sans-serif}
.ring{position:absolute;inset:0;border:3px solid ${accent.solid};box-sizing:border-box}
.tab{position:absolute;top:0;left:50%;transform:translateX(-50%);padding:2px 10px 4px;background:${accent.solid};color:${accent.ink};font-weight:600;white-space:nowrap}`,
    `<div class="ring"></div><div class="tab">Assistant using ${app.replace(/[<&>"]/g, '')}</div>`
  )

/**
 * The `screen` capability's marker (docs/SPEC.md, section 12.1, `device.screen`): while the assistant operates a
 * window of another app, a frame around it says so. It goes when the core says the assistant let go. Its colour is the
 * persona's accent, told as it changes.
 */
export function serveDesktopMarker(core: CoreProcess): { accent(name: AccentName | undefined): void } {
  let frame: BrowserWindow | undefined
  let shown: string | undefined
  let colour: { solid: string; ink: string } = neutralAccent

  const hide = () => {
    frame?.hide()
    shown = undefined
  }

  const mark = (control: NonNullable<DesktopControl>) => {
    // Windows names a window's place in the screen's own pixels; the frame is placed in the app's.
    const physical = {
      x: control.bounds.x - MARGIN,
      y: control.bounds.y - MARGIN,
      width: control.bounds.width + 2 * MARGIN,
      height: control.bounds.height + 2 * MARGIN
    }
    const bounds = process.platform === 'win32' ? screen.screenToDipRect(null, physical) : physical
    if (!frame || frame.isDestroyed()) frame = overlayWindow(bounds)
    frame.setBounds(bounds)
    const look = `${control.app} ${colour.solid}`
    if (shown !== look) void frame.loadURL(page(control.app, colour))
    shown = look
    frame.showInactive()
  }

  core.observe((message) => {
    if ((message as { name?: unknown } | null)?.name !== 'device.desktop') return
    const read = deviceDesktopSchema.safeParse(message)
    if (!read.success) return
    if (read.data.control === null) hide()
    else mark(read.data.control)
  })

  return {
    accent(name) {
      colour = name ? accents[name] : neutralAccent
    }
  }
}
