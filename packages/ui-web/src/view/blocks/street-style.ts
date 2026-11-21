import { color } from '@repo/tokens'
import type { ExpressionSpecification, GeoJSONSourceSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl'
import type { LabelPlace } from './map-geometry.ts'

/**
 * The street map's look: OpenFreeMap's vector tiles of OpenStreetMap, in the OpenMapTiles schema, drawn in the
 * app's own colours. Land is a panel, water the ground beneath it, roads and borders the hairlines between
 * panels, and names the faint text, quieter than the block's own places. Nothing glows, and there are no icons.
 */

/** A colour of the tokens with white washed over it, as a hairline of that opacity looks on it. Opaque, so roads that cross do not add up. */
export function wash(base: string, opacity: number): string {
  const channels = [1, 3, 5].map((at) => Number.parseInt(base.slice(at, at + 2), 16))
  return `#${channels
    .map((channel) =>
      Math.round(channel + (255 - channel) * opacity)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`
}

/** The opacities of the app's two hairlines, `line` and `lineStrong`. */
const LINE = 0.07
const LINE_STRONG = 0.14

const LAND = color.surface

const FONT = ['Noto Sans Regular']

/** The size of the block's labels, in pixels, as it draws them over the map. */
const LABEL_SIZE = 11

/** A place the block draws over the map, and where its label goes: nowhere when it had no room. */
export interface Mark {
  lon: number
  lat: number
  label: string
  side: LabelPlace | undefined
}

const ANCHOR = { start: 'left', end: 'right', middle: 'center' } as const

/** The block's places as the map reads them: a point each, with its label where the block draws it, in ems from the point. */
export function marks(places: readonly Mark[]): GeoJSONSourceSpecification['data'] {
  return {
    type: 'FeatureCollection',
    features: places.map(({ lon, lat, label, side }) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: side ? { label, anchor: ANCHOR[side.anchor], offset: [side.dx / LABEL_SIZE, side.dy / LABEL_SIZE] } : {}
    }))
  }
}

/** A width that grows with the zoom, from one stop to the next. */
const growing = (...stops: number[]): ExpressionSpecification => ['interpolate', ['exponential', 1.4], ['zoom'], ...stops]

/** Only the features drawn as lines, or only those drawn as areas: a layer of the tiles may hold both. */
const shaped = (shape: 'line' | 'area'): ExpressionSpecification => [
  'match',
  ['geometry-type'],
  shape === 'line' ? ['LineString', 'MultiLineString'] : ['Polygon', 'MultiPolygon'],
  true,
  false
]

const road = (id: string, classes: string[], minzoom: number, colour: string, width: ExpressionSpecification): LayerSpecification => ({
  id,
  type: 'line',
  source: 'streets',
  'source-layer': 'transportation',
  minzoom,
  filter: ['all', shaped('line'), ['match', ['get', 'class'], classes, true, false]],
  layout: { 'line-cap': 'round', 'line-join': 'round' },
  paint: { 'line-color': colour, 'line-width': width }
})

/**
 * The street map in the language given (`fr`, `en`), its names in it where the map has them, else in their
 * international form. The block's places are drawn by the block, over the map; they are here too, unseen, so the
 * map's own names make room for them and never sit under a marker or its label.
 */
