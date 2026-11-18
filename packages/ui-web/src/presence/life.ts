import { LOOKS, type Look } from '@repo/protocol'

/**
 * The life behind the core, worked out on the processor once per frame: how far each mood and each look is in
 * effect, the voice, the pulse, the breath, and the clocks things turn and drift by. The drawings, on the graphics
 * card (`lens-shader.ts`, `hud-shader.ts`) or on a 2D canvas (`painter.ts`), only draw what this hands them, so
 * all of the motion design lives here, in numbers that can be read and tested.
 */

/** What the assistant is doing, as the core shows it. */
export type Mood = 'idle' | 'listening' | 'thinking' | 'speaking' | 'asleep'

const MOODS: readonly Mood[] = ['idle', 'listening', 'thinking', 'speaking', 'asleep']

/** How many past moments of the voice the drawings are given, and how far apart: about a second. */
export const ECHO_LENGTH = 32
export const ECHO_STEP = 1 / 30

/** How fast moods cross-fade: about a third of a second, quick to start and long to settle. */
const MOOD_RATE = 5

/** How long a change of look takes, in seconds: the old drawing gives way while the new one settles in. */
export const LOOK_FADE = 0.4

/** How much smaller a look is drawn as it gives way, or before it has settled in: a morph rather than a dissolve. */
export const LOOK_SHRINK = 0.05

/** Asleep, the core breathes once in this many seconds. */
export const BREATH_PERIOD = 7.5

/** The lens's resting pulse: one slow swell of its lamp, a little irregular, slower than a breath. */
export const SWELL_PERIOD = 5.2

/** Thinking, the lens hunts for focus, and a shimmer runs through its elements, once in this many seconds. */
export const FOCUS_PERIOD = 1.8

/** The instrument's core breathes at rest once in this many seconds, as the eye in the composer does. */
export const HUD_BREATH_PERIOD = 4.2

/** What the lens looks like in one mood, before the voice, the pulse and the flicker are added. */
interface LensMood {
  /** How much light the lamp deep in the glass gives. */
  lamp: number
  /** The radius of its white-hot heart, as a share of the glass. */
  focus: number
  /** How far its glow reaches through the glass, against the resting reach. */
  spread: number
  /** How much light the lens elements inside the glass catch. */
  catch: number
  /** How much of the resting pulse and of the lamp's flicker shows. */
  pulse: number
  /** How fast the elements turn, against the resting pace. */
  turn: number
  /** How much of the room's light the metal ring and the glass reflect. */
  room: number
  /** How far the deep light wanders from the centre as the view drifts, as a share of the glass: it holds still to listen. */
  gaze: number
}

/**
 * Each mood's lens. Listening tightens and brightens the light and lets the elements catch more of it, thinking
 * hunts for focus, speaking keeps the light open for the voice to swell, and asleep the lamp sinks to an ember.
 */
const LENS: Record<Mood, LensMood> = {
  idle: { lamp: 1, focus: 0.095, spread: 1, catch: 1, pulse: 1, turn: 1, room: 1, gaze: 1 },
  listening: { lamp: 1.22, focus: 0.074, spread: 0.84, catch: 1.9, pulse: 0.3, turn: 0.4, room: 1, gaze: 0 },
  thinking: { lamp: 0.92, focus: 0.085, spread: 0.95, catch: 1.3, pulse: 0.5, turn: 3, room: 1, gaze: 0.6 },
  speaking: { lamp: 1.06, focus: 0.098, spread: 1.04, catch: 1.25, pulse: 0.2, turn: 1.2, room: 1, gaze: 0.4 },
  asleep: { lamp: 0.13, focus: 0.065, spread: 0.7, catch: 0.15, pulse: 0, turn: 0.25, room: 0.62, gaze: 0 }
}

/** What the instrument looks like in one mood, before the voice and the breath are added. */
interface HudMood {
  /** The light of the small bright core. */
  core: number
  /** The core's size, against the resting size. */
  size: number
  /** How much of the rings shows. */
  rings: number
  /** How far out the rings sit, against where they rest: listening, they draw in round the core. */
  reach: number
  /** How fast the rings turn, against the resting pace. Thinking is set ring by ring, in `HUD_RINGS`. */
  spin: number
  /** How much of the core's breath shows. */
  breath: number
}

