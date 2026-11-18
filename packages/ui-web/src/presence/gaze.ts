/**
 * Where the core looks, worked out from where things are on the screen: the pointer, or a view it is talking
 * about. Plain numbers, so they are tested without a page.
 */

/** A point on the screen, in CSS pixels from the top left of the window. */
export interface Point {
  x: number
  y: number
}

/**
 * The gaze from the core towards a point, as `Input.gaze` takes it: a direction across the screen, up as up, whose
 * length grows with the distance and never reaches 1, so a far point turns the eye most of the way and no point
 * snaps it to its edge. At `reach` pixels away, the eye is turned about seven tenths of the way.
 */
export function gazeAt(core: Point, point: Point, reach: number): [number, number] {
  const across = point.x - core.x
  const up = core.y - point.y
  const distance = Math.hypot(across, up)
  if (distance < 1e-6 || reach <= 0) return [0, 0]
  const far = distance / reach
  const strength = far / Math.sqrt(1 + far * far)
  return [(across / distance) * strength, (up / distance) * strength]
}

/** The middle of a box on the screen. */
export function middleOf(box: { left: number; top: number; width: number; height: number }): Point {
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
}
