import { LOOKS, type Look } from '@repo/protocol'

/**
 * The life behind the core, worked out on the processor once per frame: how far each mood and each look is in
 * effect, the voice and its spectrum, where the core looks, how hard the computer works, the pulse, the breath, and
 * the clocks things turn and drift by. The drawings, on the graphics card (`lens-shader.ts`, `hud-shader.ts`) or on
 * a 2D canvas (`painter.ts`), only draw what this hands them, so all of the motion design lives here, in numbers
 * that can be read and tested.
 */

/**
 * What the assistant is doing, as the core shows it. Thinking is the assistant making up its mind; working is a tool
 * at work for it: a search, a command, a page it reads.
 */
export type Mood = 'idle' | 'listening' | 'thinking' | 'working' | 'speaking' | 'asleep'

export const MOODS: readonly Mood[] = ['idle', 'listening', 'thinking', 'working', 'speaking', 'asleep']

/** How many past moments of the voice the drawings are given, and how far apart: about a second. */
export const ECHO_LENGTH = 32
export const ECHO_STEP = 1 / 30

/** How many bands the voice's spectrum is read in, from its low notes to its high ones. */
export const BANDS = 16

/** How fast moods cross-fade: about a third of a second, quick to start and long to settle. */
const MOOD_RATE = 5

/** How long a change of look takes, in seconds: the old drawing gives way while the new one settles in. */
export const LOOK_FADE = 0.4

/** How much smaller a look is drawn as it gives way, or before it has settled in: a morph rather than a dissolve. */
export const LOOK_SHRINK = 0.05

/** Asleep, the core breathes once in this many seconds. */
export const BREATH_PERIOD = 7.5

/** The lens's resting pulse: one slow swell of its light, a little irregular, slower than a breath. */
export const SWELL_PERIOD = 5.2

/** Thinking, the lens hunts for focus, and a shimmer runs through its elements, once in this many seconds. */
export const FOCUS_PERIOD = 1.8

/** Working, a beat runs through the core once in this many seconds, steady, as a machine at work. */
export const WORK_PERIOD = 1.25

/** The instrument's core breathes at rest once in this many seconds, as the eye in the composer does. */
export const HUD_BREATH_PERIOD = 4.2

/**
 * How the computer's load is read when nothing says: about what a computer at rest with an app open does, so the
 * core looks as it always has.
 */
export const RESTING_LOAD = 0.3

/**
 * How the core turns its eye: a spring stiff enough to read as a glance, damped enough to settle without
 * overshooting much, as an eye fixes on what it looks at.
 */
const GAZE_SPRING = { stiffness: 150, damping: 21 } as const

/** How far the core's face turns towards what it looks at, in radians, at the edge of its gaze: subtle, as a glance. */
export const TILT = 0.17

/** With nothing to look at, the core rests its gaze in a new place once in about this many seconds. */
const WANDER_SLOT = 2.9

/** What the lens looks like in one mood, before the voice, the pulse, the power and the flicker are added. */
interface LensMood {
  /** How much light the lamp deep in the glass gives. */
  lamp: number
  /** The radius of the lamp's disc of amber, as a share of the glass. */
  heart: number
  /** How far the red round the disc reaches into the glass, against its resting reach. */
  iris: number
  /** How much light the lens elements inside the glass catch. */
  catch: number
  /** How much of the resting pulse and of the lamp's flicker shows. */
  pulse: number
  /** How fast the elements turn, against the resting pace. */
  turn: number
  /** How much of the room's light the metal and the glass reflect. */
  room: number
  /** How far the deep light wanders from the centre as the view drifts, as a share of the glass: it holds still to listen. */
  wander: number
}

/**
 * Each mood's lens. Listening tightens the iris and lets the elements catch more light, thinking hunts for focus,
 * working steadies the light and sends a beat out through it, speaking opens the iris for the voice to swell, and
 * asleep the lamp sinks to an ember.
 */