/**
 * Each mood's instrument. Listening draws the rings in, thinking turns them fast and sweeps a scan round them,
 * speaking lights the bars of its voice, and asleep every ring fades but one.
 */
const HUD: Record<Mood, HudMood> = {
  idle: { core: 1, size: 1, rings: 1, reach: 1, spin: 1, breath: 1 },
  listening: { core: 1.12, size: 0.92, rings: 1.08, reach: 0.95, spin: 0.5, breath: 0.3 },
  thinking: { core: 0.9, size: 0.9, rings: 0.96, reach: 0.985, spin: 1, breath: 0.4 },
  speaking: { core: 1.08, size: 1.05, rings: 1, reach: 1, spin: 1.4, breath: 0.2 },
  asleep: { core: 0.22, size: 0.72, rings: 0, reach: 1.02, spin: 0.15, breath: 1 }
}

/**
 * The instrument's rings that turn, from the inside out: their resting pace in radians a second, counter-clockwise
 * when positive, and how many times faster thinking turns them. Neighbours turn opposite ways, and the ones that
 * speed up most while thinking are the segmented ones, so the counter-rotation reads at once.
 */
export const HUD_RINGS = [
  /** The broken circle round the core. */
  { pace: 0.07, thinking: 4 },
  /** The band of segments. */
  { pace: -0.11, thinking: 9 },
  /** The circle with its four markers. */
  { pace: 0.04, thinking: 3 },
  /** The bezel of fine ticks. */
  { pace: -0.012, thinking: 1.5 },
  /** The data ring, broken by gaps and blocks. */
  { pace: 0.03, thinking: 7 },
  /** The ring of glyphs. */
  { pace: -0.02, thinking: 2.5 },
  /** The long outer arcs. */
  { pace: 0.014, thinking: 2 }
] as const

/** How fast the scan sweeps round the instrument while thinking, in radians a second, clockwise. */
const SCAN_PACE = 2.8

/** The lens's flicker comes at most once in each slot of this many seconds. */
const FLICKER_SLOT = 2.3

/** A number from 0 to 1 fixed by another, the same every time: what makes the flicker irregular yet testable. */
function hash(value: number) {
  const wave = Math.sin(value * 127.1 + 311.7) * 43758.5453
  return wave - Math.floor(wave)
}

/**
 * The lamp's flicker at a time, as the share of its light it loses: nothing most of the time, and now and then a
 * dip of a few hundredths of a second, sometimes twice, as a filament gives. It depends on the time alone.
 */
export function flicker(time: number): number {
  const slot = Math.floor(time / FLICKER_SLOT)
  const roll = hash(slot)
  if (roll > 0.32) return 0
  const since = time - (slot * FLICKER_SLOT + 0.2 + hash(slot + 0.5) * (FLICKER_SLOT - 0.6))
  if (since < -0.1 || since > 0.3) return 0
  const depth = 0.08 + 0.1 * hash(slot + 0.25)
  const first = Math.exp(-(((since - 0.03) / 0.022) ** 2))
  const second = roll < 0.13 ? 0.55 * Math.exp(-(((since - 0.14) / 0.02) ** 2)) : 0
  return depth * (first + second)
}

/** A smooth step from 0 to 1, for what fades over a set time rather than settling. */
const smooth = (value: number) => {
  const clamped = Math.min(1, Math.max(0, value))
  return clamped * clamped * (3 - 2 * clamped)
}

export interface Input {
  mood: Mood
  /** The look the persona that answers has. */
  look: Look
  /** How loud the voice heard or spoken is right now, from 0 to 1. */
  level: number
  /** Seconds since the previous frame. */
  delta: number
  /** Whether the user asked for less motion: everything that moves holds still, and only moods and looks fade. */
  still: boolean
}

