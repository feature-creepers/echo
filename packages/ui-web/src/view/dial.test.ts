import { describe, expect, it } from 'vitest'
import { dialOf, EDGE, maskOf, roomOf, sinkOf } from './dial.ts'

const band = { top: 40, bottom: 640 }

describe('the dial', () => {
  it('draws the card in the middle of the band whole', () => {
    expect(dialOf(340, 300, band)).toEqual({ scale: 1, opacity: 1 })
  })

  it('shrinks and fades a card towards the edges of the band', () => {
    const near = dialOf(400, 300, band)
    const edge = dialOf(640, 300, band)
    expect(near.scale).toBeLessThan(1)
    expect(near.opacity).toBeGreaterThan(edge.opacity)
    expect(edge.scale).toBeCloseTo(EDGE.scale)
    expect(edge.opacity).toBeCloseTo(EDGE.opacity)
    expect(dialOf(40, 300, band)).toEqual(edge)
  })

  it('fades a card out once it has left the band', () => {
    expect(dialOf(640 + 150, 300, band).opacity).toBe(0)
    expect(dialOf(40 - 150, 300, band).opacity).toBe(0)
    expect(dialOf(640 + 75, 300, band).opacity).toBeGreaterThan(0)
  })

  it('keeps a card taller than the band whole while it covers the band', () => {
    // 1000 pixels tall in a band of 600: whole while its middle is within 200 pixels of the band's.
    expect(dialOf(340 + 200, 1000, band)).toEqual({ scale: 1, opacity: 1 })
    expect(dialOf(340 - 200, 1000, band)).toEqual({ scale: 1, opacity: 1 })
    expect(dialOf(340 + 300, 1000, band).opacity).toBeLessThan(1)
  })

  it('leaves room for the newest and the oldest card to rest in the middle', () => {
    expect(roomOf(200, 100, band, 740)).toEqual({ top: 240, bottom: 350 })
  })

  it('rests a card taller than the band at its top, and lets the last one reach its bottom', () => {
    expect(roomOf(900, 900, band, 740)).toEqual({ top: 40, bottom: 100 })
  })
})

describe('where a card leaves the stream', () => {
  // A box whose composer's top is 680 pixels down, with 48 pixels of fade under the top and 40 above the composer.
  const edges = { inset: 48, floor: 680, fade: 40 }

  it.each([
    { name: 'whole in the middle', middle: 340, height: 300, scale: 1, mask: '' },
    {
      name: 'rising past the top',
      middle: 100,
      height: 300,
      scale: 1,
      mask: 'linear-gradient(to bottom,transparent 50.0px,black 98.0px)'
    },
    {
      name: 'sinking towards the composer',
      middle: 600,
      height: 300,
      scale: 1,
      mask: 'linear-gradient(to bottom,black 190.0px,transparent 230.0px)'
    },
    {
      name: 'taller than the box, cut at both ends',
      middle: 340,
      height: 800,
      scale: 1,
      mask: 'linear-gradient(to bottom,transparent 60.0px,black 108.0px,black 700.0px,transparent 740.0px)'
    },
    { name: 'sunk wholly under the composer', middle: 900, height: 300, scale: 1, mask: 'linear-gradient(transparent,transparent)' },
    {
      name: 'scaled down, in its own coordinates',
      middle: 600,
      height: 300,
      scale: 0.8,
      mask: 'linear-gradient(to bottom,black 200.0px,transparent 250.0px)'
    }
  ])('fades a card out $name', ({ middle, height, scale, mask }) => {
    expect(maskOf(middle, height, scale, edges)).toBe(mask)
  })

  it('never shows a card below the composer, whatever the fade', () => {
    for (const fade of [0, 40, 96]) {
      const mask = maskOf(600, 300, 1, { ...edges, fade })
      expect(mask.endsWith('transparent 230.0px)')).toBe(true)
    }
  })
})

describe('the stream at home', () => {
  it.each([
    { name: 'sinks so that only the peek of the newest card shows', top: 240, floor: 680, peek: 96, sink: 344 },
    { name: 'stays where it is when no more than the peek shows', top: 600, floor: 680, peek: 96, sink: 0 }
  ])('$name', ({ top, floor, peek, sink }) => {
    expect(sinkOf(top, floor, peek)).toBe(sink)
  })
})
