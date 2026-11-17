import type { Feature } from '@repo/catalog'
import { geoArea } from 'd3-geo'
import { describe, expect, it } from 'vitest'
import { formatValue, frame, inFrame, mercator, placeLabels, position, rewound, scaleOf, shade, tilesFor } from './map-geometry.ts'

const square = (clockwise: boolean): Feature => {
  const ring: [number, number][] = [
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0]
  ]
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [clockwise ? ring : [...ring].reverse()] } }
}

describe('rewound', () => {
  it('turns round an area wound the way that would cover the rest of the globe', () => {
    for (const feature of [square(true), square(false)]) expect(geoArea(rewound(feature) as never)).toBeLessThan(0.001)
  })

  it('turns each polygon of a multipolygon on its own', () => {
    const multi: Feature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'MultiPolygon', coordinates: [square(true).geometry.coordinates as never, square(false).geometry.coordinates as never] }
    }
    expect(geoArea(rewound(multi) as never)).toBeLessThan(0.001)
  })
})

describe('scales', () => {
  it('places a value between the ends of a sequential scale', () => {
    const scale = scaleOf([10, 20, 30], { scale: 'sequential' })
    expect([position(10, scale), position(20, scale), position(30, scale), position(40, scale)]).toEqual([0, 0.5, 1, 1])
  })

  it('places a value on either side of the midpoint of a diverging scale', () => {
    const scale = scaleOf([-4, 2], { scale: 'diverging', domain: [-4, 4] })
    expect([position(-4, scale), position(-2, scale), position(0, scale), position(2, scale)]).toEqual([-1, -0.5, 0, 0.5])
  })

  it('mixes the tone of the side into the ground, more of it further out', () => {
    expect(shade(1, { high: 'red', low: 'blue' })).toBe('color-mix(in oklab, red 100%, var(--color-raised))')
    expect(shade(-0.5, { high: 'red', low: 'blue' })).toBe('color-mix(in oklab, blue 57%, var(--color-raised))')
  })

  it('writes figures with their unit, fewer decimals as they grow', () => {
    expect([formatValue(27.846, '%', 'en'), formatValue(1234.5, '€', 'en'), formatValue(4.567, 'km', 'en')]).toEqual(['27.8 %', '1,235€', '4.57 km'])
  })
})

describe('the street map', () => {
  it('puts the meridian and the equator in the middle of the world', () => {
    expect(mercator(0, 0)).toEqual([128, 128])
  })

  it('frames every place, centred, with its margins', () => {
    const places = [
      { lat: 48.8566, lon: 2.3522 },
      { lat: 45.764, lon: 4.8357 }
    ]
    const at = frame(places, 800, 400)
    for (const place of places) {
      const [x, y] = inFrame(place, at)
      expect(x).toBeGreaterThanOrEqual(48)
      expect(x).toBeLessThanOrEqual(752)
      expect(y).toBeGreaterThanOrEqual(48)
      expect(y).toBeLessThanOrEqual(352)
    }
  })

  it('gives one place a street-level view, and covers the frame with tiles', () => {
    const at = frame([{ lat: 48.8566, lon: 2.3522 }], 512, 256)
    expect(at.zoom).toBe(13)
    const tiles = tilesFor(at, 512, 256)
    expect(tiles.length).toBeGreaterThanOrEqual(3)
    expect(Math.min(...tiles.map((tile) => tile.left))).toBeLessThanOrEqual(0)
    expect(Math.max(...tiles.map((tile) => tile.left + 256))).toBeGreaterThanOrEqual(512)
  })
})

describe('placeLabels', () => {
  it('puts a label beside its marker, and moves the next one aside when they would overlap', () => {
    const [first, second] = placeLabels(
      [
        [100, 100],
        [104, 102]
      ],
      ['Tokyo', 'Yokohama']
    )
    // Tokyo's label would cover Yokohama's marker on the right, so it goes to the left; Yokohama's takes the right.
    expect(first).toEqual({ dx: -9, dy: 0, anchor: 'end' })
    expect(second).toEqual({ dx: 9, dy: 0, anchor: 'start' })
  })

  it('leaves out a label with no room on any side', () => {
    const crowd = Array.from({ length: 12 }, (_, index) => [100 + (index % 3), 100 + Math.floor(index / 3)] as [number, number])
    expect(
      placeLabels(
        crowd,
        crowd.map(() => 'A long name')
      ).filter((label) => label === undefined).length
    ).toBeGreaterThan(0)
  })
})
