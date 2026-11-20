/** A colour as red, green and blue from 0 to 255. */
export type Rgb = readonly [number, number, number]

/** The accent read when the surrounding element sets none. */
const FALLBACK_ACCENT = '#a4adbb'

let probe: CanvasRenderingContext2D | null | undefined

/**
 * Reads the accent an element asks for, as `--accent`, whatever way the colour is written: the browser paints it on
 * a canvas of one pixel, and the pixel is read back. One canvas serves every reader.
 */
export function readAccent(element: Element): [number, number, number] {
  probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!probe) return [164, 173, 187]
  probe.fillStyle = '#000'
  probe.fillStyle = getComputedStyle(element).getPropertyValue('--accent').trim() || FALLBACK_ACCENT
  probe.clearRect(0, 0, 1, 1)
  probe.fillRect(0, 0, 1, 1)
  const [red = 0, green = 0, blue = 0] = probe.getImageData(0, 0, 1, 1).data
  return [red, green, blue]
}