const LENS: Record<Mood, LensMood> = {
  idle: { lamp: 1, heart: 0.088, iris: 1, catch: 1, pulse: 1, turn: 1, room: 1, wander: 1 },
  listening: { lamp: 1.1, heart: 0.08, iris: 0.88, catch: 1.8, pulse: 0.3, turn: 0.4, room: 1, wander: 0 },
  thinking: { lamp: 0.95, heart: 0.085, iris: 0.95, catch: 1.3, pulse: 0.5, turn: 3, room: 1, wander: 0.5 },
  working: { lamp: 1.05, heart: 0.089, iris: 1.02, catch: 1.4, pulse: 0.25, turn: 2.2, room: 1, wander: 0.3 },
  speaking: { lamp: 1.03, heart: 0.09, iris: 1.05, catch: 1.25, pulse: 0.2, turn: 1.2, room: 1, wander: 0.4 },
  asleep: { lamp: 0.18, heart: 0.072, iris: 0.75, catch: 0.15, pulse: 0, turn: 0.25, room: 0.62, wander: 0 }
}

/** What the instrument looks like in one mood, before the voice, the power and the breath are added. */
interface HudMood {
  /** The light of the small bright core. */
  core: number
  /** The core's size, against the resting size. */
  size: number
  /** How much of the rings shows. */
  rings: number
  /** How far out the rings sit, against where they rest: listening, they draw in round the core. */
  reach: number
  /** How fast the rings turn, against the resting pace. Thinking and working are set ring by ring, in `HUD_RINGS`. */
  spin: number
  /** How much of the core's breath shows. */
  breath: number
}

/**
 * Each mood's instrument. Listening draws the rings in, thinking turns them fast and sweeps a scan round them,
 * working runs a chase round its data ring and steps its markers round, speaking lights the bars of its voice, and
 * asleep every ring fades but one.
 */
const HUD: Record<Mood, HudMood> = {
  idle: { core: 1, size: 1, rings: 1, reach: 1, spin: 1, breath: 1 },
  listening: { core: 1.12, size: 0.92, rings: 1.08, reach: 0.95, spin: 0.5, breath: 0.3 },
  thinking: { core: 0.9, size: 0.9, rings: 0.96, reach: 0.985, spin: 1, breath: 0.4 },
  working: { core: 1.05, size: 0.96, rings: 1.04, reach: 1, spin: 1, breath: 0.2 },
  speaking: { core: 1.08, size: 1.05, rings: 1, reach: 1, spin: 1.4, breath: 0.2 },
  asleep: { core: 0.22, size: 0.72, rings: 0, reach: 1.02, spin: 0.15, breath: 1 }
}

/**
 * The instrument's rings that turn, from the inside out: their resting pace in radians a second, counter-clockwise
 * when positive, and how many times faster thinking and working turn them. Neighbours turn opposite ways, and the
 * ones that speed up most while thinking are the segmented ones, so the counter-rotation reads at once; working
 * turns them more evenly, as a mechanism at a steady task.
 */
export const HUD_RINGS = [
  /** The broken circle round the core. */
  { pace: 0.07, thinking: 4, working: 2.5 },
  /** The band of segments. */
  { pace: -0.11, thinking: 9, working: 3 },
  /** The circle with its four markers, which step round while working rather than turn. */
  { pace: 0.04, thinking: 3, working: 0 },
  /** The bezel of fine ticks. */
  { pace: -0.012, thinking: 1.5, working: 1.5 },
  /** The data ring, broken by gaps and blocks. */
  { pace: 0.03, thinking: 7, working: 2 },
  /** The ring of glyphs. */
  { pace: -0.02, thinking: 2.5, working: 2 },
  /** The long outer arcs. */
  { pace: 0.014, thinking: 2, working: 1.5 }
] as const

/**
 * The motes of light that ride three of the instrument's rings, from the inside out: how fast each goes round, in
 * turns a second, counter-clockwise when positive, and how many times faster thinking sends them.
 */
export const HUD_MOTES = [
  { pace: 0.12, thinking: 3.5 },
  { pace: -0.05, thinking: 3 },
  { pace: 0.022, thinking: 4 }
] as const

/** A glint runs along the instrument's long outer arcs once in this many seconds. */
export const GLINT_PERIOD = 6.5

/** How fast the scan sweeps round the instrument while thinking, in radians a second, clockwise. */
const SCAN_PACE = 2.8

