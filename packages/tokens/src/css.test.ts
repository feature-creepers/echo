import { describe, expect, it } from 'vitest'
import { accents, neutralAccent } from './accent.ts'
import { color } from './color.ts'
import { accentVariables, themeVariables } from './css.ts'

/** The contrast ratio of two colours written as #rrggbb, as WCAG defines it. */
function contrast(one: string, other: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((at) => {
      const channel = parseInt(hex.slice(at, at + 2), 16) / 255
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    }) as [number, number, number]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [light, dark] = [luminance(one), luminance(other)].sort((a, b) => b - a) as [number, number]
  return (light + 0.05) / (dark + 0.05)
}

describe('themeVariables', () => {
  it('names every value in kebab case, with its unit', () => {
    const variables = themeVariables()
    expect(variables['--color-ground']).toBe(color.ground)
    expect(variables['--color-rule-strong']).toBe(color.ruleStrong)
    expect(variables['--space-xl']).toBe('24px')
    expect(variables['--frame-title-bar']).toBe('32px')
    expect(variables['--size-body']).toBe('15px')
    expect(variables['--motion-quick']).toBe('120ms')
    expect(variables['--font-mono']).toContain('monospace')
  })

  it('starts with the neutral accent, until a persona is known', () => {
    expect(themeVariables()['--accent']).toBe(neutralAccent.solid)
  })
})

describe('accentVariables', () => {
  it('gives the four values of the accent named', () => {
    expect(accentVariables('red')).toEqual({
      '--accent': accents.red.solid,
      '--accent-soft': accents.red.soft,
      '--accent-glow': accents.red.glow,
      '--accent-ink': accents.red.ink
    })
  })
})

describe('the colours', () => {
  it.each(['text', 'textSoft', 'textFaint', 'danger'] as const)('%s reads on the ground and on a surface', (name) => {
    expect(contrast(color[name], color.ground)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(color[name], color.surface)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(Object.entries({ ...accents, neutral: neutralAccent }))('the %s accent reads on the ground, and its ink reads on it', (_name, accent) => {
    expect(contrast(accent.solid, color.ground)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(accent.ink, accent.solid)).toBeGreaterThanOrEqual(4.5)
  })
})
