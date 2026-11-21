import { describe, expect, it } from 'vitest'
import { arrivedAt, restOn, type Spot, type Travel, travelTowards } from './travel.ts'

type Place = 'board' | 'empty'

/** The places of the stage: the top left of the board, small, and the middle of an empty stage, large. */
const SPOTS: Record<Place, Spot> = { board: { x: 44, y: 60, size: 56 }, empty: { x: 600, y: 360, size: 280 } }

const FRAME = 1 / 60

/** A core resting on a place. */
function restingOn(place: Place): Travel<Place> {
  const here: Travel<Place> = { x: 0, y: 0, size: 0, speedX: 0, speedY: 0, growth: 0, rested: null }
  restOn(here, place, SPOTS[place])
  return here
}

/** Draws this many frames of the core going to a place, and where it was drawn on each. */
function frames(here: Travel<Place>, place: Place, count: number): Spot[] {
  return Array.from({ length: count }, () => {
    travelTowards(here, place, SPOTS[place], FRAME)
    return { x: here.x, y: here.y, size: here.size }
  })
}

describe('the core travelling between its places', () => {
  it('follows the place it rests on at once, frame or not', () => {
    const here = restingOn('board')
    const scrolled = { x: 600, y: 12, size: 72 }
    expect(travelTowards(here, 'board', scrolled, undefined)).toBe(true)
    expect(here).toMatchObject({ ...scrolled, rested: 'board' })
  })

  it('stays where it is on its way while no frame is drawn', () => {
    const here = restingOn('board')
    expect(travelTowards(here, 'empty', SPOTS.empty, undefined)).toBe(false)
    expect(here).toMatchObject({ ...SPOTS.board, rested: null })
  })

  it('glides to a new place and rests there', () => {
    const here = restingOn('board')
    const drawn = frames(here, 'empty', 90)
    // Its first frame moves it a little of the way, and it rests on its new place within about a second and a half.
    expect(drawn[0]?.y).toBeLessThan(SPOTS.board.y + (SPOTS.empty.y - SPOTS.board.y) * 0.1)
    expect(here.rested).toBe('empty')
    expect(here).toMatchObject(SPOTS.empty)
  })

  it('never overshoots its place on the way', () => {
    const here = restingOn('board')
    const drawn = frames(here, 'empty', 90)
    expect(Math.max(...drawn.map((spot) => spot.y))).toBeLessThanOrEqual(SPOTS.empty.y + 0.5)
    expect(Math.max(...drawn.map((spot) => spot.size))).toBeLessThanOrEqual(SPOTS.empty.size + 0.5)
  })

  it.each([
    ['just after it left', 2],
    ['half way', 12],
    ['nearly there', 30]
  ])('turned back %s, glides back from where it is rather than jumping', (_when, out) => {
    const here = restingOn('board')
    const drawn = frames(here, 'empty', out)
    const turned = drawn.at(-1) as Spot
    // The first frame back starts from where it was drawn: a frame's worth of travel at most, never the whole way.
    expect(travelTowards(here, 'board', SPOTS.board, FRAME)).toBe(true)
    expect(here.rested).toBe(null)
    expect(Math.abs(here.y - turned.y)).toBeLessThan(20)
    expect(arrivedAt(here, 'board', SPOTS.board)).toBe(false)
    frames(here, 'board', 120)
    expect(here.rested).toBe('board')
    expect(arrivedAt(here, 'board', SPOTS.board)).toBe(true)
  })

  it('counts as arrived a little before it rests, so what is written under it comes in as it settles', () => {
    const here = restingOn('board')
    const arrivals = Array.from({ length: 90 }, () => {
      travelTowards(here, 'empty', SPOTS.empty, FRAME)
      return [arrivedAt(here, 'empty', SPOTS.empty), here.rested === 'empty'] as const
    })
    const arrived = arrivals.findIndex(([at]) => at)
    const rested = arrivals.findIndex(([, at]) => at)
    expect(arrived).toBeGreaterThan(0)
    expect(arrived).toBeLessThan(rested)
  })

  it('counts a long frame as a short one, so a stall never throws it', () => {
    const stalled = restingOn('board')
    const short = restingOn('board')
    travelTowards(stalled, 'empty', SPOTS.empty, 2)
    travelTowards(short, 'empty', SPOTS.empty, 0.05)
    expect(stalled).toEqual(short)
  })
})