/** Working, the markers step a quarter of their spacing round once a beat, each step quick and settled. */
const MARKER_STEP = Math.PI / 8

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
  const depth = 0.05 + 0.06 * hash(slot + 0.25)
  const first = Math.exp(-(((since - 0.03) / 0.022) ** 2))
  const second = roll < 0.13 ? 0.55 * Math.exp(-(((since - 0.14) / 0.02) ** 2)) : 0
  return depth * (first + second)
}

/**
 * Where the core rests its gaze with nothing to look at, at a time: a new place once in a slot of about three
 * seconds, near the middle and now and then right in it, as an eye at rest fixes here and there. It depends on the
 * time alone.
 */
export function wander(time: number): [number, number] {
  const slot = Math.floor(time / WANDER_SLOT + 0.37 * Math.sin(time * 0.11))
  if (hash(slot + 0.7) < 0.3) return [0, 0]
  const angle = hash(slot) * Math.PI * 2
  const reach = 0.12 + 0.16 * hash(slot + 0.3)
  return [Math.cos(angle) * reach, Math.sin(angle) * reach * 0.7]
}

/** A smooth step from 0 to 1, for what fades over a set time rather than settling. */
const smooth = (value: number) => {
  const clamped = Math.min(1, Math.max(0, value))
  return clamped * clamped * (3 - 2 * clamped)
}

/**
 * A voice's spectrum when there is none to read: the level shared out over the bands as a voice's is, most of it
 * in the low and middle notes where the vowels are, the rest moving with the syllables. It keeps the core alive
 * while sentences are shown, not played.
 */
export function spectrumOf(level: number, time: number, into: Float32Array): Float32Array {
  for (let band = 0; band < into.length; band++) {
    const at = band / Math.max(1, into.length - 1)
    // Two formants that drift with the syllables, over a slope that falls towards the high notes.
    const first = Math.exp(-(((at - 0.22 - 0.06 * Math.sin(time * 5.1)) / 0.13) ** 2))
    const second = 0.75 * Math.exp(-(((at - 0.55 - 0.08 * Math.sin(time * 3.7 + 1.2)) / 0.16) ** 2))
    const air = 0.25 * (0.5 + 0.5 * Math.sin(time * 17.3 + band * 2.1))
    into[band] = Math.min(1, level * (0.35 + first + second + air * at) * (1 - 0.35 * at))
  }
  return into
}

export interface Input {
  mood: Mood
  /** The look the persona that answers has. */
  look: Look
  /** How loud the voice heard or spoken is right now, from 0 to 1. */
  level: number
  /** The voice's spectrum, `BANDS` numbers from 0 to 1 from its low notes to its high ones. Left out, made from the level. */
  bands?: ArrayLike<number> | undefined
  /**
   * Where the core looks, as a direction from its centre across the screen, up as up, each from -1 to 1. Left out,
   * it has nothing to look at, and rests its gaze here and there by itself.
   */
  gaze?: readonly [number, number] | undefined
  /** How hard the computer works, from 0 to 1. Left out, as a computer at rest does. */
  load?: number | undefined
  /** Seconds since the previous frame. */
  delta: number
  /** Whether the user asked for less motion: everything that moves holds still, and only moods and looks fade. */
  still: boolean
}

/** What the lens is drawn with in one frame. */
export interface LensPose {
  lamp: number
  /** The white-hot heart's radius, and the red iris's, as shares of the glass. */
  heart: number
  iris: number
  catch: number
  room: number
  /** The shimmer that runs through the elements while thinking: how much shows, and where it is, from the outer element (0) to the inner (1). */
  shimmer: number
  shimmerAt: number
  /** How far the elements are drawn in or out as the lens hunts for focus, against their resting radius. */
  focus: number
  /** The beat that runs out through the light while working: where it is, from the heart (0) to the edge of the glass (1), and how much shows. */
  beat: number
  beatAt: number
  /** Which way the room's light falls across the metal ring, in radians: it wanders, so the ring's highlights turn slowly. */
  sheen: number
  /** How far the elements have turned, in radians. */
  turn: number
  /** How far the deepest light sits off the centre, as a share of the glass, from the drift of the view and where it looks; the elements follow it by their depth. */
  depth: readonly [number, number]
  /** How much of the voice each element catches, from the outer element, which takes the low notes, to the inner, which takes the high. */
  voice: readonly [number, number, number, number]
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
  /** The chase round the data ring while working: where its head is, in turns, and how much of it shows. */
  chase: number
  chaseAt: number
  /** The meter round the core lit by the voice it hears, as the share of its segments lit. */
  gauge: number
  /** How much the bars round the core follow its own voice. */
  wave: number
  /** The one ring left asleep, breathing. */
  dormant: number
  /** How far the rings sit off one another as the view drifts, in radii of the instrument, the outer ones most. */
  parallax: readonly [number, number]
  /** Where each mote of `HUD_MOTES` is round its ring, in turns. */
  motes: Float32Array
  /** Where the glint is along the outer arcs, in turns round them. */
  glintAt: number
}