export function streets(language: string, places: readonly Mark[]): StyleSpecification {
  const name: ExpressionSpecification = ['coalesce', ['get', `name:${language}`], ['get', 'name_int'], ['get', 'name']]
  const label = (id: string, classes: string[], zooms: [number, number], size: number, opacity: number): LayerSpecification => ({
    id,
    type: 'symbol',
    source: 'streets',
    'source-layer': 'place',
    minzoom: zooms[0],
    maxzoom: zooms[1],
    filter: ['match', ['get', 'class'], classes, true, false],
    layout: { 'text-field': name, 'text-font': FONT, 'text-size': size, 'text-max-width': 8 },
    paint: { 'text-color': color.textFaint, 'text-opacity': opacity, 'text-halo-color': LAND, 'text-halo-width': 1.2 }
  })
  return {
    version: 8,
    sources: {
      streets: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
      places: { type: 'geojson', data: marks(places) }
    },
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    layers: [
      { id: 'land', type: 'background', paint: { 'background-color': LAND } },
      {
        id: 'green',
        type: 'fill',
        source: 'streets',
        'source-layer': 'landuse',
        filter: ['==', ['get', 'class'], 'park'],
        paint: { 'fill-color': color.raised }
      },
      {
        id: 'wood',
        type: 'fill',
        source: 'streets',
        'source-layer': 'landcover',
        minzoom: 8,
        filter: ['==', ['get', 'class'], 'wood'],
        paint: { 'fill-color': color.raised }
      },
      {
        id: 'water',
        type: 'fill',
        source: 'streets',
        'source-layer': 'water',
        filter: ['all', shaped('area'), ['!=', ['get', 'brunnel'], 'tunnel']],
        paint: { 'fill-color': color.ground }
      },
      {
        id: 'river',
        type: 'line',
        source: 'streets',
        'source-layer': 'waterway',
        minzoom: 8,
        filter: shaped('line'),
        paint: { 'line-color': color.ground, 'line-width': growing(8, 0.5, 18, 6) }
      },
      {
        id: 'building',
        type: 'fill',
        source: 'streets',
        'source-layer': 'building',
        minzoom: 14,
        paint: { 'fill-color': wash(LAND, 0.035), 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 1] }
      },
      road('rail', ['rail', 'transit'], 11, wash(LAND, LINE), growing(11, 0.5, 18, 2)),
      road('minor road', ['minor', 'service', 'track'], 12, wash(LAND, 0.05), growing(12, 0.5, 18, 8)),
      road('main road', ['primary', 'secondary', 'tertiary', 'trunk'], 7, wash(LAND, LINE), growing(7, 0.4, 12, 1.2, 18, 12)),
      road('motorway', ['motorway'], 5, wash(LAND, LINE_STRONG), growing(5, 0.4, 12, 1.6, 18, 14)),
      {
        id: 'region border',
        type: 'line',
        source: 'streets',
        'source-layer': 'boundary',
        minzoom: 3,
        filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
        layout: { 'line-join': 'round' },
        paint: { 'line-color': wash(LAND, LINE), 'line-width': 0.8, 'line-dasharray': [3, 2] }
      },
      {
        id: 'country border',
        type: 'line',
        source: 'streets',
        'source-layer': 'boundary',
        filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1], ['!', ['has', 'claimed_by']]],
        layout: { 'line-join': 'round' },
        paint: { 'line-color': wash(LAND, LINE_STRONG), 'line-width': growing(2, 0.6, 10, 1.4) }
      },
      {
        id: 'water name',
        type: 'symbol',
        source: 'streets',
        'source-layer': 'water_name',
        filter: shaped('line'),
        layout: { 'symbol-placement': 'line', 'text-field': name, 'text-font': FONT, 'text-size': 10 },
        paint: { 'text-color': color.textFaint, 'text-opacity': 0.7, 'text-halo-color': color.ground, 'text-halo-width': 1 }
      },
      {
        id: 'road name',
        type: 'symbol',
        source: 'streets',
        'source-layer': 'transportation_name',
        minzoom: 14,
        layout: { 'symbol-placement': 'line', 'text-field': name, 'text-font': FONT, 'text-size': 10 },
        paint: { 'text-color': color.textFaint, 'text-opacity': 0.7, 'text-halo-color': LAND, 'text-halo-width': 1.2 }
      },
      label('neighbourhood', ['suburb', 'neighbourhood', 'quarter'], [13, 16], 10, 0.7),
      label('village', ['village', 'hamlet'], [10, 15], 10, 0.7),
      label('town', ['town'], [7, 15], 10.5, 0.85),
      label('city', ['city'], [4, 14], 11.5, 1),
      label('country', ['country'], [1, 7], 11, 1),
      // Placed first, being on top, and always, so the names below give way to them.
      {
        id: 'block markers',
        type: 'symbol',
        source: 'places',
        layout: { 'text-field': 'o', 'text-font': FONT, 'text-size': 14, 'text-allow-overlap': true },
        paint: { 'text-opacity': 0 }
      },
      {
        id: 'block labels',
        type: 'symbol',
        source: 'places',
        filter: ['has', 'label'],
        layout: {
          'text-field': ['get', 'label'],
          'text-font': FONT,
          'text-size': LABEL_SIZE,
          'text-anchor': ['get', 'anchor'],
          'text-offset': ['array', 'number', 2, ['get', 'offset']],
          'text-allow-overlap': true,
          'text-padding': 3
        },
        paint: { 'text-opacity': 0 }
      }
    ]
  }
}
