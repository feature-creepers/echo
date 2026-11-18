/** A colour as red, green and blue from 0 to 255. */
export type Rgb = readonly [number, number, number]

/**
 * Reads a CSS colour, whatever way it is written, as red, green and blue from 0 to 255: the browser paints it on a
 * canvas of one pixel, and the pixel is read back.
 */
export function readColor(probe: CanvasRenderingContext2D, value: string): [number, number, number] {
  probe.fillStyle = '#000'
  probe.fillStyle = value
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

/** The lamp of the lens: a warm filament behind a filter of the accent. */
export function lampResponse([red, green, blue]: Rgb): [number, number, number] {
  return [((red / 255) ** 2.2 + 0.04) * 1, ((green / 255) ** 2.2 + 0.04) * 0.66, ((blue / 255) ** 2.2 + 0.04) * 0.35]
}

/** A CSS colour from channels from 0 to 1, and an opacity. */
export function css([red, green, blue]: readonly [number, number, number], alpha = 1): string {
  return `rgb(${Math.round(red * 255)} ${Math.round(green * 255)} ${Math.round(blue * 255)} / ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`
}

/**
 * Light as a CSS colour to add to a canvas: its brightest channel becomes its opacity, so where there is little
 * light the canvas stays clear, and what is behind it shows.
 */
export function light(channels: readonly [number, number, number], strength = 1): string {
  const peak = Math.max(...channels, 1e-4)
  return css(channels.map((channel) => channel / peak) as [number, number, number], peak * strength)
}
