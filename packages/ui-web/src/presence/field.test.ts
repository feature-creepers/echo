import { describe, expect, it } from 'vitest'
import { FIELD_GAP, FIELD_SPEED, type Field, fieldOf, restingField } from './field.ts'
import { createLife, type Input, type Mood, type Pose, WAKE, WORK_PERIOD } from './life.ts'

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
  it('rests with nothing showing and its wave spent', () => {
    const resting = restingField()
    expect([resting.speaking, resting.listening, resting.sweep, resting.beat]).toEqual([0, 0, 0, 0])
    expect(resting.wave).toBe(1)
  })

  const phases: { mood: Mood; shows: keyof Field }[] = [
    { mood: 'speaking', shows: 'speaking' },
    { mood: 'listening', shows: 'listening' },
    { mood: 'thinking', shows: 'sweep' },
    { mood: 'working', shows: 'beat' }
  ]
  it.each(phases)('shows only what the core does while $mood', ({ mood, shows }) => {
    const field = last(fields(2, { mood }).each)
    for (const phase of phases) {
      if (phase.shows === shows) expect(field[phase.shows]).toBeGreaterThan(0.99)
      else expect(field[phase.shows]).toBeLessThan(0.01)
    }
  })

  it.each([{ mood: 'idle' }, { mood: 'asleep' }] satisfies { mood: Mood }[])('shows none of them while $mood', ({ mood }) => {
    const field = last(fields(WAKE.lens + 1, { mood }).each)
    expect(field.speaking + field.listening + field.sweep + field.beat).toBeLessThan(0.01)
    expect(field.wave).toBe(1)
  })

  it.each([
    { look: 'hud', fine: 1 },
    { look: 'lens', fine: 0 }
  ] as const)('is drawn in fine lines for the instrument and in soft light for the lens: $look', ({ look, fine }) => {
    expect(last(fields(1, { mood: 'idle', look }).each).fine).toBe(fine)
  })

  it.each(['hud', 'lens'] as const)('throws one wave as the %s wakes, once its light has ignited, and never again', (look) => {
    const { each } = fields(WAKE[look] + 0.5, { mood: 'idle', look })
    const wave = each.map((field) => field.wave)
    expect(wave[0]).toBe(0)
    // It only ever goes out.
    for (let index = 1; index < wave.length; index++) expect(wave[index] ?? 0).toBeGreaterThanOrEqual(wave[index - 1] ?? 0)
    expect(wave[Math.round(WAKE[look] * 30)]).toBeGreaterThan(0.2)
    expect(wave[Math.round(WAKE[look] * 30)]).toBeLessThan(0.8)
    expect(last(each).wave).toBe(1)
  })

  it('sends a ring out with each beat of its work, from the core to where it is gone', () => {
    const { each } = fields(WORK_PERIOD * 3, { mood: 'working', look: 'lens' })
    const period = each.slice(-Math.round(WORK_PERIOD * 60)).map((field) => field.beatAt)
    expect(Math.min(...period)).toBeLessThan(0.05)
    expect(Math.max(...period)).toBeGreaterThan(0.95)
    for (const at of period) {
      expect(at).toBeGreaterThanOrEqual(0)
      expect(at).toBeLessThanOrEqual(1)
    }
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
    const { pose } = fields(0.5, { mood: 'thinking' })
    expect(fieldOf(pose, into)).toBe(into)
    expect(into.sweep).toBeGreaterThan(0.5)
  })
})
