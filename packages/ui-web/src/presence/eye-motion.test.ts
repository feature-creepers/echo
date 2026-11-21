import { describe, expect, it } from 'vitest'
import { advanceEye, type Composition, type EyeMotion, type Mood, restingEye } from './eye-motion.ts'

/** The eye after living `seconds` in a mood, a sixtieth of a second at a time. */
function live(eye: EyeMotion, mood: Mood, seconds: number, composition: Composition = 'sight', level = 0): EyeMotion {
  let now = eye
  for (let frame = 0; frame < Math.round(seconds * 60); frame++) now = advanceEye(now, mood, level, 1 / 60, composition)
  return now
}

describe('the sight', () => {
  it.each([
    { mood: 'idle', turns: true, steps: false, rides: true },
    { mood: 'listening', turns: true, steps: false, rides: false },
    { mood: 'thinking', turns: true, steps: true, rides: true },
    { mood: 'working', turns: true, steps: true, rides: true },
    { mood: 'speaking', turns: true, steps: false, rides: true },
    { mood: 'asleep', turns: false, steps: false, rides: false }
  ] as const)('$mood: the half turns $turns, the triangle steps $steps, the square rides $rides', ({ mood, turns, steps, rides }) => {
    const eye = live(restingEye(mood), mood, 2.5)
    expect(eye.turn !== 0).toBe(turns)
    expect(eye.wedge > 1).toBe(steps)
    expect(eye.ride > 0.01).toBe(rides)
  })

  it('turns faster to think than at rest, and eases into it', () => {
    const resting = live(restingEye('idle'), 'idle', 1)
    expect(advanceEye(resting, 'thinking', 0, 1 / 60).speed).toBeLessThan(40)
    expect(live(resting, 'thinking', 3).speed).toBeGreaterThan(110)
  })

  it('brings the triangle back to the top right and the square home when the work is done', () => {
    const done = live(live(restingEye('idle'), 'thinking', 1.3), 'listening', 3)
    expect(Math.cos((done.wedge * Math.PI) / 180)).toBeCloseTo(1, 4)
    expect(done.ride).toBeCloseTo(0, 2)
  })
})

describe('the orbit', () => {
  it.each(['idle', 'listening', 'thinking', 'working', 'speaking'] as const)('circles without a stop while %s, with nothing that steps or rides', (mood) => {
    const eye = live(restingEye(mood, 'orbit'), mood, 2.5, 'orbit')
    expect(eye.turn).toBeGreaterThan(0)
    expect(eye.wedge).toBe(0)
    expect(eye.ride).toBe(0)
  })

  it.each(['idle', 'thinking', 'working', 'speaking'] as const)('turns faster than the sight while %s', (mood) => {
    expect(live(restingEye(mood, 'orbit'), mood, 2, 'orbit').turn).toBeGreaterThan(live(restingEye(mood), mood, 2).turn)
  })

  it('takes a change of mood sooner than the sight', () => {
    const asked = (composition: Composition) => {
      const resting = live(restingEye('idle', composition), 'idle', 1, composition)
      const thinking = live(resting, 'thinking', 0.3, composition)
      return (thinking.speed - resting.speed) / (restingEye('thinking', composition).speed - resting.speed)
    }
    expect(asked('orbit')).toBeGreaterThan(asked('sight'))
  })
})

describe('either eye', () => {
  const compositions = ['sight', 'orbit'] as const

  it.each(compositions.flatMap((composition) => (['listening', 'speaking'] as const).map((mood) => ({ composition, mood }))))(
    'the $composition opens its pupil with the voice while $mood',
    ({ composition, mood }) => {
      const loud = live(restingEye(mood, composition), mood, 1, composition, 1)
      const silent = live(restingEye(mood, composition), mood, 1, composition, 0)
      expect(loud.pupil).toBeGreaterThan(silent.pupil + 1)
    }
  )

  it.each(compositions)('the %s closes and dims to sleep, and opens again', (composition) => {
    const asleep = live(restingEye('idle', composition), 'asleep', 3, composition)
    expect(asleep.lid).toBeLessThan(0.2)
    expect(asleep.strength).toBeLessThan(0.5)
    expect(live(asleep, 'idle', 3, composition).lid).toBeGreaterThan(0.95)
  })
})
