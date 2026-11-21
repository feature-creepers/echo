import { describe, expect, it } from 'vitest'
import { advanceEye, type EyeMotion, restingEye } from './eye-motion.ts'
import type { Mood } from './life.ts'

/** The eye after living `seconds` in a mood, a sixtieth of a second at a time. */
function live(eye: EyeMotion, mood: Mood, seconds: number, level = 0): EyeMotion {
  let now = eye
  for (let frame = 0; frame < Math.round(seconds * 60); frame++) now = advanceEye(now, mood, level, 1 / 60)
  return now
}

describe('the eye', () => {
  it.each([
    { mood: 'idle', turns: true, steps: false, rides: true },
    { mood: 'listening', turns: true, steps: false, rides: false },
    { mood: 'thinking', turns: true, steps: true, rides: true },
    { mood: 'working', turns: true, steps: true, rides: true },
    { mood: 'speaking', turns: true, steps: false, rides: true },
    { mood: 'asleep', turns: false, steps: false, rides: false }
  ] as const)('$mood: the half turns $turns, the wedge steps $steps, the square rides $rides', ({ mood, turns, steps, rides }) => {
    const eye = live(restingEye(mood), mood, 2.5)
    expect(eye.sweep !== 0).toBe(turns)
    expect(eye.wedge > 1).toBe(steps)
    expect(eye.ride > 0.01).toBe(rides)
  })

  it('turns faster to think than at rest, and eases into it', () => {
    const resting = live(restingEye('idle'), 'idle', 1)
    expect(advanceEye(resting, 'thinking', 0, 1 / 60).speed).toBeLessThan(40)
    expect(live(resting, 'thinking', 3).speed).toBeGreaterThan(110)
  })

  it('brings the wedge back to the top right and the square home when the work is done', () => {
    const done = live(live(restingEye('idle'), 'thinking', 1.3), 'listening', 3)
    expect(Math.cos((done.wedge * Math.PI) / 180)).toBeCloseTo(1, 4)
    expect(done.ride).toBeCloseTo(0, 2)
  })

  it.each(['listening', 'speaking'] as const)('opens its pupil with the voice while %s', (mood) => {
    expect(live(restingEye(mood), mood, 1, 1).pupil).toBeGreaterThan(live(restingEye(mood), mood, 1, 0).pupil + 1)
  })

  it('closes and dims to sleep, and opens again', () => {
    const asleep = live(restingEye('idle'), 'asleep', 3)
    expect(asleep.lid).toBeLessThan(0.2)
    expect(asleep.strength).toBeLessThan(0.5)
    expect(live(asleep, 'idle', 3).lid).toBeGreaterThan(0.95)
  })
})
