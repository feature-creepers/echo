import { describe, expect, it } from 'vitest'
import { gazeAt, middleOf } from './gaze.ts'

const CORE = { x: 500, y: 100 }

describe('where the core looks', () => {
  it.each([
    { case: 'straight below, near', point: { x: 500, y: 200 }, gaze: [0, -0.2124] },
    { case: 'straight below, at its reach', point: { x: 500, y: 560 }, gaze: [0, -Math.SQRT1_2] },
    { case: 'far to the right', point: { x: 5000, y: 100 }, gaze: [0.995, 0] },
    { case: 'up and to the left', point: { x: 175, y: -225 }, gaze: [-0.5, 0.5] },
    { case: 'right on it', point: { x: 500, y: 100 }, gaze: [0, 0] }
  ])('$case', ({ point, gaze }) => {
    const [x, y] = gazeAt(CORE, point, 460)
    expect(x).toBeCloseTo(gaze[0] ?? 0, 3)
    expect(y).toBeCloseTo(gaze[1] ?? 0, 3)
  })

  it('never turns all the way, however far the point', () => {
    const [x, y] = gazeAt(CORE, { x: 1e9, y: -1e9 }, 460)
    expect(Math.hypot(x, y)).toBeLessThan(1)
  })

  it('finds the middle of a box', () => {
    expect(middleOf({ left: 10, top: 20, width: 100, height: 40 })).toEqual({ x: 60, y: 40 })
  })
})
