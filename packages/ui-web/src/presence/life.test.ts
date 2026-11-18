import type { Look } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { BREATH_PERIOD, createLife, ECHO_STEP, FOCUS_PERIOD, flicker, HUD_RINGS, type Input, LOOK_FADE, type Mood, type Pose, SWELL_PERIOD } from './life.ts'

const FRAME = 1 / 60

/** A copy of a pose that later frames cannot change. */
const keep = (pose: Pose): Pose => ({
  ...pose,
  weights: { ...pose.weights },
  looks: { ...pose.looks },
  lens: { ...pose.lens },
  hud: { ...pose.hud, turns: pose.hud.turns.slice() },
  echo: pose.echo.slice()
})

/** Lives through some seconds at sixty frames a second, and gives every pose on the way. */
function live(seconds: number, input: Partial<Input> & { mood: Mood }, life = createLife(input.mood, input.look ?? 'hud')) {
  const poses: Pose[] = []
  for (let frame = 0; frame < Math.round(seconds * 60); frame++) poses.push(keep(life.step({ look: 'hud', level: 0, delta: FRAME, still: false, ...input })))
  return { life, poses }
}

const last = (poses: Pose[]) => poses.at(-1) as Pose
const range = (values: number[]) => Math.max(...values) - Math.min(...values)

describe('the life behind the core', () => {
  it('fades from one mood to the next without a jump, the moods always adding up to one', () => {
    const { life } = live(2, { mood: 'idle' })
    const { poses } = live(1.5, { mood: 'thinking' }, life)
    let previous = 0
    for (const pose of poses) {
      expect(Object.values(pose.weights).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 6)
      expect(pose.weights.thinking - previous).toBeLessThan(0.1)
      previous = pose.weights.thinking
    }
    // About a third of a second in, most of the way there.
    expect(poses[20]?.weights.thinking).toBeGreaterThan(0.75)
    expect(last(poses).lens.shimmer).toBeGreaterThan(0.99)
    expect(last(poses).hud.scan).toBeGreaterThan(0.99)
  })

  it('morphs from one look to the other in about 400 ms, never cutting, and turns back from halfway', () => {
    const { life } = live(1, { mood: 'idle', look: 'hud' })
    const { poses } = live(LOOK_FADE + 0.1, { mood: 'idle', look: 'lens' }, life)
    let previous = 0
    for (const pose of poses) {
      expect(pose.looks.lens + pose.looks.hud).toBeCloseTo(1, 6)
      expect(pose.looks.lens - previous).toBeLessThan(0.08)
      previous = pose.looks.lens
    }
    expect(poses[Math.round((LOOK_FADE / 2) * 60) - 1]?.looks.lens).toBeCloseTo(0.5, 1)
    expect(poses[Math.round(LOOK_FADE * 60) - 1]?.looks.lens).toBe(1)

    const halfway = live(LOOK_FADE / 2, { mood: 'idle', look: 'hud' }, live(1, { mood: 'idle', look: 'lens' }).life).poses
    const back = live(LOOK_FADE, { mood: 'idle', look: 'lens' }, createLife('idle', 'lens'))
    expect(last(halfway).looks.hud).toBeCloseTo(0.5, 1)
    expect(last(back.poses).looks.lens).toBe(1)
  })

  it('knows each look from the start, without fading it in', () => {
    for (const look of ['lens', 'hud'] satisfies Look[])
      expect(createLife('idle', look).step({ mood: 'idle', look, level: 0, delta: FRAME, still: false }).looks[look]).toBe(1)
  })
})

