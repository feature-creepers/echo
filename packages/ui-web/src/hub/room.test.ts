import { describe, expect, it } from 'vitest'
import { hubMakesRoom } from './room.ts'

describe('the hub making room for the side sheet', () => {
  it.each([
    // window, the width the person chose, makes room
    [1900, 432, true],
    [1320, 432, true],
    [1168, 432, true],
    [1167, 432, false],
    [1100, 432, false],
    [1100, 320, true],
    [720, 320, false],
    // Drawn narrower than chosen in a smaller window, the sheet is measured as it is drawn.
    [1300, 960, false],
    [2000, 960, true]
  ])('in a window %i wide with a sheet of %i: %s', (window, width, wanted) => {
    expect(hubMakesRoom(window, width)).toBe(wanted)
  })
})