/** What the lens is drawn with in one frame. */
export interface LensPose {
  lamp: number
  focus: number
  spread: number
  catch: number
  room: number
  /** The shimmer that runs through the elements while thinking: how much shows, and where it is, from the outer element (0) to the inner (1). */
  shimmer: number
  shimmerAt: number
  /** Which way the room's light falls across the metal ring, in radians: it wanders, so the ring's highlights turn slowly. */
  sheen: number
  /** How far the elements have turned, in radians. */
  turn: number
  /** How far the deepest light sits off the centre as the view drifts, as a share of the glass; the elements follow it by their depth. */
  depth: readonly [number, number]
}

/** What the instrument is drawn with in one frame. */
export interface HudPose {
  core: number
  size: number
  rings: number
  reach: number
  /** How far each ring of `HUD_RINGS` has turned, in radians. */
  turns: Float32Array
  /** The sweeping scan: where its head is, in radians counter-clockwise from the right, and how much of it shows. */
  scan: number
  scanAngle: number
  /** The meter round the core lit by the voice it hears, as the share of its segments lit. */
  gauge: number
  /** How much the bars round the core follow its own voice. */
  wave: number
  /** The one ring left asleep, breathing. */
  dormant: number
  /** How far the rings sit off one another as the view drifts, in radii of the instrument, the outer ones most. */
  parallax: readonly [number, number]
}

/** What the core draws in one frame. */
export interface Pose {
  /** How far each mood is in effect, from 0 to 1; they add up to 1. */
  weights: Record<Mood, number>
  /** How far each look is in effect, from 0 to 1, while one gives way to the other; they add up to 1. */
  looks: Record<Look, number>
  /** The voice, followed quickly as it rises and more slowly as it falls. */
  level: number
  lens: LensPose
  hud: HudPose
  /**
   * The voice over the last second, newest first, one sample every `ECHO_STEP` seconds: the assistant's own voice,
   * then the voice it hears. Two numbers per sample.
   */
  echo: Float32Array
  /** How far into the next step the newest sample is, from 0 to 1, so what follows the voice glides between samples. */
  echoShift: number
}

export interface Life {
  step(input: Input): Pose
}