describe('the lens', () => {
  it('pulses slowly at rest, by a little, about once in its period', () => {
    const lamp = live(SWELL_PERIOD * 3, { mood: 'idle', look: 'lens' }).poses.map((pose) => pose.lens.lamp)
    const steady = lamp.filter((_, index) => flicker(index * FRAME) === 0)
    expect(Math.max(...steady) / Math.min(...steady)).toBeGreaterThan(1.12)
    expect(Math.max(...steady) / Math.min(...steady)).toBeLessThan(1.3)
    // Count the swells: a peak is higher than everything a second either side of it.
    const peaks = steady.filter(
      (value, index) => index > 60 && index < steady.length - 60 && steady.slice(index - 60, index + 61).every((other) => other <= value)
    )
    expect(peaks.length).toBeGreaterThanOrEqual(2)
    expect(peaks.length).toBeLessThanOrEqual(3)
  })

  it('flickers now and then, briefly, as a lamp does, and the same way every time', () => {
    const samples = Array.from({ length: 120_000 }, (_, index) => flicker(index / 1000))
    const dipping = samples.map((value) => value > 0.01)
    expect(dipping.filter(Boolean).length / samples.length).toBeLessThan(0.02)
    expect(Math.max(...samples)).toBeLessThan(0.4)
    // Each dip starts and ends within a third of a second, and there are a good few of them in two minutes.
    const starts = dipping.flatMap((on, index) => (on && !dipping[index - 1] ? [index] : []))
    expect(starts.length).toBeGreaterThan(8)
    expect(starts.length).toBeLessThan(40)
    for (const start of starts) expect(dipping.slice(start, start + 300).includes(false)).toBe(true)
    expect(flicker(37.4)).toBe(flicker(37.4))
  })

  it('tightens and brightens its light to listen, and its elements catch more of it', () => {
    const idle = last(live(2, { mood: 'idle', look: 'lens' }).poses).lens
    const listening = last(live(2, { mood: 'listening', look: 'lens', level: 0.5 }).poses).lens
    expect(listening.focus).toBeLessThan(idle.focus * 0.85)
    expect(listening.lamp).toBeGreaterThan(idle.lamp * 1.15)
    expect(listening.catch).toBeGreaterThan(idle.catch * 1.8)
    expect(listening.spread).toBeLessThan(idle.spread)
  })

  it('hunts for focus while thinking, a shimmer running through its elements from the outside in', () => {
    const { poses } = live(FOCUS_PERIOD * 2 + 1, { mood: 'thinking', look: 'lens' })
    const period = poses.slice(-Math.round(FOCUS_PERIOD * 60))
    expect(range(period.map((pose) => pose.lens.focus)) / (period[0]?.lens.focus ?? 1)).toBeGreaterThan(0.2)
    const where = period.map((pose) => pose.lens.shimmerAt)
    expect(Math.min(...where)).toBeLessThan(0)
    expect(Math.max(...where)).toBeGreaterThan(1)
    // Inwards, except where it starts again from the outside.
    const steps = where.slice(1).map((value, index) => value - (where[index] ?? 0))
    expect(steps.filter((step) => step < 0).length).toBeLessThanOrEqual(1)
  })

  it('swells with its own voice', () => {
    const quiet = last(live(1, { mood: 'speaking', look: 'lens', level: 0 }).poses).lens
    const loud = last(live(1, { mood: 'speaking', look: 'lens', level: 1 }).poses).lens
    expect(loud.lamp).toBeGreaterThan(quiet.lamp * 1.4)
    expect(loud.spread).toBeGreaterThan(quiet.spread * 1.2)
    expect(loud.focus).toBeGreaterThan(quiet.focus)
  })

  it('sinks to an ember asleep, still breathing', () => {
    const idle = last(live(2, { mood: 'idle', look: 'lens' }).poses).lens
    const asleep = live(BREATH_PERIOD + 3, { mood: 'asleep', look: 'lens' }).poses.slice(-Math.round(BREATH_PERIOD * 60))
    const lamp = asleep.map((pose) => pose.lens.lamp)
    expect(Math.max(...lamp)).toBeLessThan(idle.lamp * 0.2)
    expect(Math.max(...lamp) / Math.min(...lamp)).toBeGreaterThan(1.4)
    expect(last(asleep).lens.room).toBeLessThan(idle.room)
  })
})

