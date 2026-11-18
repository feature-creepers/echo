import { openSession } from '@repo/client'
import { type CommandInput, deviceCameraSchema, encodeBase64 } from '@repo/protocol'
import { type AccentName, accents, neutralAccent, radius } from '@repo/tokens'
import { BrowserWindow, ipcMain, screen, type WebContents } from 'electron'
import { CAMERA_CHANNELS, type CameraAnswer } from '../preload/bridge.ts'
import type { CoreProcess } from './core-process.ts'

/** How long the window has to take the picture, in milliseconds, before the core is told it could not. */
const TAKE_TIMEOUT_MS = 25_000
/** How long the marker stays once the camera is off, in milliseconds, so the person sees it even for a quick picture. */
const MARKER_LINGER_MS = 1_500
/** The marker's size, in the screen's points, and how far below the top of the screen it sits. */
const MARKER = { width: 190, height: 32, top: 12 }

/** The marker, drawn by the page itself: a pill with a dot in the persona's accent, and what is on. */
const page = (accent: { solid: string }) =>
  `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden;font:600 12px system-ui,-apple-system,"Segoe UI",sans-serif}
.pill{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:8px;border-radius:${radius.lg}px;background:rgba(18,18,20,.92);border:1px solid rgba(255,255,255,.14);color:#fff;box-sizing:border-box}
.dot{width:8px;height:8px;border-radius:50%;background:${accent.solid}}
</style></head><body><div class="pill"><span class="dot"></span>Assistant using the camera</div></body></html>`)}`

export interface CameraService {
  /** Whether these contents may use the camera now: only the window, and only while the core's request waits. */
  allows(contents: WebContents): boolean
  accent(name: AccentName | undefined): void
}

/**
 * The `camera` capability of this device (docs/SPEC.md, section 12.4, more of the device). The core asks for a picture
 * once the person allowed it on a card; the window takes it, and may use the camera only while that request waits, so
 * nothing else in it ever turns the camera on. While it is on, and a moment after, a marker at the top of the screen
 * says so, above every window, letting every click through and never taking the focus.
 */
export function serveCamera(core: CoreProcess, window: BrowserWindow): CameraService {
  const session = openSession({ send: (message) => core.send(message), onMessage: (listener) => void core.observe(listener) })
  let colour: { solid: string } = neutralAccent
  let taking: { id: string; timer: ReturnType<typeof setTimeout> } | undefined
  let marker: BrowserWindow | undefined
  let hideLater: ReturnType<typeof setTimeout> | undefined

  const showMarker = () => {
    clearTimeout(hideLater)
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    const bounds = { x: Math.round(area.x + (area.width - MARKER.width) / 2), y: area.y + MARKER.top, width: MARKER.width, height: MARKER.height }
    if (!marker || marker.isDestroyed()) {
      marker = new BrowserWindow({
        ...bounds,
        transparent: true,
        frame: false,
        focusable: false,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        hasShadow: false,
        show: false,
        webPreferences: { sandbox: true, contextIsolation: true, javascript: false }
      })
      marker.setIgnoreMouseEvents(true)
      marker.setAlwaysOnTop(true, 'screen-saver')
      marker.setVisibleOnAllWorkspaces(true)
    }
    marker.setBounds(bounds)
    void marker.loadURL(page(colour))
    marker.showInactive()
  }
  const hideMarker = () => {
    clearTimeout(hideLater)
    hideLater = setTimeout(() => marker?.hide(), MARKER_LINGER_MS)
  }

  const answer = (input: CommandInput<'camera.picture'>) => {
    if (taking?.id !== input.request) return
    clearTimeout(taking.timer)
    taking = undefined
    hideMarker()
    // The core may have stopped waiting meanwhile: its answer then says nothing worth acting on.
    session.run('camera.picture', input).catch(() => undefined)
  }

  core.observe((message) => {
    if ((message as { name?: unknown } | null)?.name !== 'device.camera') return
    const read = deviceCameraSchema.safeParse(message)
    if (!read.success) return
    const { request, camera } = read.data
    if (taking) {
      session.run('camera.picture', { request, problem: 'The camera is already taking a picture.' }).catch(() => undefined)
      return
    }
    if (window.isDestroyed()) {
      session.run('camera.picture', { request, problem: 'The app’s window is closed, so the camera cannot be used.' }).catch(() => undefined)
      return
    }
    taking = { id: request, timer: setTimeout(() => answer({ request, problem: 'The camera took too long to answer.' }), TAKE_TIMEOUT_MS) }
    showMarker()
    window.webContents.send(CAMERA_CHANNELS.capture, { id: request, ...(camera === undefined ? {} : { camera }) })
  })

  ipcMain.on(CAMERA_CHANNELS.picture, (event, given: CameraAnswer) => {
    if (window.isDestroyed() || event.sender !== window.webContents || typeof given?.id !== 'string') return
    if ('problem' in given) return answer({ request: given.id, problem: String(given.problem).slice(0, 500) })
    const { bytes, width, height, camera } = given.picture
    answer({
      request: given.id,
      picture: {
        data: encodeBase64(bytes),
        mime: 'image/jpeg',
        width,
        height,
        ...(typeof camera === 'string' && camera ? { camera: camera.slice(0, 200) } : {})
      }
    })
  })

  return {
    allows: (contents) => taking !== undefined && !window.isDestroyed() && contents === window.webContents,
    accent(name) {
      colour = name ? accents[name] : neutralAccent
    }
  }
}
