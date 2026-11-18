import { describe, expect, it } from 'vitest'
import { accents, neutralAccent } from './accent.ts'
import { color } from './color.ts'
// The generated file is read as text, the way a bundler would hand over any file asked for with ?raw.
import written from './theme.generated.css?raw'
import { renderTheme } from './theme.ts'

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

describe('the theme', () => {
  it('is the file the web interface imports: run `pnpm theme` after changing a value', () => {
    expect(written).toBe(renderTheme())
  })

  it('names every value in kebab case, with its unit', () => {
    const theme = renderTheme()
    expect(theme).toContain(`--color-ground: ${color.ground};`)
    expect(theme).toContain(`--color-text-soft: ${color.textSoft};`)
    expect(theme).toContain('--radius-md: 4px;')
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
  const layers = [color.ground, color.surface, color.raised, color.overlay]

  it.each(['text', 'textSoft', 'textFaint', 'danger', 'ok', 'warn'] as const)('%s reads on every layer', (name) => {
    for (const layer of layers) expect(contrast(color[name], layer)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(Object.entries({ ...accents, neutral: neutralAccent }))('the %s accent reads on every layer, and its ink reads on it', (_name, accent) => {
    for (const layer of layers) expect(contrast(accent.solid, layer)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(accent.ink, accent.solid)).toBeGreaterThanOrEqual(4.5)
  })
})