/** What the core draws in one frame. */
export interface Pose {
  /** How far each mood is in effect, from 0 to 1; they add up to 1. */
  weights: Record<Mood, number>
  /** How far each look is in effect, from 0 to 1, while one gives way to the other; they add up to 1. */
  looks: Record<Look, number>
  /** The voice, followed quickly as it rises and more slowly as it falls. */
  level: number
  /** Where the core looks, as `Input.gaze`, followed by its spring. */
  gaze: readonly [number, number]
  /** How strongly it looks at something it was given, from 0 (resting its gaze) to 1. */
  attention: number
  /** How hard the computer works, followed over a few seconds, from 0 to 1. */
  power: number
  lens: LensPose
  hud: HudPose
  /**
   * The voice over the last second, newest first, one sample every `ECHO_STEP` seconds: the assistant's own voice,
   * then the voice it hears. Two numbers per sample.
   */
  echo: Float32Array
  /** How far into the next step the newest sample is, from 0 to 1, so what follows the voice glides between samples. */
  echoShift: number
  /** The voice's spectrum now, `BANDS` bands from low to high: its own voice, then the voice it hears. Two numbers per band. */
  spectrum: Float32Array
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
  const spectrum = new Float32Array(BANDS * 2)
  const heardBands = new Float32Array(BANDS)
  const made = new Float32Array(BANDS)
  const turns = new Float32Array(HUD_RINGS.length)
  const motes = new Float32Array(HUD_MOTES.length)
  let level = 0
  let clock = 0
  let drift = 0
  let swell = 0
  let turn = 0
  let beats = 0
  let power = RESTING_LOAD
  let attention = 0
  const gaze = [0, 0]
  const glancing = [0, 0]
  // The scan waits at the top, where it also stays when motion is held still.
  let scanAngle = Math.PI / 2
  let sinceSample = 0

