import type { Mood } from './painter.ts'

/**
 * The life behind the eye, worked out on the processor once per frame: how far each mood is in effect, the
 * pulse, the breath, the voice, and the clocks the light drifts and circles by. The lens only draws what this
 * hands it, so all of the motion design lives here, in numbers that can be read and tested.
 */

/** What the eye looks like in one mood, before the voice and the pulse are added. */
interface Look {
  /** The pupil's radius, as a share of the lens. */
  aperture: number
  /** The light seen through the pupil. */
  heart: number
  /** The light caught by the iris around it. */
  iris: number
  /** The thin edge of the lens. */
  rim: number
  /** How fast the light under the surface drifts, against the resting pace. */
  drift: number
  /** How much of the resting pulse shows. */
  beat: number
  /** How large the lens is drawn: it leans in a little while listening, and settles back asleep. */
  scale: number
  /** How far the inner light wanders from the centre, as a share of the lens: it holds still to listen. */
  gaze: number
}

/**
 * Each mood's look. Listening opens the pupil and lights the iris, thinking narrows it and hands the light to
 * the circling glow, speaking keeps it open for the voice, and asleep it closes to an ember.
 */
const LOOKS: Record<Mood, Look> = {
  idle: { aperture: 0.2, heart: 1, iris: 1, rim: 1, drift: 1, beat: 1, scale: 1, gaze: 0.025 },
  listening: { aperture: 0.24, heart: 1, iris: 1.1, rim: 1.2, drift: 0.7, beat: 0.25, scale: 1.025, gaze: 0 },
  thinking: { aperture: 0.17, heart: 0.8, iris: 0.85, rim: 0.95, drift: 1.8, beat: 0.35, scale: 1, gaze: 0.015 },
  speaking: { aperture: 0.21, heart: 1, iris: 1.05, rim: 1.1, drift: 1.2, beat: 0.15, scale: 1.01, gaze: 0.01 },
  asleep: { aperture: 0.13, heart: 0.3, iris: 0.35, rim: 0.5, drift: 0.3, beat: 0, scale: 0.985, gaze: 0 }
}

const MOODS = Object.keys(LOOKS) as Mood[]

/** How many past moments of the voice and the pulse the lens is given, and how far apart: about a second. */
export const ECHO_LENGTH = 32
export const ECHO_STEP = 1 / 30

/** The resting pulse: two beats close together, then a long rest, slower than a heart so it reads as calm. */
const PULSE_PERIOD = 2.4
/** Asleep, a single slow breath replaces the pulse. */
const BREATH_PERIOD = 7.5

/** One beat: a quick rise and a long fall (two exponentials, peaking at 1 a tenth of a second in), so it is felt more than seen. */
const beat = (time: number) => (time < 0 ? 0 : (Math.exp(-time / 0.35) - Math.exp(-time / 0.05)) / 0.62)

/** The resting pulse at a time, from 0 to 1: a beat, and a softer one a third of a second after it. */
export function pulse(time: number): number {
  const phase = time % PULSE_PERIOD
  return beat(phase) + 0.45 * beat(phase - 0.36)
}

export interface Input {
  mood: Mood
  /** How loud the voice heard or spoken is right now, from 0 to 1. */
  level: number
  /** Seconds since the previous frame. */
  delta: number
  /** Whether the user asked for less motion: everything that moves holds still, and only the moods fade. */
  still: boolean
}

/** What the lens draws in one frame. */
export interface Pose {
  /** How far each mood is in effect, from 0 to 1; they add up to 1. */
  weights: Record<Mood, number>
  /** The voice, followed quickly as it rises and more slowly as it falls. */
  level: number
  aperture: number
  heart: number
  iris: number
  rim: number
  scale: number
  /** Where the inner light is, off the centre, in lens radii. */
  gaze: readonly [number, number]
  /** The clock the light under the surface drifts by, in seconds at the resting pace. */
  drift: number
  /** Where the circling light is, in radians counter-clockwise from the right, and how much of it shows. */
  orbit: number
  orbitStrength: number
  /**
   * What travels through the iris, newest first, one sample every `ECHO_STEP` seconds: outwards, the pulse and
   * the assistant's own voice; inwards, the voice it hears. Two numbers per sample.
   */
  echo: Float32Array
  /** How far into the next step the newest sample is, from 0 to 1, so waves glide between samples. */
  echoShift: number
}

export interface Life {
  step(input: Input): Pose
}

export function createLife(initial: Mood = 'idle'): Life {
  const weights = Object.fromEntries(MOODS.map((mood) => [mood, mood === initial ? 1 : 0])) as Record<Mood, number>
  const echo = new Float32Array(ECHO_LENGTH * 2)
  let level = 0
  let clock = 0
  let drift = 0
  // The circling light starts at the top, where it also waits when motion is held still.
  let orbit = Math.PI / 2
  let sinceSample = 0

  return {
    step({ mood, level: heard, delta, still }) {
      // Moods cross-fade over about a third of a second, quick to start and long to settle.
      const ease = 1 - Math.exp(-delta * 5)
      for (const each of MOODS) weights[each] += ((each === mood ? 1 : 0) - weights[each]) * ease
      // The voice rises fast and falls slower, as an ear follows it, so syllables read as one phrase.
      const target = still ? 0 : heard
      level += (target - level) * (1 - Math.exp(-delta * (target > level ? 18 : 7)))

      const look = (key: keyof Look) => MOODS.reduce((sum, each) => sum + LOOKS[each][key] * weights[each], 0)
      if (!still) {
        clock += delta
        drift += delta * look('drift')
        // Clockwise, as the eye in the composer turns, and slower, as a larger thing would.
        orbit -= delta * 2.4
      }

      const beating = still ? 0 : pulse(clock) * look('beat')
      const breath = still ? 0.5 : 0.5 - 0.5 * Math.cos((clock / BREATH_PERIOD) * Math.PI * 2)
      const hearing = weights.listening * level
      const saying = weights.speaking * level

      // The past of the voice and the pulse, kept at a steady pace whatever the frame rate.
      sinceSample += delta
      while (sinceSample >= ECHO_STEP) {
        sinceSample -= ECHO_STEP
        echo.copyWithin(2, 0, echo.length - 2)
        echo[0] = beating * 0.6 + saying
        echo[1] = hearing
      }

      return {
        weights,
        level,
        aperture: look('aperture') + hearing * 0.045 + saying * 0.03 + beating * 0.006 + weights.asleep * 0.014 * (breath - 0.5),
        heart: (look('heart') + saying * 0.45 + hearing * 0.12 + beating * 0.2) * (1 - weights.asleep * 0.35 * (1 - breath)),
        iris: look('iris') + hearing * 0.4 + saying * 0.25,
        rim: look('rim') * (1 - weights.asleep * 0.25 * (1 - breath)) + hearing * 0.3,
        scale: look('scale') + hearing * 0.02,
        gaze: [Math.sin(drift * 0.23) * look('gaze'), Math.sin(drift * 0.17 + 1.1) * look('gaze')],
        drift,
        orbit,
        orbitStrength: weights.thinking,
        echo,
        echoShift: sinceSample / ECHO_STEP
      }
    }
  }
}
