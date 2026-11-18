import { describe, expect, it } from 'vitest'
import { FIELD_GAP, FIELD_SPEED, type Field, fieldOf, restingField } from './field.ts'
import { createLife, type Input, type Mood, type Pose, WAKE } from './life.ts'

const FRAME = 1 / 60

/** Lives through some seconds at sixty frames a second, and gives the field of every frame on the way. */
function fields(seconds: number, input: Partial<Input> & { mood: Mood }, life = createLife(input.mood, input.look ?? 'hud')) {
  const each: Field[] = []
  let pose: Pose | undefined
  for (let frame = 0; frame < Math.round(seconds * 60); frame++) {
    pose = life.step({ look: 'hud', level: 0, delta: FRAME, still: false, ...input })
    each.push(fieldOf(pose))
  }
  return { life, each, pose: pose as Pose }
}

const last = (each: Field[]) => each.at(-1) as Field

describe('the field round the core', () => {
  it('rests with nothing showing', () => {
    const resting = restingField()
    expect([resting.speaking, resting.listening]).toEqual([0, 0])
  })

  it.each([
    { mood: 'speaking', speaking: 1, listening: 0 },
    { mood: 'listening', speaking: 0, listening: 1 }
  ] satisfies { mood: Mood; speaking: number; listening: number }[])('carries only the voice of the core while $mood', ({ mood, speaking, listening }) => {
    const field = last(fields(3, { mood }).each)
    expect(field.speaking).toBeCloseTo(speaking, 2)
    expect(field.listening).toBeCloseTo(listening, 2)
  })

  // What the core does without a voice stays inside it, so the ground stays calm under it.
  it.each([{ mood: 'idle' }, { mood: 'thinking' }, { mood: 'working' }, { mood: 'asleep' }] satisfies { mood: Mood }[])(
    'shows nothing while $mood, waking included',
    ({ mood }) => {
      for (const field of fields(WAKE.lens + 1, { mood }).each) expect(field.speaking + field.listening).toBeLessThan(0.01)
    }
  )

  it.each([
    { look: 'hud', fine: 1 },
    { look: 'lens', fine: 0 }
  ] as const)('is drawn in fine lines for the instrument and in soft light for the lens: $look', ({ look, fine }) => {
    expect(last(fields(1, { mood: 'idle', look }).each).fine).toBe(fine)
  })

  it('carries the voice on rings that leave one after the other, at the pace the voice travels', () => {
    const { each } = fields(1, { mood: 'speaking', level: 0.6 })
    const travel = each.map((field) => field.travel)
    for (const share of travel) {
      expect(share).toBeGreaterThanOrEqual(0)
      expect(share).toBeLessThan(1)
    }
    // From one frame to the next a ring goes as far as the voice does, or the next one has just left.
    const stride = (FRAME * FIELD_SPEED) / FIELD_GAP
    for (let index = 1; index < travel.length; index++) {
      const step = (travel[index] ?? 0) - (travel[index - 1] ?? 0)
      expect(Math.min(Math.abs(step - stride), Math.abs(step - stride + 1))).toBeLessThan(1e-6)
    }
  })

  it('writes into the field it is given, so a frame makes nothing new', () => {
    const into = restingField()
    const { pose } = fields(0.5, { mood: 'speaking' })
    expect(fieldOf(pose, into)).toBe(into)
    expect(into.speaking).toBeGreaterThan(0.5)
  })
})