  return {
    step({ mood, look: current, level: heard, bands, gaze: target, load, delta, still }) {
      const ease = 1 - Math.exp(-delta * MOOD_RATE)
      for (const each of MOODS) weights[each] += ((each === mood ? 1 : 0) - weights[each]) * ease
      for (const each of LOOKS) {
        const towards = each === current ? 1 : 0
        shown[each] = towards > shown[each] ? Math.min(towards, shown[each] + delta / LOOK_FADE) : Math.max(towards, shown[each] - delta / LOOK_FADE)
      }
      const eased = LOOKS.reduce((sum, each) => sum + smooth(shown[each]), 0) || 1
      for (const each of LOOKS) looks[each] = smooth(shown[each]) / eased

      // The voice rises fast and falls slower, as an ear follows it, so syllables read as one phrase.
      const voiced = still ? 0 : heard
      level += (voiced - level) * (1 - Math.exp(-delta * (voiced > level ? 18 : 7)))
      const hearing = weights.listening * level
      const saying = weights.speaking * level
      // Each band of the spectrum is followed the same way, a little quicker, so the notes stay apart.
      const read = bands ?? spectrumOf(voiced, clock, made)
      for (let band = 0; band < BANDS; band++) {
        const value = still ? 0 : Math.min(1, Math.max(0, Number(read[band] ?? 0)))
        heardBands[band] = (heardBands[band] ?? 0) + (value - (heardBands[band] ?? 0)) * (1 - Math.exp(-delta * (value > (heardBands[band] ?? 0) ? 26 : 9)))
        spectrum[band * 2] = (heardBands[band] ?? 0) * weights.speaking
        spectrum[band * 2 + 1] = (heardBands[band] ?? 0) * weights.listening
      }

      // The computer's load is followed over a few seconds, rising quicker than it falls, so a burst of work shows
      // and a moment's pause does not.
      const asked = Math.min(1, Math.max(0, load ?? RESTING_LOAD))
      power += (asked - power) * (1 - Math.exp(-delta / (asked > power ? 1.2 : 3)))
      const vigor = 0.8 + 0.55 * (power - RESTING_LOAD)

      const lensOf = (key: keyof LensMood) => MOODS.reduce((sum, each) => sum + LENS[each][key] * weights[each], 0)
      const hudOf = (key: keyof HudMood) => MOODS.reduce((sum, each) => sum + HUD[each][key] * weights[each], 0)
      const sleeping = weights.asleep

      if (!still) {
        clock += delta
        drift += delta * (1 - sleeping * 0.7)
        // The swell is a little irregular, its period wandering by a tenth, so it never reads as a machine's.
        swell += (delta / SWELL_PERIOD) * (1 + 0.1 * Math.sin(clock * 0.37))
        turn += delta * 0.05 * lensOf('turn') * (0.85 + 0.3 * power)
        beats += delta / WORK_PERIOD
        scanAngle -= delta * SCAN_PACE
        HUD_RINGS.forEach((ring, index) => {
          const pace = MOODS.reduce(
            (sum, each) => sum + (each === 'thinking' ? ring.thinking : each === 'working' ? ring.working : HUD[each].spin) * weights[each],
            0
          )
          turns[index] = ((turns[index] ?? 0) + delta * ring.pace * pace * (0.85 + 0.3 * power)) % (Math.PI * 2)
        })
        HUD_MOTES.forEach((mote, index) => {
          const pace = 1 + (mote.thinking - 1) * weights.thinking + weights.working
          motes[index] = ((((motes[index] ?? 0) + delta * mote.pace * pace * (1 - sleeping)) % 1) + 1) % 1
        })
        // Working, the markers step round once a beat: a quick move, then still, as a mechanism counts.
        const beat = beats % 1
        const stepped = smooth(beat * 3) - smooth((beat - delta / WORK_PERIOD) * 3)
        turns[2] = ((turns[2] ?? 0) + MARKER_STEP * weights.working * Math.max(0, stepped)) % (Math.PI * 2)

        // The gaze, on its spring: towards what it was given, or with nothing to look at, wherever it rests next.
        // Asleep, it settles in the middle. Small steps, so a long frame never throws it.
        const aim = target ?? wander(clock)
        const toward = [(aim[0] ?? 0) * (1 - sleeping), (aim[1] ?? 0) * (1 - sleeping)]
        attention += ((target ? 1 : 0) - attention) * (1 - Math.exp(-delta * 4))
        for (let left = delta; left > 1e-6; left -= 1 / 120) {
          const step = Math.min(left, 1 / 120)
          for (const axis of [0, 1] as const) {
            const pull = GAZE_SPRING.stiffness * ((toward[axis] ?? 0) - (gaze[axis] ?? 0)) - GAZE_SPRING.damping * (glancing[axis] ?? 0)
            glancing[axis] = (glancing[axis] ?? 0) + pull * step
            gaze[axis] = (gaze[axis] ?? 0) + (glancing[axis] ?? 0) * step
          }
        }
      }

      // Asleep, a slow breath; awake, the lens's swell and the instrument's breath. Held still, each rests halfway.
      const breath = still ? 0.5 : 0.5 - 0.5 * Math.cos((clock / BREATH_PERIOD) * Math.PI * 2)
      const swelling = still ? 0.5 : 0.5 - 0.5 * Math.cos(swell * Math.PI * 2)
      const hudBreath = still ? 0.5 : 0.5 - 0.5 * Math.cos((clock / HUD_BREATH_PERIOD) * Math.PI * 2)
      const focusing = still ? 0 : Math.sin((clock / FOCUS_PERIOD) * Math.PI * 2)
      const pulse = lensOf('pulse')
      const flickering = still ? 0 : flicker(clock) * pulse
      // Working, a beat: a quick rise and a long fall, once a period.
      const beatAt = still ? 0 : beats % 1
      const throb = still ? 0 : Math.exp(-beatAt * 5) * (1 - Math.exp(-beatAt * 40))

      // The past of the voice, kept at a steady pace whatever the frame rate.
      sinceSample += delta
      while (sinceSample >= ECHO_STEP) {
        sinceSample -= ECHO_STEP
        echo.copyWithin(2, 0, echo.length - 2)
        echo[0] = saying
        echo[1] = hearing
      }

      // What each lens element catches of the voice: the outer ones the low notes, the inner ones the high.
      const quarter = BANDS / 4
      const voice = [0, 1, 2, 3].map((element) => {
        let sum = 0
        for (let band = element * quarter; band < (element + 1) * quarter; band++) sum += (spectrum[band * 2] ?? 0) + (spectrum[band * 2 + 1] ?? 0)
        return sum / quarter
      }) as [number, number, number, number]

      const drifting = lensOf('wander') * 0.022
      const looking = 0.11 * (1 - sleeping)
      const working = weights.working
      return {
        weights,
        looks,
        level,
        gaze: [gaze[0] ?? 0, gaze[1] ?? 0],
        attention,
        power,
        lens: {
          lamp:
            (lensOf('lamp') + hearing * 0.25 + saying * 0.5 + working * throb * 0.12) *
            (1 + (swelling - 0.5) * 0.07 * pulse) *
            (1 - flickering) *
            (1 - sleeping * 0.4 * (1 - breath)) *
            vigor,
          heart: lensOf('heart') * (1 + (swelling - 0.5) * 0.03 * pulse + focusing * 0.06 * weights.thinking) * (0.95 + 0.15 * power) + saying * 0.006,
          iris: lensOf('iris') * (0.92 + 0.27 * (power - RESTING_LOAD)) + saying * 0.09 + hearing * 0.04,
          catch: (lensOf('catch') + hearing * 0.6 + saying * 0.3) * (0.85 + 0.4 * power),
          room: lensOf('room'),
          shimmer: weights.thinking,
          // The shimmer enters before the outer element and leaves past the inner one, so it never jumps.
          shimmerAt: still ? 0.5 : -0.35 + 1.7 * ((clock / FOCUS_PERIOD) % 1),
          // Thinking, the elements are drawn in and out a hair as the lens hunts for focus.
          focus: 1 + focusing * 0.03 * weights.thinking,
          beat: working,
          beatAt: still ? 2 : -0.1 + 1.3 * beatAt,
          sheen: 2.2 + Math.sin(drift * 0.11) * 0.5 + Math.sin(drift * 0.047 + 1.3) * 0.3,
          turn,
          depth: [Math.sin(drift * 0.21) * drifting + (gaze[0] ?? 0) * looking, Math.sin(drift * 0.16 + 1.1) * drifting + (gaze[1] ?? 0) * looking],
          voice
        },
        hud: {
          core:
            (hudOf('core') + hearing * 0.25 + saying * 0.5 + working * throb * 0.18) *
            (1 + (hudBreath - 0.5) * 0.16 * hudOf('breath')) *
            (1 - sleeping * 0.35 * (1 - breath)) *
            vigor,
          size: hudOf('size') * (1 + (hudBreath - 0.5) * 0.06 * hudOf('breath') + working * throb * 0.04) + saying * 0.12,
          rings: hudOf('rings') * (0.88 + 0.4 * (power - RESTING_LOAD)),
          reach: hudOf('reach') - hearing * 0.012,
          turns,
          scan: weights.thinking,
          scanAngle,
          chase: working,
          chaseAt: (beats * 0.25) % 1,
          gauge: hearing,
          wave: weights.speaking,
          dormant: sleeping * (0.3 + 0.7 * breath),
          parallax: [Math.sin(drift * 0.19 + 0.4) * 0.006 * (1 - sleeping), Math.sin(drift * 0.13 + 2.2) * 0.006 * (1 - sleeping)],
          motes,
          glintAt: still ? 2 : -0.25 + 1.5 * ((clock / GLINT_PERIOD) % 1)
        },
        echo,
        echoShift: sinceSample / ECHO_STEP,
        spectrum
      }
    }
  }
}
