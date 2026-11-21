import type { Mood } from './life.ts'

/**
 * How the eye moves, worked out once per frame as a few numbers its drawing is placed by. The eye is a composition
 * of lines and planes: a ring, a hatched half that turns, an inner ring, a wedge of the accent, a line with a square
 * riding it, and a pupil. A mood shows in the pace of what turns and travels, never in a new shape, and a change of
 * mood eases in, so a turn that goes back and forth between thinking and working reads as one steady state.
 */

/** Where each part of the eye is at one moment. */
export interface EyePose {
  /** How far the hatched half has turned, in degrees. */
  sweep: number
  /** How far the wedge has turned from the top right quarter, in degrees. */
  wedge: number
  /** How far the square is along its line, from 0 at its start to 1 at its end. */
  ride: number
  /** How large the pupil is, 1 at rest. */
  pupil: number
  /** How open the eye is, from 1 to nearly 0 asleep, when the pupil is a line. */
  lid: number
  /** How large the inner ring is, 1 at rest: it opens to listen. */
  iris: number
  /** How strongly the whole eye is drawn, from 0 to 1. */
  strength: number
}

/** The pose and what it is moving by: kept from one frame to the next. */
export interface EyeMotion extends EyePose {
  /** Seconds lived. */
  time: number
  /** How fast the hatched half turns now, in degrees a second. */
  speed: number
  /** The quarter the wedge is going to, counted from the start. */
  quarter: number
  /** Seconds the wedge has rested on its quarter. */
  rested: number
  /** How far the square's journey there and back has gone, in one-way trips. */
  trip: number
}

interface Pace {
  /** Degrees a second the hatched half turns. */
  sweep: number
  /** Seconds the wedge rests on a quarter before stepping to the next. Left out, it rests at the top right. */
  step?: number
  /** Seconds the square takes along its line, one way. Left out, it waits at its start. */
  ride?: number
  iris: number
  lid: number
  strength: number
}

const PACE: Record<Mood, Pace> = {
  idle: { sweep: 26, ride: 7, iris: 1, lid: 1, strength: 1 },
  listening: { sweep: 8, iris: 1.14, lid: 1, strength: 1 },
  thinking: { sweep: 120, step: 0.5, ride: 2.4, iris: 0.94, lid: 1, strength: 1 },
  working: { sweep: 60, step: 1.2, ride: 1.6, iris: 1, lid: 1, strength: 1 },
  speaking: { sweep: 40, ride: 7, iris: 1.04, lid: 1, strength: 1 },
  asleep: { sweep: 0, iris: 0.9, lid: 0.12, strength: 0.45 }
}

/** At rest the pupil swells once in this many seconds; working, it beats once in this many. */
const REST_PERIOD = 3.2
const WORK_PERIOD = 2

/** How large the pupil is in a mood, with a voice this loud (0 to 1) at this moment. */
function pupilOf(mood: Mood, level: number, time: number): number {
  if (mood === 'listening') return 1.2 + 1.5 * level
  if (mood === 'speaking') return 0.9 + 1.8 * level
  if (mood === 'thinking') return 0.8
  if (mood === 'working') return 1 + 0.25 * Math.max(0, Math.cos((time / WORK_PERIOD) * 2 * Math.PI)) ** 4
  if (mood === 'asleep') return 1
  return 1 + 0.175 * (1 - Math.cos((time / REST_PERIOD) * 2 * Math.PI))
}

/** One number a step closer to another: `rate` times a second it covers most of what is left. */
const towards = (from: number, to: number, rate: number, delta: number) => from + (to - from) * (1 - Math.exp(-delta * rate))

/** The eye as it first appears in a mood, at rest. */
export function restingEye(mood: Mood): EyeMotion {
  const pace = PACE[mood]
  return {
    time: 0,
    speed: pace.sweep,
    quarter: 0,
    rested: 0,
    trip: 0,
    sweep: 0,
    wedge: 0,
    ride: 0,
    pupil: pupilOf(mood, 0, 0),
    lid: pace.lid,
    iris: pace.iris,
    strength: pace.strength
  }
}

/** The eye `delta` seconds later, in a mood, with a voice this loud. */
export function advanceEye(eye: EyeMotion, mood: Mood, level: number, delta: number): EyeMotion {
  const pace = PACE[mood]
  const time = eye.time + delta
  const speed = towards(eye.speed, pace.sweep, 3, delta)
  // The wedge steps a quarter at a time while there is something to work out, and comes back round to the top right.
  let { quarter, rested } = eye
  if (pace.step === undefined) {
    quarter = Math.ceil(quarter / 4) * 4
    rested = 0
  } else {
    rested += delta
    if (rested >= pace.step) {
      rested = 0
      quarter += 1
    }
  }
  // The square goes to the end of its line and back, slowing at each end, and goes home when it has nowhere to go.
  const trip = pace.ride === undefined ? 0 : eye.trip + delta / pace.ride
  const along = pace.ride === undefined ? 0 : 0.5 - 0.5 * Math.cos(trip * Math.PI)
  return {
    time,
    speed,
    quarter,
    rested,
    trip,
    sweep: (eye.sweep + speed * delta) % 360,
    wedge: towards(eye.wedge, quarter * 90, 14, delta),
    ride: towards(eye.ride, along, pace.ride === undefined ? 4 : 30, delta),
    pupil: towards(eye.pupil, pupilOf(mood, level, time), 18, delta),
    lid: towards(eye.lid, pace.lid, 5, delta),
    iris: towards(eye.iris, pace.iris, 6, delta),
    strength: towards(eye.strength, pace.strength, 4, delta)
  }
}
