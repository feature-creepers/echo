import { describe, expect, it } from 'vitest'
import { BLOCKS } from './catalog.ts'
import { describeCatalog, SHOW_TOOL } from './instructions.ts'
import { signature } from './signature.ts'

describe('describeCatalog', () => {
  const text = describeCatalog()

  it('describes every block, with its properties as a short type', () => {
    for (const name of Object.keys(BLOCKS)) expect(text).toContain(`- ${name} {`)
    expect(text).toContain('- Metric { label: string; value: string; unit?: string; detail?: string; trend?: "up" | "down" | "flat"; tone?:')
    expect(text).toContain('- Stack { gap?: "tight" | "normal" | "loose"; align?: "start" | "center" | "end" | "stretch" } with children')
  })

  it('names the tool and tells the model to compose, not to pick something ready-made', () => {
    expect(text).toContain(SHOW_TOOL)
    expect(text).toContain('Nothing is ready-made for any subject')
  })

  it('stays short enough to be part of every prompt', () => {
    expect(text.length).toBeLessThan(10_000)
  })
})

describe('signature', () => {
  it.each([
    [{ type: 'string' }, 'string'],
    [{ type: 'integer' }, 'number'],
    [{ enum: ['a', 'b'] }, '"a" | "b"'],
    [{ const: 1 }, '1'],
    [{ type: 'array', items: { type: 'string' } }, 'string[]'],
    [{ type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }] } }, '(string | number)[]'],
    [{ type: 'array', prefixItems: [{ type: 'number' }, { type: 'number' }] }, '[number, number]'],
    [
      { type: 'object', properties: { a: { type: 'string' }, b: { type: 'number', default: 1 }, c: { type: 'boolean' } }, required: ['a', 'b'] },
      '{ a: string; b?: number; c?: boolean }'
    ],
    [{ type: 'object', additionalProperties: { type: 'number' } }, '{ [key: string]: number }'],
    [{ type: ['string', 'integer'] }, 'string | number'],
    [{ type: 'object' }, '{}']
  ])('writes %j as %s', (schema, written) => {
    expect(signature(schema)).toBe(written)
  })
})
