import { describe, expect, it } from 'vitest'
import { createPush } from './push.ts'

/** One turn of the wheel: how far towards the edge, when, and whether the edge is reached and the wheel is free. */
type Turn = readonly [travel: number, at: number, free: boolean]

const FAR = 90
const WITHIN = 450

/** Which turns of a run were the firm push, by their place in the run. */
function firmAt(turns: readonly Turn[]): number[] {
  const push = createPush(FAR, WITHIN)
  return turns.flatMap(([travel, at, free], index) => (push.wheel(travel, at, free) ? [index] : []))
}

describe('a firm push of the wheel against an edge', () => {
  it.each<{ name: string; turns: Turn[]; firm: number[] }>([
    {
      name: 'is firm once the wheel has gone far enough at the edge',
      turns: [
        [40, 0, true],
        [40, 100, true],
        [40, 200, true]
      ],
      firm: [2]
    },
    {
      name: 'is firm at once with one long turn',
      turns: [[120, 0, true]],
      firm: [0]
    },
    {
      name: 'starts again after a pause',
      turns: [
        [60, 0, true],
        [60, 600, true],
        [60, 700, true]
      ],
      firm: [2]
    },
    {
      name: 'starts again when the wheel turns the other way',
      turns: [
        [60, 0, true],
        [-10, 100, true],
        [60, 200, true],
        [60, 300, true]
      ],
      firm: [3]
    },
    {
      name: 'is no push while something else takes the wheel',
      turns: [
        [200, 0, false],
        [200, 100, false]
      ],
      firm: []
    },
    {
      name: 'is no push when a quick scroll reaches the edge and runs on, however far',
      turns: [
        [200, 0, false],
        [200, 50, true],
        [200, 100, true],
        [200, 150, true],
        [200, 500, true]
      ],
      firm: []
    },
    {
      name: 'is a push again once that scroll has paused',
      turns: [
        [200, 0, false],
        [200, 50, true],
        [100, 600, true]
      ],
      firm: [2]
    },
    {
      name: 'counts each push once, and the next one from nothing',
      turns: [
        [100, 0, true],
        [50, 100, true],
        [50, 200, true]
      ],
      firm: [0, 2]
    }
  ])('$name', ({ turns, firm }) => {
    expect(firmAt(turns)).toEqual(firm)
  })
})
