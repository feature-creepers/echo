import { describe, expect, it } from 'vitest'
import { css, shadedFill, shadedPaint } from './slide-svg.ts'

const paint = (hex: string) => {
  const value = Number.parseInt(hex.slice(1), 16)
  return { red: value >> 16, green: (value >> 8) & 0xff, blue: value & 0xff, opacity: 1 }
}

describe('a colour darkened or lightened', () => {
  it.each([
    { colour: '#729fcf', rule: 'blend' as const, amount: -0.4, shaded: '#445f7c' },
    { colour: '#729fcf', rule: 'blend' as const, amount: 0.4, shaded: '#aac5e2' },
    { colour: '#729fcf', rule: 'blend' as const, amount: 0, shaded: '#729fcf' },
    { colour: '#729fcf', rule: 'value' as const, amount: -0.2, shaded: '#5b7fa6' },
    { colour: '#729fcf', rule: 'value' as const, amount: 0.2, shaded: '#8bb0d9' },
    { colour: '#ff0000', rule: 'value' as const, amount: 0.4, shaded: '#ff6666' },
    { colour: '#000000', rule: 'value' as const, amount: 0.4, shaded: '#666666' },
    { colour: '#808080', rule: 'value' as const, amount: -0.4, shaded: '#4d4d4d' }
  ])('shades $colour by $rule $amount to $shaded', ({ colour, rule, amount, shaded }) => {
    expect(css(shadedPaint(paint(colour), rule, amount))).toBe(shaded)
  })

  it('shades each colour of a gradient, and leaves a picture as it is', () => {
    const gradient = shadedFill({ kind: 'gradient', stops: [{ offset: 0, paint: paint('#ffffff') }], angle: 0, radial: false }, 'blend', -0.5)
    expect(gradient.kind === 'gradient' && css(gradient.stops[0]?.paint ?? paint('#000000'))).toBe('#808080')
    const picture = { kind: 'picture' as const, href: 'data:image/png;base64,', crop: undefined }
    expect(shadedFill(picture, 'blend', -0.5)).toBe(picture)
  })
})
