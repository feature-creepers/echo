import { ILLUSTRATIONS } from '@repo/catalog'
import { describe, expect, it } from 'vitest'
import { illustration, PAGE_ILLUSTRATIONS } from './illustrations.ts'

describe('the illustrations', () => {
  it.each(ILLUSTRATIONS)('draw %s as one picture of vectors on a square, in the ink around it', (name) => {
    const drawn = illustration(name)
    expect(drawn.startsWith('<svg class="echo-il" viewBox="0 0 96 96"')).toBe(true)
    expect(drawn.endsWith('</svg>')).toBe(true)
    expect(drawn).toContain('currentColor')
    // Nothing but shapes: no script, no picture or font from anywhere, nothing a page's policy would refuse.
    expect(drawn).not.toMatch(/<script|<image|<foreignObject|href=|url\((?!#echo-il-)/)
  })

  it('move by transforms and opacity only, and hold still when less motion is asked for', () => {
    const { rules } = PAGE_ILLUSTRATIONS
    const moved = [...rules.matchAll(/@keyframes [\w-]+\{(.*?\})\}/g)].flatMap(([, frames]) =>
      [...(frames ?? '').matchAll(/([\w-]+):/g)].map(([, property]) => property)
    )
    expect(moved.length).toBeGreaterThan(0)
    expect(new Set(moved)).toEqual(new Set(['transform', 'opacity']))
    expect(rules).toContain('@media (prefers-reduced-motion:reduce){.echo-il *{animation:none!important}}')
  })

  it('give a page each drawing without the rules it carries once', () => {
    expect(Object.keys(PAGE_ILLUSTRATIONS.drawn)).toEqual([...ILLUSTRATIONS])
    for (const drawn of Object.values(PAGE_ILLUSTRATIONS.drawn)) expect(drawn).not.toContain('<style>')
    expect(illustration('rain')).toContain(`<style>${PAGE_ILLUSTRATIONS.rules}</style>`)
  })
})
