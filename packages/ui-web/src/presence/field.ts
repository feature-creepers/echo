import type { Pose } from './life.ts'

/**
 * What the core does, as the ground round it shows it. Only the voice goes on past the core's edge: its own voice
 * goes out through the dots round it, and the voice it hears comes in through them. What it does without a voice,
 * thinking or working, stays inside the core, so the ground stays calm under it. The ground draws it
 * (`ground-shader.ts`); these are its numbers for one frame.
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
  /** How far the rings that carry its voice have travelled since the last one left the core, as a share of the gap between two. */
  travel: number
}

/** How far beyond the core's edge its voice reaches, in the core's radii. */
export const FIELD_REACH = 3.2

/**
 * How fast its voice travels through the ground, in the core's radii a second: slow enough to follow with the eye,
 * and so that what it said a second ago, which is as far back as it remembers, has just reached the field's edge.
 */
export const FIELD_SPEED = 3.2

/** How far apart the rings that carry the voice are, in the core's radii. */
export const FIELD_GAP = 0.4

export function restingField(): Field {
  return { fine: 1, speaking: 0, listening: 0, travel: 0 }
}

/** The field of one frame of the core's life. */
export function fieldOf(pose: Pose, into: Field = restingField()): Field {
  const { weights, looks, clock } = pose
  into.fine = looks.hud
  into.speaking = weights.speaking
  into.listening = weights.listening
  into.travel = ((clock * FIELD_SPEED) / FIELD_GAP) % 1
  return into
}
