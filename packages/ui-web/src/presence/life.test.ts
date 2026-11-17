import { describe, expect, it } from 'vitest'
import { createLife, ECHO_STEP, type Input, type Pose, pulse } from './life.ts'
import type { Mood } from './painter.ts'

const FRAME = 1 / 60

/** Lives through some seconds at sixty frames a second, and gives every pose on the way. */
function live(seconds: number, input: Partial<Input> & { mood: Mood }, life = createLife()) {
  const poses: Pose[] = []
  for (let frame = 0; frame < Math.round(seconds * 60); frame++) {
    const pose = life.step({ level: 0, delta: FRAME, still: false, ...input })
    poses.push({ ...pose, weights: { ...pose.weights }, echo: pose.echo.slice() })
  }
  return { life, poses }
}

describe('the life behind the eye', () => {
  it('beats twice then rests, never past full strength', () => {
    const samples = Array.from({ length: 2400 }, (_, index) => pulse(index / 1000))
    expect(Math.max(...samples)).toBeLessThanOrEqual(1)
    expect(Math.max(...samples)).toBeGreaterThan(0.95)
    // The second beat is softer than the first, and most of the period is rest.
    expect(pulse(0.47)).toBeLessThan(pulse(0.11))
    expect(samples.filter((value) => value < 0.1).length / samples.length).toBeGreaterThan(0.4)
  })

  it('fades from one mood to the next without a jump, the moods always adding up to one', () => {
    const { life } = live(2, { mood: 'idle' })
    const { poses } = live(1.5, { mood: 'thinking' }, life)
    let previous = 0
    for (const pose of poses) {
      const total = Object.values(pose.weights).reduce((sum, weight) => sum + weight, 0)
      expect(total).toBeCloseTo(1, 6)
      expect(pose.weights.thinking - previous).toBeLessThan(0.1)
      previous = pose.weights.thinking
    }
    expect(poses[17]?.weights.thinking).toBeGreaterThan(0.6)
    expect(poses.at(-1)?.weights.thinking).toBeGreaterThan(0.99)
    expect(poses.at(-1)?.orbitStrength).toBeGreaterThan(0.99)
  })

  it('opens the pupil to a voice it hears, and closes it asleep', () => {
    const idle = live(2, { mood: 'idle' }).poses.at(-1)
    const quiet = live(2, { mood: 'listening', level: 0 }).poses.at(-1)
    const loud = live(2, { mood: 'listening', level: 1 }).poses.at(-1)
    const asleep = live(3, { mood: 'asleep' }).poses.at(-1)
    expect(quiet?.aperture).toBeGreaterThan(idle?.aperture ?? 1)
    expect(loud?.aperture).toBeGreaterThan(quiet?.aperture ?? 1)
    expect(asleep?.aperture).toBeLessThan(idle?.aperture ?? 0)
    expect(asleep?.heart).toBeLessThan(0.5)
  })

  it('sends its own voice outwards and the voice it hears inwards, at a steady pace whatever the frame rate', () => {
    const speaking = live(1, { mood: 'speaking', level: 0.8 }).poses.at(-1)
    expect(speaking?.echo[0]).toBeGreaterThan(0.5)
    expect(speaking?.echo[1]).toBe(0)
    const listening = live(1, { mood: 'listening', level: 0.8 }).poses.at(-1)
    expect(listening?.echo[1]).toBeGreaterThan(0.5)

    // Thirty frames a second keep the same history as sixty.
    const slow = createLife('speaking')
    let pose: Pose | undefined
    for (let frame = 0; frame < 30; frame++) pose = slow.step({ mood: 'speaking', level: frame < 15 ? 1 : 0, delta: 1 / 30, still: false })
    const samplesSinceSilence = Math.round(0.5 / ECHO_STEP)
    expect(pose?.echo[(samplesSinceSilence + 2) * 2]).toBeGreaterThan(0.5)
  })

  it('holds still when asked for less motion, and still fades between moods', () => {
    const { life, poses } = live(1, { mood: 'speaking', level: 1, still: true })
    expect(new Set(poses.map((pose) => pose.drift)).size).toBe(1)
    expect(new Set(poses.map((pose) => pose.orbit)).size).toBe(1)
    expect(poses.every((pose) => pose.level === 0 && pose.echo.every((value) => value === 0))).toBe(true)
    const after = live(0.5, { mood: 'asleep', still: true }, life).poses
    expect(after.at(-1)?.weights.asleep).toBeGreaterThan(0.9)
  })
})
