import { describe, expect, it } from 'vitest'
import { arrivedAt, restOn, type Spot, type Travel, travelTowards } from './travel.ts'

type Place = 'top' | 'home'

/** The places of a stage with views: the top of the column, small, and home, large in the middle. */
const SPOTS: Record<Place, Spot> = { top: { x: 600, y: 40, size: 72 }, home: { x: 600, y: 360, size: 280 } }

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
    const here = restingOn('top')
    const scrolled = { x: 600, y: 12, size: 72 }
    expect(travelTowards(here, 'top', scrolled, undefined)).toBe(true)
    expect(here).toMatchObject({ ...scrolled, rested: 'top' })
  })

  it('stays where it is on its way while no frame is drawn', () => {
    const here = restingOn('top')
    expect(travelTowards(here, 'home', SPOTS.home, undefined)).toBe(false)
    expect(here).toMatchObject({ ...SPOTS.top, rested: null })
  })

  it('glides to a new place and rests there', () => {
    const here = restingOn('top')
    const drawn = frames(here, 'home', 90)
    // Its first frame moves it a little of the way, and it rests on its new place within about a second and a half.
    expect(drawn[0]?.y).toBeLessThan(SPOTS.top.y + (SPOTS.home.y - SPOTS.top.y) * 0.1)
    expect(here.rested).toBe('home')
    expect(here).toMatchObject(SPOTS.home)
  })

  it('never overshoots its place on the way', () => {
    const here = restingOn('top')
    const drawn = frames(here, 'home', 90)
    expect(Math.max(...drawn.map((spot) => spot.y))).toBeLessThanOrEqual(SPOTS.home.y + 0.5)
    expect(Math.max(...drawn.map((spot) => spot.size))).toBeLessThanOrEqual(SPOTS.home.size + 0.5)
  })

  it.each([
    ['just after it left', 2],
    ['half way', 12],
    ['nearly there', 30]
  ])('turned back %s, glides back from where it is rather than jumping', (_when, out) => {
    const here = restingOn('top')
    const drawn = frames(here, 'home', out)
    const turned = drawn.at(-1) as Spot
    // The first frame back starts from where it was drawn: a frame's worth of travel at most, never the whole way.
    expect(travelTowards(here, 'top', SPOTS.top, FRAME)).toBe(true)
    expect(here.rested).toBe(null)
    expect(Math.abs(here.y - turned.y)).toBeLessThan(20)
    expect(arrivedAt(here, 'top', SPOTS.top)).toBe(false)
    frames(here, 'top', 120)
    expect(here.rested).toBe('top')
    expect(arrivedAt(here, 'top', SPOTS.top)).toBe(true)
  })

  it('counts as arrived a little before it rests, so what is written under it comes in as it settles', () => {
    const here = restingOn('top')
    const arrivals = Array.from({ length: 90 }, () => {
      travelTowards(here, 'home', SPOTS.home, FRAME)
      return [arrivedAt(here, 'home', SPOTS.home), here.rested === 'home'] as const
    })
    const arrived = arrivals.findIndex(([at]) => at)
    const rested = arrivals.findIndex(([, at]) => at)
    expect(arrived).toBeGreaterThan(0)
    expect(arrived).toBeLessThan(rested)
  })

  it('counts a long frame as a short one, so a stall never throws it', () => {
    const stalled = restingOn('top')
    const short = restingOn('top')
    travelTowards(stalled, 'home', SPOTS.home, 2)
    travelTowards(short, 'home', SPOTS.home, 0.05)
    expect(stalled).toEqual(short)
  })
})
