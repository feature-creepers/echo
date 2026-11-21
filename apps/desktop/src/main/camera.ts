import { CONFIRM_TIMEOUT_MS, checkDeviceRequest, type DeviceConfirmation, openSession } from '@repo/client'
import { type CommandInput, deviceCameraSchema, encodeBase64 } from '@repo/protocol'
import { type AccentName, accents, color, neutralAccent } from '@repo/tokens'
import { type BrowserWindow, dialog, ipcMain, screen, type WebContents } from 'electron'
import { CAMERA_CHANNELS, type CameraAnswer } from '../preload/bridge.ts'
import type { CoreProcess } from './core-process.ts'
import { overlayPage, overlayWindow } from './overlay.ts'

/** How long the window has to take the picture, in milliseconds, before the core is told it could not. */
const TAKE_TIMEOUT_MS = 25_000
/** How long the marker stays once the camera is off, in milliseconds, so the person sees it even for a quick picture. */
const MARKER_LINGER_MS = 1_500
/** The marker's size, in the screen's points, and how far below the top of the screen it sits. */
const MARKER = { width: 190, height: 32, top: 12 }

/** The marker, drawn by the page itself: a plate with a square in the persona's accent, and what is on. */
const page = (accent: { solid: string }) =>
  overlayPage(
    `html,body{margin:0;height:100%;background:transparent;overflow:hidden;font:600 12px system-ui,-apple-system,"Segoe UI",sans-serif}
.plate{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:8px;background:${color.ground};border:1px solid ${color.lineStrong};color:${color.text};box-sizing:border-box}
.mark{width:8px;height:8px;background:${accent.solid}}`,
    '<div class="plate"><span class="mark"></span>Assistant using the camera</div>'
  )

export interface CameraService {
  /** Whether these contents may use the camera now: only the window, and only while the core's request waits. */
  allows(contents: WebContents): boolean
  accent(name: AccentName | undefined): void
}

/**
 * The `camera` capability of this device (docs/SPEC.md, section 12.4, more of the device). The core asks for a picture
 * once the person allowed it on a card; the window takes it, and may use the camera only while that request waits, so
 * nothing else in it ever turns the camera on. While it is on, and a moment after, a marker at the top of the screen
 * says so. A remote core is not taken at its word that the person allowed it: the device asks them itself first, with
 * the system's own dialog.
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
    if (!marker || marker.isDestroyed()) marker = overlayWindow(bounds)
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

  /** The person's own answer on this device, asked with the system's dialog. No answer in time counts as a no. */
  const confirm = async (question: DeviceConfirmation): Promise<boolean> => {
    const shown = { type: 'question' as const, buttons: [question.allow, question.refuse], defaultId: 1, cancelId: 1, noLink: true }
    const ask = { ...shown, title: question.heading, message: question.heading, detail: question.detail, signal: AbortSignal.timeout(CONFIRM_TIMEOUT_MS) }
    try {
      const { response } = window.isDestroyed() ? await dialog.showMessageBox(ask) : await dialog.showMessageBox(window, ask)
      return response === 0
    } catch {
      return false
    }
  }

  /** Take the picture the core asked for, in the window, with the marker on. */
  const take = (request: string, camera: string | undefined) => {
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
  }

  core.observe((message) => {
    if ((message as { name?: unknown } | null)?.name !== 'device.camera') return
    const read = deviceCameraSchema.safeParse(message)
    if (!read.success) return
    const { request, camera } = read.data
    const check = checkDeviceRequest({ name: 'device.camera' }, { remote: core.remote() })
    if (check.run) return take(request, camera)
    void confirm(check.confirm).then((allowed) => {
      if (allowed) take(request, camera)
      else session.run('camera.picture', { request, problem: check.confirm.refused }).catch(() => undefined)
    })
  })

  ipcMain.on(CAMERA_CHANNELS.picture, (event, given: CameraAnswer) => {
    if (window.isDestroyed() || event.sender !== window.webContents || typeof given?.id !== 'string') return
    if ('problem' in given) return answer({ request: given.id, problem: String(given.problem).slice(0, 500) })
    if (!(given.picture?.bytes instanceof Uint8Array)) return
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
