import type { CameraAnswer, CameraRequest } from '../preload/bridge.ts'

/** The widest picture sent: enough to read a label held up, small enough to cross the protocol in one line. */
const WIDEST = 1280
/** How long the camera is left to wake and settle its light before the picture is taken, in milliseconds. */
const SETTLE_MS = 900
/** The longest picture sent, in bytes: its base64 must stay under the protocol's limit for a picture. */
const LARGEST = 580_000

/** The part of the Image Capture API used here, which the DOM types of this TypeScript do not carry. */
declare class ImageCapture {
  constructor(track: MediaStreamTrack)
  grabFrame(): Promise<ImageBitmap>
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** The camera a request names by words of its name, once the system has given the names; else the system's first. */
async function choose(wanted: string | undefined): Promise<MediaDeviceInfo | undefined> {
  const cameras = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput')
  if (!wanted) return cameras[0]
  const words = wanted.toLowerCase()
  return cameras.find((camera) => camera.label.toLowerCase().includes(words)) ?? cameras[0]
}

/** A frame as a JPEG no larger than the protocol carries, made smaller in quality first, then in size. */
async function jpeg(frame: ImageBitmap): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  for (const [widest, quality] of [
    [WIDEST, 0.85],
    [WIDEST, 0.7],
    [960, 0.7],
    [640, 0.6]
  ] as const) {
    const scale = Math.min(1, widest / frame.width)
    const width = Math.max(1, Math.round(frame.width * scale))
    const height = Math.max(1, Math.round(frame.height * scale))
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('The picture could not be drawn.')
    context.drawImage(frame, 0, 0, width, height)
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality })).arrayBuffer())
    if (bytes.length <= LARGEST) return { bytes, width, height }
  }
  throw new Error('The picture is too large to send.')
}

/** Take one picture: the camera is on only from here to the end, and every track is stopped whatever happens. */
async function take(request: CameraRequest): Promise<CameraAnswer> {
  const first = await choose(request.camera)
  if (!first) return { id: request.id, problem: 'This computer has no camera.' }
  let stream: MediaStream | undefined
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { ...(first.deviceId ? { deviceId: { exact: first.deviceId } } : {}), width: { ideal: WIDEST } }
    })
    // Names are given only once the camera is allowed: a camera asked for by its name is looked for again.
    const named = request.camera ? await choose(request.camera) : undefined
    const [track] = stream.getVideoTracks()
    if (named?.deviceId && track && track.getSettings().deviceId !== named.deviceId) {
      for (const old of stream.getTracks()) old.stop()
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { deviceId: { exact: named.deviceId }, width: { ideal: WIDEST } } })
    }
    const [video] = stream.getVideoTracks()
    if (!video) return { id: request.id, problem: 'The camera gave no picture.' }
    await pause(SETTLE_MS)
    const frame = await new ImageCapture(video).grabFrame()
    try {
      const { bytes, width, height } = await jpeg(frame)
      return { id: request.id, picture: { bytes, width, height, ...(video.label ? { camera: video.label } : {}) } }
    } finally {
      frame.close()
    }
  } catch (error) {
    const name = error instanceof DOMException ? error.name : ''
    const problem =
      name === 'NotAllowedError'
        ? 'The system does not let the app use the camera: the person can allow it in the system’s privacy settings.'
        : name === 'NotReadableError'
          ? 'The camera is in use by another app.'
          : name === 'NotFoundError' || name === 'OverconstrainedError'
            ? 'This computer has no camera.'
            : `The camera could not take a picture: ${error instanceof Error ? error.message : String(error)}`
    return { id: request.id, problem }
  } finally {
    for (const track of stream?.getTracks() ?? []) track.stop()
  }
}

/**
 * The `camera` capability's hands, in the window (docs/SPEC.md, section 12.4, more of the device): the app asks for a
 * picture once the person allowed it, and only then may the window use the camera; the picture goes back to the app.
 */
export function serveCamera(): void {
  window.desktop.camera.onCapture((request) => {
    void take(request).then((answer) => window.desktop.camera.answer(answer))
  })
}
