/**
 * How the core travels between the places the stage keeps for it (the middle of an empty stage, the top left of the
 * board), and when it rests on one. Plain numbers, so it is tested without a page and costs nothing on every frame.
 */

/**
 * The spring the core travels on, and its name and state with it: soft enough to follow with the eye, damped so it
 * settles without bouncing, in about half a second.
 */
export const TRAVEL = { stiffness: 210, damping: 30 } as const

/** Where the core is drawn, its middle from the top left of the stage, and how large. */
export interface Spot {
  x: number
  y: number
  size: number
}

/** Where the core is, how fast each of its measures is changing, and the place it rests on. */
export interface Travel<Place> extends Spot {
  speedX: number
  speedY: number
  growth: number
  /** The place it rests on, once it has reached it; nothing while it is on its way to one. */
  rested: Place | null
}

/** The longest step of the spring, and the most time one frame counts for, so a long frame never throws the core. */
const STEP = 1 / 240
const LONGEST_FRAME = 0.05

/** How near its place and how still the core must be to rest on it, in pixels and pixels a second. */
const REST = { away: 0.5, speed: 4 } as const

/** How near and how still to count as arrived, for what is written under it to come in. */
const ARRIVED = { away: 6, speed: 60 } as const

/** Puts the core on a place at once, still, resting there. */
export function restOn<Place>(here: Travel<Place>, place: Place, spot: Spot): void {
  Object.assign(here, { x: spot.x, y: spot.y, size: spot.size, speedX: 0, speedY: 0, growth: 0, rested: place })
}

/**
 * Moves the core towards the place it belongs on now, drawn at `spot`. On the place it rests on, it is simply there:
 * when that place scrolls or is pushed by what is round it, the core moves with it. On its way, it goes `seconds`
 * further on its spring, or stays where it is when no frame is drawn. Whether it moved.
 */
export function travelTowards<Place>(here: Travel<Place>, place: Place, spot: Spot, seconds: number | undefined): boolean {
  if (here.rested === place) {
    restOn(here, place, spot)
    return true
  }
  // Once its place changes, it rests nowhere until it reaches the new one. Turned back on its way, before it got
  // there, it glides back from where it is, carrying its speed, rather than jumping onto the place it had left.
  here.rested = null
  if (seconds === undefined) return false
  for (let left = Math.min(LONGEST_FRAME, seconds); left > 1e-6; left -= STEP) {
    const step = Math.min(left, STEP)
    here.speedX += (TRAVEL.stiffness * (spot.x - here.x) - TRAVEL.damping * here.speedX) * step
    here.speedY += (TRAVEL.stiffness * (spot.y - here.y) - TRAVEL.damping * here.speedY) * step
    here.growth += (TRAVEL.stiffness * (spot.size - here.size) - TRAVEL.damping * here.growth) * step
    here.x += here.speedX * step
    here.y += here.speedY * step
    here.size += here.growth * step
  }
  if (away(here, spot) < REST.away && Math.hypot(here.speedX, here.speedY) < REST.speed) here.rested = place
  return true
}

/** Whether the core has arrived at its place: resting on it, or within a few pixels of it and nearly still. */
export function arrivedAt<Place>(here: Travel<Place>, place: Place, spot: Spot): boolean {
  return here.rested === place || (away(here, spot) < ARRIVED.away && Math.hypot(here.speedX, here.speedY) < ARRIVED.speed)
}

/** How far the core is drawn from a spot, in place and in size together. */
function away(here: Spot, spot: Spot): number {
  return Math.hypot(spot.x - here.x, spot.y - here.y) + Math.abs(spot.size - here.size)
}
