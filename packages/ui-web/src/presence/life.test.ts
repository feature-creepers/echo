import type { Look } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import {
  BANDS,
  BREATH_PERIOD,
  createLife,
  ECHO_STEP,
  FOCUS_PERIOD,
  flicker,
  GLINT_PERIOD,
  HUD_MOTES,
  HUD_RINGS,
  type Input,
  LOOK_FADE,
  type Mood,
  type Pose,
  RESTING_LOAD,
  SWELL_PERIOD,
  spectrumOf,
  WORK_PERIOD,
  wander
} from './life.ts'

const FRAME = 1 / 60

/** A copy of a pose that later frames cannot change. */
const keep = (pose: Pose): Pose => ({
  ...pose,
  weights: { ...pose.weights },
  looks: { ...pose.looks },
  gaze: [pose.gaze[0], pose.gaze[1]],
  lens: { ...pose.lens, depth: [pose.lens.depth[0], pose.lens.depth[1]], voice: [...pose.lens.voice] },
  hud: { ...pose.hud, turns: pose.hud.turns.slice(), motes: pose.hud.motes.slice() },
  echo: pose.echo.slice(),
  spectrum: pose.spectrum.slice()
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
  it('swells slowly at rest, by a little, about once in its period: steady, never a warning light', () => {
    const lamp = live(SWELL_PERIOD * 3, { mood: 'idle', look: 'lens' }).poses.map((pose) => pose.lens.lamp)
    const steady = lamp.filter((_, index) => flicker(index * FRAME) === 0)
    expect(Math.max(...steady) / Math.min(...steady)).toBeGreaterThan(1.04)
    expect(Math.max(...steady) / Math.min(...steady)).toBeLessThan(1.12)
    // Count the swells: a peak is higher than everything a second either side of it.
    const peaks = steady.filter(
      (value, index) => index > 60 && index < steady.length - 60 && steady.slice(index - 60, index + 61).every((other) => other <= value)
    )
    expect(peaks.length).toBeGreaterThanOrEqual(2)
    expect(peaks.length).toBeLessThanOrEqual(3)
  })

  it('flickers now and then, briefly and faintly, as a filament does, and the same way every time', () => {
    const samples = Array.from({ length: 120_000 }, (_, index) => flicker(index / 1000))
    const dipping = samples.map((value) => value > 0.01)
    expect(dipping.filter(Boolean).length / samples.length).toBeLessThan(0.02)
    expect(samples.reduce((highest, value) => Math.max(highest, value), 0)).toBeLessThan(0.25)
    // Each dip starts and ends within a third of a second, and there are a good few of them in two minutes.
    const starts = dipping.flatMap((on, index) => (on && !dipping[index - 1] ? [index] : []))
    expect(starts.length).toBeGreaterThan(8)
    expect(starts.length).toBeLessThan(40)
    for (const start of starts) expect(dipping.slice(start, start + 300).includes(false)).toBe(true)
    expect(flicker(37.4)).toBe(flicker(37.4))
  })

  it('draws its disc and its red in to listen, brightens, and its glass catches more of the room', () => {
    const idle = last(live(2, { mood: 'idle', look: 'lens' }).poses).lens
    const listening = last(live(2, { mood: 'listening', look: 'lens', level: 0.5 }).poses).lens
    expect(listening.heart).toBeLessThan(idle.heart * 0.95)
    expect(listening.iris).toBeLessThan(idle.iris * 0.95)
    expect(listening.lamp).toBeGreaterThan(idle.lamp * 1.08)
    expect(listening.catch).toBeGreaterThan(idle.catch * 1.6)
  })

  it('hunts for focus while thinking, a shimmer running through its elements from the outside in', () => {
    const { poses } = live(FOCUS_PERIOD * 2 + 1, { mood: 'thinking', look: 'lens' })
    const period = poses.slice(-Math.round(FOCUS_PERIOD * 60))
    expect(range(period.map((pose) => pose.lens.heart)) / (period[0]?.lens.heart ?? 1)).toBeGreaterThan(0.08)
    expect(range(period.map((pose) => pose.lens.focus))).toBeGreaterThan(0.04)
    const where = period.map((pose) => pose.lens.shimmerAt)
    expect(Math.min(...where)).toBeLessThan(0)
    expect(Math.max(...where)).toBeGreaterThan(1)
    // Inwards, except where it starts again from the outside.
    const steps = where.slice(1).map((value, index) => value - (where[index] ?? 0))
    expect(steps.filter((step) => step < 0).length).toBeLessThanOrEqual(1)
  })

  it('sends a beat out through its light while it works, once a period', () => {
    const { poses } = live(WORK_PERIOD * 3, { mood: 'working', look: 'lens' })
    const period = poses.slice(-Math.round(WORK_PERIOD * 60))
    expect(last(period).lens.beat).toBeGreaterThan(0.99)
    const where = period.map((pose) => pose.lens.beatAt)
    expect(Math.min(...where)).toBeLessThan(0)
    expect(Math.max(...where)).toBeGreaterThan(1)
    expect(last(live(2, { mood: 'idle', look: 'lens' }).poses).lens.beat).toBeLessThan(0.01)
  })

  it('swells with its own voice, but only a little: its red never spreads like a lamp', () => {
    const quiet = last(live(1, { mood: 'speaking', look: 'lens', level: 0 }).poses).lens
    const loud = last(live(1, { mood: 'speaking', look: 'lens', level: 1 }).poses).lens
    expect(loud.lamp).toBeGreaterThan(quiet.lamp * 1.3)
    expect(loud.iris).toBeGreaterThan(quiet.iris * 1.04)
    expect(loud.iris).toBeLessThan(quiet.iris * 1.15)
    expect(loud.heart).toBeGreaterThan(quiet.heart)
  })

  it('lets each element catch its own notes of the voice, the low ones outermost', () => {
    const low = Array.from({ length: BANDS }, (_, band) => (band < BANDS / 4 ? 1 : 0))
    const { voice } = last(live(1, { mood: 'speaking', look: 'lens', level: 0.8, bands: low }).poses).lens
    expect(voice[0]).toBeGreaterThan(0.9)
    expect(voice[3]).toBeLessThan(0.01)
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

describe('the instrument at work', () => {
  it('runs a chase round its data ring and steps its markers round, a quick move each beat', () => {
    const { life } = live(1, { mood: 'working' })
    const { poses } = live(WORK_PERIOD, { mood: 'working' }, life)
    expect(last(poses).hud.chase).toBeGreaterThan(0.99)
    const markers = poses.map((pose) => pose.hud.turns[2] ?? 0)
    const moves = markers.slice(1).map((value, index) => Math.abs(value - (markers[index] ?? 0)))
    // Most of the step is taken in a third of the beat, then the markers rest.
    const moving = moves.filter((move) => move > 1e-4).length
    expect(moving).toBeLessThan(poses.length * 0.45)
    expect(moves.reduce((sum, move) => sum + move, 0)).toBeGreaterThan(Math.PI / 10)
  })

  it('sends its motes round their rings, faster while thinking, and a glint along its arcs once a period', () => {
    const idle = live(2, { mood: 'idle' }).poses
    const thinking = live(2, { mood: 'thinking' }, live(1, { mood: 'thinking' }).life).poses
    const travelled = (poses: Pose[]) => {
      let sum = 0
      for (let index = 1; index < poses.length; index++) {
        const step = (poses[index]?.hud.motes[0] ?? 0) - (poses[index - 1]?.hud.motes[0] ?? 0)
        sum += Math.abs(step) > 0.5 ? Math.abs(step) - 1 : Math.abs(step)
      }
      return Math.abs(sum)
    }
    expect(travelled(idle)).toBeCloseTo(Math.abs(HUD_MOTES[0].pace) * 2, 1)
    expect(travelled(thinking)).toBeGreaterThan(travelled(idle) * 2.5)
    const glint = live(GLINT_PERIOD, { mood: 'idle' }).poses.map((pose) => pose.hud.glintAt)
    expect(Math.min(...glint)).toBeLessThan(0)
    expect(Math.max(...glint)).toBeGreaterThan(1)
  })
})

describe('where the core looks', () => {
  it('turns towards what it is given on a spring, settling without a jump or much overshoot', () => {
    const { poses } = live(1.2, { mood: 'idle', gaze: [0.6, -0.4] })
    for (let index = 1; index < poses.length; index++) {
      const step = Math.hypot((poses[index]?.gaze[0] ?? 0) - (poses[index - 1]?.gaze[0] ?? 0), (poses[index]?.gaze[1] ?? 0) - (poses[index - 1]?.gaze[1] ?? 0))
      // A glance is quick, a tenth of its way in a frame at most, but it never jumps there.
      expect(step).toBeLessThan(0.1)
    }
    expect(Math.max(...poses.map((pose) => pose.gaze[0]))).toBeLessThan(0.6 * 1.15)
    expect(last(poses).gaze[0]).toBeCloseTo(0.6, 1)
    expect(last(poses).gaze[1]).toBeCloseTo(-0.4, 1)
    expect(last(poses).attention).toBeGreaterThan(0.95)
    // The lens's deep light follows the gaze; the instrument's turn comes from the same gaze.
    expect(last(live(1.2, { mood: 'idle', look: 'lens', gaze: [0.6, -0.4] }).poses).lens.depth[0]).toBeGreaterThan(0.05)
  })

  it('with nothing to look at, rests its gaze here and there by itself, near the middle, the same way every time', () => {
    const resting = live(12, { mood: 'idle' }).poses
    expect(last(resting).attention).toBeLessThan(0.01)
    expect(Math.max(...resting.map((pose) => Math.hypot(pose.gaze[0], pose.gaze[1])))).toBeLessThan(0.35)
    const places = new Set(Array.from({ length: 60 }, (_, second) => wander(second).join()))
    expect(places.size).toBeGreaterThan(5)
    expect(wander(12.3)).toEqual(wander(12.3))
  })

  it('looks to the middle asleep', () => {
    const asleep = last(live(3, { mood: 'asleep', gaze: [0.8, 0.5] }).poses)
    expect(Math.hypot(asleep.gaze[0], asleep.gaze[1])).toBeLessThan(0.05)
  })
})

describe('the computer at work', () => {
  it('brightens the core as the computer works harder, and dims it as it rests', () => {
    for (const look of ['lens', 'hud'] satisfies Look[]) {
      const busy = last(live(8, { mood: 'idle', look, load: 1 }).poses)
      const resting = last(live(8, { mood: 'idle', look, load: 0.02 }).poses)
      const light = (pose: Pose) => (look === 'lens' ? pose.lens.lamp : pose.hud.core)
      expect(light(busy) / light(resting)).toBeGreaterThan(1.3)
      expect(busy.power).toBeGreaterThan(0.95)
      expect(resting.power).toBeLessThan(0.05)
    }
  })

  it('follows a burst of work quickly and a pause slowly, and looks as it always has when the load is not known', () => {
    const { life } = live(6, { mood: 'idle', load: 0 })
    const rising = last(live(1.5, { mood: 'idle', load: 1 }, life).poses).power
    const { life: busy } = live(6, { mood: 'idle', load: 1 })
    const falling = 1 - last(live(1.5, { mood: 'idle', load: 0 }, busy).poses).power
    expect(rising).toBeGreaterThan(falling)
    expect(last(live(2, { mood: 'idle' }).poses).power).toBeCloseTo(RESTING_LOAD, 6)
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

describe("the voice's spectrum", () => {
  it('follows the notes of the voice it speaks and the one it hears, each in its own place', () => {
    const notes = Array.from({ length: BANDS }, (_, band) => (band === 3 ? 1 : 0))
    const speaking = last(live(1, { mood: 'speaking', level: 0.8, bands: notes }).poses).spectrum
    expect(speaking[3 * 2]).toBeGreaterThan(0.9)
    expect(speaking[3 * 2 + 1]).toBe(0)
    expect(speaking[8 * 2]).toBeLessThan(0.01)
    const listening = last(live(1, { mood: 'listening', level: 0.8, bands: notes }).poses).spectrum
    expect(listening[3 * 2 + 1]).toBeGreaterThan(0.9)
  })

  it('makes one from the level when there is none to read, silent when the voice is', () => {
    const made = spectrumOf(0.7, 3.1, new Float32Array(BANDS))
    expect(made.reduce((sum, band) => sum + band, 0)).toBeGreaterThan(1)
    expect(Math.max(...made)).toBeLessThanOrEqual(1)
    expect(spectrumOf(0, 3.1, new Float32Array(BANDS)).every((band) => band === 0)).toBe(true)
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
    expect(poses.every((pose) => pose.gaze[0] === 0 && pose.gaze[1] === 0 && pose.hud.motes.every((mote) => mote === 0))).toBe(true)
    const after = live(0.5, { mood: 'asleep', look: 'hud', still: true }, life).poses
    expect(last(after).weights.asleep).toBeGreaterThan(0.9)
    expect(last(after).looks.hud).toBe(1)
  })
})
