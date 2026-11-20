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

/** Where a card leaves the stream, in pixels from the top of the stream's box, and over how far it fades out there. */
interface Edges {
  /** The room under the top of the box over which what rises fades out. */
  inset: number
  /** Where the composer's top is: nothing of a card is seen below it. */
  floor: number
  /** The room above the composer's top over which what sinks fades out. */
  fade: number
}

/** The mask of a card that has sunk wholly under the composer's top: nothing of it is seen. */
const UNSEEN = 'linear-gradient(transparent,transparent)'

/**
 * The mask that fades a card out where it leaves the stream, in the card's own coordinates before it is scaled: as it
 * rises past the top of the stream's box, over the inset under it; and as it sinks towards the composer, over the fade
 * above the composer's top, so that nothing of it is seen behind the composer. Empty while the card is whole. Each
 * card carries its own, as a mask over the whole stream is drawn again on every frame that anything in it moves.
 */
export function maskOf(middle: number, height: number, scale: number, edges: Edges): string {
  // Where a place of the box falls on the card.
  const on = (y: number) => height / 2 + (y - middle) / scale
  const stops: string[] = []
  const top = on(0)
  if (top > -edges.inset / scale && top < height) stops.push(`transparent ${top.toFixed(1)}px`, `black ${(top + edges.inset / scale).toFixed(1)}px`)
  const bottom = on(edges.floor)
  if (bottom <= 0) return UNSEEN
  const start = bottom - edges.fade / scale
  if (start < height) stops.push(`black ${start.toFixed(1)}px`, `transparent ${bottom.toFixed(1)}px`)
  return stops.length > 0 ? `linear-gradient(to bottom,${stops.join(',')})` : ''
}

/**
 * How far the stream sinks at home, so that only the top `peek` pixels of its newest card show above the composer:
 * from where that card's top rests when the stream is at its top, and where the composer's top is, both from the top
 * of the stream's box. Nothing when no more than that shows already.
 */
export function sinkOf(newestTop: number, floor: number, peek: number): number {
  return Math.max(0, floor - newestTop - peek)
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
