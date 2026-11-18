import type { AudioDevice } from '@repo/client'

/** What a browser says of a device: the part of `MediaDeviceInfo` used here. */
export interface SeenDevice {
  deviceId: string
  kind: string
  label: string
}

export type AudioKind = 'audioinput' | 'audiooutput'

/** Drop what a system adds to a name for itself: "Microphone (Yeti) (b58e:9e84)" is "Microphone (Yeti)", "Default - Speakers" is "Speakers". */
export function cleanLabel(label: string): string {
  return label
    .replace(/^(Default|Communications)\s*-\s*/i, '')
    .replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '')
    .trim()
}

/** Identifiers that stand for a choice the system makes, not for a device. */
const STAND_INS = new Set(['', 'default', 'communications'])

/** The devices of a kind, each once, and the name of the one the system uses now. */
export function devicesOf(seen: readonly SeenDevice[], kind: AudioKind): { system: string; devices: AudioDevice[] } {
  const ofKind = seen.filter((device) => device.kind === kind)
  const usual = ofKind.find((device) => device.deviceId === 'default') ?? ofKind[0]
  return {
    system: usual ? cleanLabel(usual.label) : '',
    devices: ofKind.filter((device) => !STAND_INS.has(device.deviceId)).map((device) => ({ id: device.deviceId, label: cleanLabel(device.label) }))
  }
}

/**
 * The identifier to open the chosen device with, among those there now. Its identifier first; else its
 * name, since an identifier can change from one connection to the next. Nothing for the system's own
 * choice, and nothing when the device is gone: the system's choice is then used, rather than no sound.
 */
export function resolveDevice(chosen: AudioDevice, seen: readonly SeenDevice[], kind: AudioKind): string | undefined {
  if (STAND_INS.has(chosen.id)) return undefined
  // A stand-in carries the name of the device it stands for: only real devices are matched.
  const ofKind = seen.filter((device) => device.kind === kind && !STAND_INS.has(device.deviceId))
  return (
    ofKind.find((device) => device.deviceId === chosen.id)?.deviceId ??
    (chosen.label ? ofKind.find((device) => cleanLabel(device.label) === chosen.label)?.deviceId : undefined)
  )
}

/**
 * The devices of a kind on this computer. Their names are hidden until the window has been allowed the
 * microphone, so it is asked for once when they are missing.
 */
export async function listDevices(kind: AudioKind): Promise<{ system: string; devices: AudioDevice[] }> {
  let seen = await navigator.mediaDevices.enumerateDevices()
  if (seen.some((device) => device.kind === kind) && seen.every((device) => device.label === '')) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    for (const track of stream.getTracks()) track.stop()
    seen = await navigator.mediaDevices.enumerateDevices()
  }
  return devicesOf(seen, kind)
}

/** The identifier to open the chosen device with now. Nothing for the system's choice. */
export async function findDevice(chosen: AudioDevice, kind: AudioKind): Promise<string | undefined> {
  if (STAND_INS.has(chosen.id)) return undefined
  return resolveDevice(chosen, await navigator.mediaDevices.enumerateDevices(), kind)
}

/**
 * Open a microphone: the one chosen, or the system's when it is gone or will not open. Echo cancellation
 * keeps the assistant's own voice out of what is heard.
 */
export async function openMicrophone(chosen: AudioDevice): Promise<MediaStream> {
  const constraints = (id: string | undefined): MediaStreamConstraints => ({
    audio: { ...(id ? { deviceId: { exact: id } } : {}), channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  })
  const id = await findDevice(chosen, 'audioinput')
  try {
    return await navigator.mediaDevices.getUserMedia(constraints(id))
  } catch (error) {
    const gone = error instanceof DOMException && ['OverconstrainedError', 'NotFoundError', 'NotReadableError'].includes(error.name)
    if (id === undefined || !gone) throw error
    return navigator.mediaDevices.getUserMedia(constraints(undefined))
  }
}

/** An AudioContext that can be sent to other speakers: Chromium has this, and the DOM's types do not yet. */
interface RoutableContext {
  setSinkId?: (id: string) => Promise<void>
}

/** Send a context's sound to a device, or to the system's choice. A device that is gone leaves the sound where it was. */
export async function route(context: AudioContext, sink: string | undefined): Promise<void> {
  const routable = context as unknown as RoutableContext
  try {
    await routable.setSinkId?.(sink ?? '')
  } catch {
    if (sink) await routable.setSinkId?.('').catch(() => undefined)
  }
}
