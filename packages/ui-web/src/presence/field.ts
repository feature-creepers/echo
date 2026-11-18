import type { Pose } from './life.ts'

/**
 * What the core does, as the ground round it shows it. The core's phases do not stop at its edge: its own voice
 * goes out through the dots round it, the voice it hears comes in through them, a sweep goes round it while it
 * thinks, a ring goes out with each beat of its work, and as it wakes it throws one wave far across the window.
 * The ground draws all of it (`ground-shader.ts`); these are its numbers for one frame.
 */
export interface Field {
  /**
   * How much of it is drawn as the instrument draws: in fine lines of light, from 1, or as the lens does, in soft
   * light, at 0.
   */
  fine: number
  /** How much of its own voice, going out, shows. */
  speaking: number
  /** How much of the voice it hears, coming in, shows. */
  listening: number
  /** The sweep that goes round it while it thinks: how much of it shows, and where its head is, in turns counter-clockwise from the right. */
  sweep: number
  sweepAt: number
  /** The ring that goes out with each beat of its work: how much of it shows, and how far it has gone, from 0 at the core to 1 where it is gone. */
  beat: number
  beatAt: number
  /** The wave it throws as it wakes: how far it has gone, from 0 at the core to 1, where it is gone. */
  wave: number
  /** How far the rings that carry its voice have travelled since the last one left the core, as a share of the gap between two. */
  travel: number
}

/** How far beyond the core's edge its voice, its sweep and its beat reach, in the core's radii. */
export const FIELD_REACH = 3.2

/**
 * How fast its voice travels through the ground, in the core's radii a second: slow enough to follow with the eye,
 * and so that what it said a second ago, which is as far back as it remembers, has just reached the field's edge.
 */
export const FIELD_SPEED = 3.2

/** How far apart the rings that carry the voice are, in the core's radii. */
export const FIELD_GAP = 0.4

/** How far the wave thrown at waking goes, in the core's radii: well across the window. */
export const WAVE_REACH = 9

/** When in its waking each look throws its wave, as a share of the waking: once its light has ignited. */
const IGNITED = 0.13

/** By when in the waking the wave is gone. */
const SPENT = 0.86

export function restingField(): Field {
  return { fine: 1, speaking: 0, listening: 0, sweep: 0, sweepAt: 0.25, beat: 0, beatAt: 1, wave: 1, travel: 0 }
}

/** The field of one frame of the core's life. */
export function fieldOf(pose: Pose, into: Field = restingField()): Field {
  const { weights, looks, wake, hud, lens, clock } = pose
  into.fine = looks.hud
  into.speaking = weights.speaking
  into.listening = weights.listening
  into.sweep = weights.thinking
  into.sweepAt = hud.scanAngle / (Math.PI * 2)
  into.beat = weights.working
  // The lens's beat enters a little before the lamp and leaves a little past the glass: the ring starts with it.
  into.beatAt = Math.min(1, Math.max(0, (lens.beatAt + 0.1) / 1.3))
  // The wave belongs to the look that shows.
  const woken = looks.hud >= looks.lens ? wake.hud : wake.lens
  into.wave = Math.min(1, Math.max(0, (woken - IGNITED) / (SPENT - IGNITED)))
  into.travel = ((clock * FIELD_SPEED) / FIELD_GAP) % 1
  return into
}
