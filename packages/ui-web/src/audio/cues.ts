import { route } from './devices.ts'

/** The sounds that mark the microphone opening and closing, and an answer ready in the background. */
type Cue = 'open' | 'close' | 'ready'

/**
 * Each cue's notes, in hertz: rising as the app starts to listen, falling as it stops, and higher, a step apart, for
 * an answer that is ready, so it is not taken for the microphone.
 */
const NOTES: Record<Cue, [number, number]> = { open: [587.33, 880], close: [880, 587.33], ready: [1046.5, 1174.66] }

let context: AudioContext | undefined

/**
 * Play a cue: two short soft notes, made on the spot rather than shipped as recordings. Quiet, so that it
 * marks the moment without startling, and short, so that it is over before the person speaks.
 */
export function playCue(cue: Cue, sink: string | undefined): void {
  context ??= new AudioContext()
  const audio = context
  void route(audio, sink).then(() => {
    const start = audio.currentTime + 0.01
    NOTES[cue].forEach((frequency, index) => {
      const at = start + index * 0.075
      const tone = audio.createOscillator()
      const volume = audio.createGain()
      tone.type = 'sine'
      tone.frequency.value = frequency
      volume.gain.setValueAtTime(0, at)
      volume.gain.linearRampToValueAtTime(0.07, at + 0.012)
      volume.gain.exponentialRampToValueAtTime(0.0001, at + 0.16)
      tone.connect(volume).connect(audio.destination)
      tone.start(at)
      tone.stop(at + 0.18)
    })
  })
}
