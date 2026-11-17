import { validateView } from '@repo/catalog'
import { describe, expect, it } from 'vitest'
import type { Web } from '../ports/web.ts'
import { createMaps } from './maps.ts'

const areas = JSON.stringify({
  type: 'FeatureCollection',
  features: ['01', '02', '2A'].map((code, index) => ({
    type: 'Feature',
    properties: { code, nom: `Area ${code}` },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [index, 0],
          [index + 1, 0],
          [index + 1, 1],
          [index, 0]
        ]
      ]
    }
  }))
})

function fakeWeb(pages: Record<string, string>) {
  const asked: string[] = []
  const web: Web = {
    async read(url) {
      asked.push(url)
      const text = pages[url]
      return text === undefined ? { ok: false, reason: 'the address answered 404 Not Found. Check it, or find another source.' } : { ok: true, text }
    }
  }
  return { web, asked }
}

const spec = (props: Record<string, unknown>) => {
  const checked = validateView({ root: 'map', elements: { map: { type: 'RegionMap', props } } })
  if (!checked.ok) throw new Error(checked.problems.join('\n'))
  return checked.spec
}

describe('the maps of the screen', () => {
  const url = 'https://example.org/areas.geojson'

  it('accepts figures that find their areas, and notes those left empty', async () => {
    const { web } = fakeWeb({ [url]: areas })
    const result = await createMaps(web).check(
      spec({
        shapes: url,
        key: 'code',
        values: [
          { region: '01', value: 1 },
          { region: '02', value: 2 }
        ]
      })
    )
    expect(result).toEqual({ problems: [], notes: ['"map": 1 of 3 areas have no value and are drawn empty: "2A".'] })
  })

  it('says what to correct when the codes do not match', async () => {
    const { web } = fakeWeb({ [url]: areas })
    const { problems } = await createMaps(web).check(spec({ shapes: url, key: 'code', values: [{ region: 1, value: 1 }] }))
    expect(problems).toEqual([expect.stringContaining('"map" (RegionMap): values: 1 of 1 regions match no area\'s "code": "1"')])
  })

  it('says why shapes could not be read', async () => {
    const { web } = fakeWeb({ 'https://example.org/page': '<html>' })
    const maps = createMaps(web)
    expect((await maps.check(spec({ shapes: 'https://example.org/missing', key: 'code', values: [{ region: '01', value: 1 }] }))).problems[0]).toContain('404')
    expect((await maps.check(spec({ shapes: 'https://example.org/page', key: 'code', values: [{ region: '01', value: 1 }] }))).problems[0]).toContain(
      'not JSON'
    )
  })

  it('reads an address once while it is kept, and again after a failure', async () => {
    const { web, asked } = fakeWeb({ [url]: areas })
    const maps = createMaps(web)
    await maps.regions(url)
    await maps.regions(url)
    await maps.regions('https://example.org/missing')
    await maps.regions('https://example.org/missing')
    expect(asked).toEqual([url, 'https://example.org/missing', 'https://example.org/missing'])
  })
})
