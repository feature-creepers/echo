/**
 * The geometry of the stream of views on the main screen, which turns like a dial: the card in the middle of
 * the band is whole, and the others shrink a little and fade the further they are from it. Plain numbers, so
 * it is tested without a page and costs nothing to run on every frame of a scroll.
 */

/**
 * The part of the stream's box a card is read in, from the top of the box: under the header, above the composer.
 * The room above the band is where what rises fades out before the box cuts it.
 */
export interface Band {
  top: number
  bottom: number
}

/** How a card looks at the edge of the band. Subtle on purpose: it should read as depth, not as an effect. */
export const EDGE = { scale: 0.94, opacity: 0.35 } as const

/** Flat at both ends: a card a few pixels off the middle stays whole, and one near the edge settles there. */
const ease = (x: number) => x * x * (3 - 2 * x)

/**
 * How a card is drawn, from where its middle is and how tall it is, both from the top of the stream's box. A card
 * taller than the band is read by scrolling through it, so it stays whole for as long as it covers the band. Past
 * the edge of the band, what is left of a card fades out, until it has gone under the composer or the header.
 */
export function dialOf(middle: number, height: number, band: Band): { scale: number; opacity: number } {
  const half = Math.max(1, (band.bottom - band.top) / 2)
  const slack = Math.max(0, height / 2 - half)
  const away = Math.max(0, Math.abs(middle - (band.top + half)) - slack) / half
  const near = ease(Math.min(1, away))
  const scale = 1 - (1 - EDGE.scale) * near
  if (away <= 1) return { scale, opacity: 1 - (1 - EDGE.opacity) * near }
  const gone = 1 + Math.min(height, 2 * half) / (2 * half)
  return { scale, opacity: EDGE.opacity * Math.max(0, 1 - (away - 1) / (gone - 1)) }
}

/**
 * The room above the newest card and below the oldest, so that either can rest in the middle of the band. A card
 * taller than the band rests with its top at the top of the band instead, and its bottom can reach the bottom.
 */
export function roomOf(first: number, last: number, band: Band, height: number): { top: number; bottom: number } {
  const middle = (band.top + band.bottom) / 2
  return {
    top: Math.max(band.top, middle - first / 2),
    bottom: Math.max(height - band.bottom, height - middle - last / 2)
  }
}
