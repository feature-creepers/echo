import { describe, expect, it } from 'vitest'
import { marks, wash } from './street-style.ts'

describe('wash', () => {
  it('lays white over a colour at an opacity, as one opaque colour', () => {
    const cases = [
      { base: '#0a0d12', opacity: 0, washed: '#0a0d12' },
      { base: '#000000', opacity: 1, washed: '#ffffff' },
      { base: '#000000', opacity: 0.5, washed: '#808080' },
      { base: '#0a0d12', opacity: 0.07, washed: '#1b1e23' }
    ]
    for (const { base, opacity, washed } of cases) expect(wash(base, opacity)).toBe(washed)
  })
})

describe('marks', () => {
  it("tells the map where the block draws each label, so the map's names keep clear of it", () => {
    const cases = [
      { side: { dx: 9, dy: 0, anchor: 'start' as const }, properties: { label: 'Lyon', anchor: 'left', offset: [9 / 11, 0] } },
      { side: { dx: -9, dy: 0, anchor: 'end' as const }, properties: { label: 'Lyon', anchor: 'right', offset: [-9 / 11, 0] } },
      { side: { dx: 0, dy: -13, anchor: 'middle' as const }, properties: { label: 'Lyon', anchor: 'center', offset: [0, -13 / 11] } },
      { side: undefined, properties: {} }
    ]
    for (const { side, properties } of cases) {
      expect(marks([{ lon: 4.8357, lat: 45.764, label: 'Lyon', side }])).toEqual({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [4.8357, 45.764] }, properties }]
      })
    }
  })
})