export function createLife(initial: Mood = 'idle', look: Look = 'hud'): Life {
  const weights = Object.fromEntries(MOODS.map((mood) => [mood, mood === initial ? 1 : 0])) as Record<Mood, number>
  // How far each look has come, from 0 to 1 at a steady pace; the weights drawn are this, eased.
  const shown = Object.fromEntries(LOOKS.map((each) => [each, each === look ? 1 : 0])) as Record<Look, number>
  const looks = { ...shown }
  const echo = new Float32Array(ECHO_LENGTH * 2)
  const turns = new Float32Array(HUD_RINGS.length)
  let level = 0
  let clock = 0
  let drift = 0
  let swell = 0
  let turn = 0
  // The scan waits at the top, where it also stays when motion is held still.
  let scanAngle = Math.PI / 2
  let sinceSample = 0

  return {
    step({ mood, look: current, level: heard, delta, still }) {
      const ease = 1 - Math.exp(-delta * MOOD_RATE)
      for (const each of MOODS) weights[each] += ((each === mood ? 1 : 0) - weights[each]) * ease
      for (const each of LOOKS) {
        const towards = each === current ? 1 : 0
        shown[each] = towards > shown[each] ? Math.min(towards, shown[each] + delta / LOOK_FADE) : Math.max(towards, shown[each] - delta / LOOK_FADE)
      }
      const eased = LOOKS.reduce((sum, each) => sum + smooth(shown[each]), 0) || 1
      for (const each of LOOKS) looks[each] = smooth(shown[each]) / eased

      // The voice rises fast and falls slower, as an ear follows it, so syllables read as one phrase.
      const target = still ? 0 : heard
      level += (target - level) * (1 - Math.exp(-delta * (target > level ? 18 : 7)))
      const hearing = weights.listening * level
      const saying = weights.speaking * level

      const lensOf = (key: keyof LensMood) => MOODS.reduce((sum, each) => sum + LENS[each][key] * weights[each], 0)
      const hudOf = (key: keyof HudMood) => MOODS.reduce((sum, each) => sum + HUD[each][key] * weights[each], 0)

      if (!still) {
        clock += delta
        drift += delta * (1 - weights.asleep * 0.7)
        // The swell is a little irregular, its period wandering by a tenth, so it never reads as a machine's.
        swell += (delta / SWELL_PERIOD) * (1 + 0.1 * Math.sin(clock * 0.37))
        turn += delta * 0.05 * lensOf('turn')
        scanAngle -= delta * SCAN_PACE
        HUD_RINGS.forEach((ring, index) => {
          const pace = MOODS.reduce((sum, each) => sum + (each === 'thinking' ? ring.thinking : HUD[each].spin) * weights[each], 0)
          turns[index] = ((turns[index] ?? 0) + delta * ring.pace * pace) % (Math.PI * 2)
        })
      }

      // Asleep, a slow breath; awake, the lens's swell and the instrument's breath. Held still, each rests halfway.
      const breath = still ? 0.5 : 0.5 - 0.5 * Math.cos((clock / BREATH_PERIOD) * Math.PI * 2)
      const swelling = still ? 0.5 : 0.5 - 0.5 * Math.cos(swell * Math.PI * 2)
      const hudBreath = still ? 0.5 : 0.5 - 0.5 * Math.cos((clock / HUD_BREATH_PERIOD) * Math.PI * 2)
      const focusing = still ? 0 : Math.sin((clock / FOCUS_PERIOD) * Math.PI * 2)
      const pulse = lensOf('pulse')
      const flickering = still ? 0 : flicker(clock) * pulse

      // The past of the voice, kept at a steady pace whatever the frame rate.
      sinceSample += delta
      while (sinceSample >= ECHO_STEP) {
        sinceSample -= ECHO_STEP
        echo.copyWithin(2, 0, echo.length - 2)
        echo[0] = saying
        echo[1] = hearing
      }

      const gaze = lensOf('gaze') * 0.022
      const sleeping = weights.asleep
      return {
        weights,
        looks,
        level,
        lens: {
          lamp:
            (lensOf('lamp') + hearing * 0.3 + saying * 0.6) * (1 + (swelling - 0.5) * 0.18 * pulse) * (1 - flickering) * (1 - sleeping * 0.4 * (1 - breath)),
          focus: lensOf('focus') * (1 + (swelling - 0.5) * 0.08 * pulse + focusing * 0.14 * weights.thinking) - hearing * 0.008 + saying * 0.022,
          spread: lensOf('spread') + saying * 0.3 + hearing * 0.06,
          catch: lensOf('catch') + hearing * 0.9 + saying * 0.4,
          room: lensOf('room'),
          shimmer: weights.thinking,
          // The shimmer enters before the outer element and leaves past the inner one, so it never jumps.
          shimmerAt: still ? 0.5 : -0.35 + 1.7 * ((clock / FOCUS_PERIOD) % 1),
          sheen: 2.2 + Math.sin(drift * 0.11) * 0.5 + Math.sin(drift * 0.047 + 1.3) * 0.3,
          turn,
          depth: [Math.sin(drift * 0.21) * gaze, Math.sin(drift * 0.16 + 1.1) * gaze]
        },
        hud: {
          core: (hudOf('core') + hearing * 0.25 + saying * 0.5) * (1 + (hudBreath - 0.5) * 0.16 * hudOf('breath')) * (1 - sleeping * 0.35 * (1 - breath)),
          size: hudOf('size') * (1 + (hudBreath - 0.5) * 0.06 * hudOf('breath')) + saying * 0.12,
          rings: hudOf('rings'),
          reach: hudOf('reach') - hearing * 0.012,
          turns,
          scan: weights.thinking,
          scanAngle,
          gauge: hearing,
          wave: weights.speaking,
          dormant: sleeping * (0.3 + 0.7 * breath),
          parallax: [Math.sin(drift * 0.19 + 0.4) * 0.006 * (1 - sleeping), Math.sin(drift * 0.13 + 2.2) * 0.006 * (1 - sleeping)]
        },
        echo,
        echoShift: sinceSample / ECHO_STEP
      }
    }
  }
}
