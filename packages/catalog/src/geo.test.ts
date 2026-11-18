import { describe, expect, it } from 'vitest'
import { checkJoin, readRegions } from './geo.ts'
import { validateView } from './validate.ts'

const square = (x: number) => [
  [
    [x, 0],
    [x + 1, 0],
    [x + 1, 1],
    [x, 1],
    [x, 0]
  ]
]
const areas = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Polygon', coordinates: square(0) }, properties: { code: '01', nom: 'Ain' } },
    { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [square(2)] }, properties: { code: '2A', nom: 'Corse-du-Sud' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { code: 'x' } }
  ]
}

describe('readRegions', () => {
  it('keeps the areas and their properties, and leaves out what is not an area', () => {
    const read = readRegions(areas)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.regions.features.map((feature) => feature.properties.code)).toEqual(['01', '2A'])
  })

  it('rounds coordinates to what a screen can draw', () => {
    const read = readRegions({ type: 'Polygon', coordinates: [[[1.123456789, 2.987654321]]] })
    expect(read.ok && read.regions.features[0]?.geometry.coordinates).toEqual([[[1.1235, 2.9877]]])
  })

  it('says what is wrong with a document that holds no areas', () => {
    expect(readRegions({ type: 'Topology', objects: {} })).toMatchObject({ ok: false, problem: expect.stringContaining('TopoJSON') })
    expect(readRegions({ type: 'FeatureCollection', features: [areas.features[2]] })).toMatchObject({ ok: false, problem: expect.stringContaining('no areas') })
  })
})

describe('checkJoin', () => {
  const read = readRegions(areas)
  if (!read.ok) throw new Error('unreadable')
  const { regions } = read

  it('accepts figures that find their areas, and notes the areas left empty', () => {
    expect(checkJoin(regions, { key: 'code', name: 'nom', values: [{ region: '01' }] })).toEqual({
      problems: [],
      notes: ['1 of 2 areas have no value and are drawn empty: "2A".']
    })
  })

  it('names the properties that exist when the key is not one of them', () => {
    const [problem] = checkJoin(regions, { key: 'INSEE', values: [{ region: '01' }] }).problems
    expect(problem).toContain('"INSEE"')
    expect(problem).toContain('"code", "nom"')
  })

  it('shows what the codes look like when the figures do not match them', () => {
    const [problem] = checkJoin(regions, { key: 'code', values: [{ region: '1' }, { region: '2A' }] }).problems
    expect(problem).toContain('1 of 2 regions match no area\'s "code": "1"')
    expect(problem).toContain('look like: "01", "2A"')
  })

  it('refuses an area given twice', () => {
    expect(checkJoin(regions, { key: 'code', values: [{ region: '01' }, { region: '01' }] }).problems.join(' ')).toContain('more than once')
  })
})

describe('the map blocks', () => {
  it('accept a region map with figures by code, and read numeric codes as text', () => {
    const result = validateView({
      root: 'map',
      elements: { map: { type: 'RegionMap', props: { shapes: 'https://example.org/areas.geojson', key: 'code', values: [{ region: 1, value: 27.8 }] } } }
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.spec.elements.map?.props).toMatchObject({ values: [{ region: '1', value: 27.8 }], scale: 'sequential', tone: 'accent' })
  })

  it('refuse shapes that are not on https, and places off the globe', () => {
    const result = validateView({
      root: 'all',
      elements: {
        all: { type: 'Stack', children: ['regions', 'places'] },
        regions: { type: 'RegionMap', props: { shapes: 'http://example.org/a.geojson', key: 'code', values: [{ region: 'a', value: 1 }] } },
        places: { type: 'PlaceMap', props: { places: [{ lat: 95, lon: 2, label: 'Nowhere' }] } }
      }
    })
    expect(result.ok ? [] : result.problems).toEqual([
      expect.stringMatching(/^"regions" \(RegionMap\): shapes: /),
      expect.stringMatching(/^"places" \(PlaceMap\): places\.0\.lat: /)
    ])
  })
})