describe('the instrument', () => {
  it('turns its rings slowly at rest, neighbours opposite ways', () => {
    const { poses } = live(10, { mood: 'idle' })
    const turned = last(poses).hud.turns
    HUD_RINGS.forEach((ring, index) => {
      expect(Math.sign(turned[index] ?? 0)).toBe(Math.sign(ring.pace))
      // Slow: less than a fifth of a turn in ten seconds.
      expect(Math.abs(turned[index] ?? 0)).toBeLessThan((Math.PI * 2) / 5)
    })
    for (let index = 1; index < HUD_RINGS.length; index++) expect(Math.sign(HUD_RINGS[index]?.pace ?? 0)).not.toBe(Math.sign(HUD_RINGS[index - 1]?.pace ?? 0))
  })

  it('draws its rings in to listen, and lights its meter with the voice it hears', () => {
    const idle = last(live(2, { mood: 'idle' }).poses).hud
    const quiet = last(live(2, { mood: 'listening', level: 0 }).poses).hud
    const loud = last(live(2, { mood: 'listening', level: 0.8 }).poses).hud
    expect(quiet.reach).toBeLessThan(idle.reach)
    expect(loud.reach).toBeLessThan(quiet.reach)
    expect(quiet.gauge).toBeLessThan(0.01)
    expect(loud.gauge).toBeGreaterThan(0.75)
  })

  it('speeds its segments up while thinking, and sweeps a scan round clockwise', () => {
    const idle = live(2, { mood: 'idle' }).poses
    const thinking = live(3, { mood: 'thinking' }).poses.slice(-120)
    const pace = (poses: Pose[], ring: number) => ((last(poses).hud.turns[ring] ?? 0) - (poses[0]?.hud.turns[ring] ?? 0)) / ((poses.length - 1) * FRAME)
    // The band of segments, the fastest while thinking, turns several times faster than at rest.
    expect(Math.abs(pace(thinking, 1))).toBeGreaterThan(Math.abs(pace(idle.slice(-120), 1)) * 5)
    expect(Math.sign(pace(thinking, 1))).not.toBe(Math.sign(pace(thinking, 0)))
    expect(last(thinking).hud.scanAngle).toBeLessThan(thinking[0]?.hud.scanAngle ?? 0)
  })

  it('follows its own voice in the bars round the core', () => {
    const speaking = last(live(1, { mood: 'speaking', level: 0.8 }).poses)
    expect(speaking.hud.wave).toBeGreaterThan(0.99)
    expect(speaking.hud.core).toBeGreaterThan(last(live(1, { mood: 'speaking', level: 0 }).poses).hud.core)
  })

  it('lets every ring fade asleep but one, which breathes', () => {
    const asleep = live(BREATH_PERIOD + 3, { mood: 'asleep' }).poses.slice(-Math.round(BREATH_PERIOD * 60))
    expect(last(asleep).hud.rings).toBeLessThan(0.01)
    const dormant = asleep.map((pose) => pose.hud.dormant)
    expect(Math.min(...dormant)).toBeGreaterThan(0.2)
    expect(Math.max(...dormant)).toBeGreaterThan(0.9)
  })
})

describe('the voice', () => {
  it('sends its own voice and the voice it hears into the past at a steady pace, whatever the frame rate', () => {
    const speaking = last(live(1, { mood: 'speaking', level: 0.8 }).poses)
    expect(speaking.echo[0]).toBeGreaterThan(0.5)
    expect(speaking.echo[1]).toBe(0)
    expect(last(live(1, { mood: 'listening', level: 0.8 }).poses).echo[1]).toBeGreaterThan(0.5)

    // Thirty frames a second keep the same history as sixty.
    const slow = createLife('speaking')
    let pose: Pose | undefined
    for (let frame = 0; frame < 30; frame++) pose = slow.step({ mood: 'speaking', look: 'hud', level: frame < 15 ? 1 : 0, delta: 1 / 30, still: false })
    expect(pose?.echo[(Math.round(0.5 / ECHO_STEP) + 2) * 2]).toBeGreaterThan(0.5)
  })
})

describe('with less motion asked for', () => {
  it('holds everything still, and still fades between moods and looks', () => {
    const { life, poses } = live(1, { mood: 'thinking', look: 'lens', level: 1, still: true })
    for (const read of [(pose: Pose) => pose.lens.turn, (pose: Pose) => pose.lens.sheen, (pose: Pose) => pose.lens.lamp, (pose: Pose) => pose.hud.scanAngle]) {
      expect(new Set(poses.slice(30).map(read)).size).toBe(1)
    }
    expect(poses.every((pose) => pose.hud.turns.every((turn) => turn === 0))).toBe(true)
    expect(poses.every((pose) => pose.level === 0 && pose.echo.every((value) => value === 0))).toBe(true)
    const after = live(0.5, { mood: 'asleep', look: 'hud', still: true }, life).poses
    expect(last(after).weights.asleep).toBeGreaterThan(0.9)
    expect(last(after).looks.hud).toBe(1)
  })
})
