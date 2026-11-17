import { describe, expect, it } from 'vitest'
import { dialOf, EDGE, roomOf } from './dial.ts'

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
