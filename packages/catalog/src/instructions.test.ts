import { describe, expect, it } from 'vitest'
import { BLOCKS } from './catalog.ts'
import { CARDS_PER_ANSWER, describeCatalog, SHOW_TOOL } from './instructions.ts'
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

  it('tells the model an answer may show a few named cards side by side, which its next answer replaces', () => {
    expect(text).toContain(`up to ${CARDS_PER_ANSWER} cards per answer, side by side, one call each with a short \`card\` name`)
    expect(text).toContain('your next answer replaces them all')
  })

  it('tells the model how wide to make each card on the row of twelve columns', () => {
    expect(text).toContain('give the main card `width` "two-thirds" and what supports it "third", two equals "half" each')
    expect(text).toContain('Left out, the cards share the row evenly.')
  })

  it('tells the model that what it says is the headline, and a card carries few words', () => {
    expect(text).toContain('What you say aloud is shown as the headline over your cards')
    expect(text).toContain('labels of one to three words, figures rather than sentences, never a sentence that repeats what you said')
  })

  it('tells the model to play media in the app, not to link to a web player', () => {
    expect(text).toContain('- Media { url: string; kind?: "audio" | "video"; title: string;')
    expect(text).toContain('Never show a link to a web player instead.')
  })

  it('tells the model to offer maps and charts itself, and never to say it cannot show one', () => {
    expect(text).toContain('- RegionMap { shapes: string; key: string;')
    expect(text).toContain('- PlaceMap { places:')
    expect(text).toContain('Offer the visual yourself, without being asked')
    expect(text).toContain('never say you cannot show one')
  })

  // About 3,700 tokens, live figures and buttons that act on the computer included. A new block is worth its words;
  // a catalogue that keeps growing is not.
  it('stays short enough to be part of every prompt', () => {
    expect(text.length).toBeLessThan(15_000)
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
