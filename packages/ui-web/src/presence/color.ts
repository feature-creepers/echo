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

/**
 * Light as warm as it is strong: its colour where faint, through the colours its filter leaks, to white where it
 * burns, each channel from 0 to 1. The response says how fast each channel fills; the strongest fills at the given
 * pace. The shaders work it out the same way (`burn` in `glsl.ts`), so both drawings of a look share their light.
 */
export function burn(intensity: number, response: readonly [number, number, number]): [number, number, number] {
  const strongest = Math.max(...response)
  return response.map((channel) => 1 - Math.exp((-intensity * channel) / strongest)) as [number, number, number]
}

/** A CSS colour from channels from 0 to 1, and an opacity. */
export function css([red, green, blue]: readonly [number, number, number], alpha: number): string {
  return `rgb(${Math.round(red * 255)} ${Math.round(green * 255)} ${Math.round(blue * 255)} / ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`
}

/**
 * Light as a CSS colour to add to a canvas: its brightest channel becomes its opacity, so where there is little
 * light the canvas stays clear, and what is behind it shows.
 */
export function light(channels: readonly [number, number, number]): string {
  const peak = Math.max(...channels, 1e-4)
  return css(channels.map((channel) => channel / peak) as [number, number, number], peak)
}
