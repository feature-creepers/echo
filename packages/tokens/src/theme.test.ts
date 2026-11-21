import { describe, expect, it } from 'vitest'
import { accents, neutralAccent } from './accent.ts'
import { code, color } from './color.ts'
// The generated file is read as text, the way a bundler would hand over any file asked for with ?raw.
import written from './theme.generated.css?raw'
import { renderTheme } from './theme.ts'
import { font } from './type.ts'

/** The contrast ratio of two colours written as #rrggbb, as WCAG defines it. */
function contrast(one: string, other: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((at) => {
      const channel = Number.parseInt(hex.slice(at, at + 2), 16) / 255
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    }) as [number, number, number]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [light, dark] = [luminance(one), luminance(other)].sort((a, b) => b - a) as [number, number]
  return (light + 0.05) / (dark + 0.05)
}

/** A colour laid at an opacity over another, both written as #rrggbb, as the page composes a tint. */
function mix(top: string, under: string, opacity: number): string {
  const channel = (hex: string, at: number) => Number.parseInt(hex.slice(at, at + 2), 16)
  return `#${[1, 3, 5]
    .map((at) => Math.round(channel(top, at) * opacity + channel(under, at) * (1 - opacity)))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`
}

describe('the theme', () => {
  it('is the file the web interface imports: run `pnpm theme` after changing a value', () => {
    expect(written).toBe(renderTheme())
  })

  it('names every value in kebab case, with its unit', () => {
    const theme = renderTheme()
    expect(theme).toContain(`--color-ground: ${color.ground};`)
    expect(theme).toContain(`--color-text-soft: ${color.textSoft};`)
    expect(theme).toContain(`--font-display: ${font.display};`)
    expect(theme).not.toMatch(/--radius-\w+:/)
    expect(theme).toContain('--frame-title-bar: 38px;')
    expect(theme).toContain('--duration-quick: 120ms;')
  })

  it('makes the accent a variable read where it is used, starting with the neutral one', () => {
    const theme = renderTheme()
    expect(theme).toMatch(/@theme inline \{\s+--color-accent: var\(--accent\);/)
    expect(theme).toContain(`--accent: ${neutralAccent.solid};`)
  })
})

describe('the colours', () => {
  const layers = [color.ground, color.panel, color.surface, color.raised]

  it.each(['text', 'textSoft', 'textFaint', 'danger', 'ok', 'warn', 'info'] as const)('%s reads on every layer', (name) => {
    for (const layer of layers) expect(contrast(color[name], layer)).toBeGreaterThanOrEqual(4.5)
  })

  // Code is drawn over the faint tints of lines added and removed too, so each of its colours reads on those.
  it.each(Object.entries(code))('code’s %s colour reads on every layer, and over the tints of a diff', (_name, value) => {
    const tinted = layers.flatMap((layer) => [
      mix(color.info, layer, 0.07),
      mix(color.danger, layer, 0.07),
      mix(color.info, layer, 0.24),
      mix(color.danger, layer, 0.24)
    ])
    for (const layer of [...layers, ...tinted]) expect(contrast(value, layer)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(Object.entries({ ...accents, neutral: neutralAccent }))('the %s accent reads on every layer, and its ink reads on it', (_name, accent) => {
    for (const layer of layers) expect(contrast(accent.solid, layer)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(accent.ink, accent.solid)).toBeGreaterThanOrEqual(4.5)
  })
})
