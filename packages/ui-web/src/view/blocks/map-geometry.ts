import type { Feature, Regions } from '@repo/catalog'
import { geoArea, geoBounds } from 'd3-geo'

/**
 * The arithmetic of the map blocks, apart from React: winding, colours, number formats and the tiles of a
 * street map. Each part is small and tested on its own.
 */

/**
 * d3 reads a polygon's rings on the sphere: wound one way it is the area inside, the other way everything
 * outside it, which paints the whole map. GeoJSON from the web comes wound both ways, so a polygon that covers
 * more than half the globe is turned round.
 */
export function rewound(feature: Feature): Feature {
  const turn = (rings: Feature['geometry']['coordinates'][number]) => (rings as [number, number][][]).map((ring) => [...ring].reverse())
  const { geometry } = feature
  if (geometry.type === 'Polygon') {
    return geoArea(feature as never) > 2 * Math.PI ? { ...feature, geometry: { type: 'Polygon', coordinates: turn(geometry.coordinates) as never } } : feature
  }
  const polygons = geometry.coordinates.map((polygon) =>
    geoArea({ type: 'Polygon', coordinates: polygon } as never) > 2 * Math.PI ? (turn(polygon as never) as typeof polygon) : polygon
  )
  return { ...feature, geometry: { type: 'MultiPolygon', coordinates: polygons } }
}

export function rewoundAll(regions: Regions): Regions {
  return { type: 'FeatureCollection', features: regions.features.map(rewound) }
}

/** Whether the areas span so much of the globe that a projection made for the whole world draws them better. */
export function spansTheWorld(regions: Regions): boolean {
  const [[west, south], [east, north]] = geoBounds(regions as never)
  const width = east >= west ? east - west : east + 360 - west
  return width > 100 || north - south > 80
}

/** How strongly a colour shows, from the faintest that still reads on the ground to the colour itself. */
const LOWEST = 14

export interface Scale {
  kind: 'sequential' | 'diverging'
  domain: [number, number]
  midpoint: number
}

/** Where a value falls on a scale: 0 to 1 on a sequential one, -1 to 1 around the midpoint on a diverging one. */
export function position(value: number, scale: Scale): number {
  const [low, high] = scale.domain
  if (scale.kind === 'sequential') return high === low ? 1 : Math.min(1, Math.max(0, (value - low) / (high - low)))
  const { midpoint } = scale
  if (value >= midpoint) return high === midpoint ? 0 : Math.min(1, (value - midpoint) / (high - midpoint))
  return low === midpoint ? 0 : -Math.min(1, (midpoint - value) / (midpoint - low))
}

/** A position on a scale as a colour: the tone mixed into the ground, more of it the further out. */
export function shade(at: number, colors: { high: string; low: string }): string {
  const strength = Math.round(LOWEST + (100 - LOWEST) * Math.abs(at))
  return `color-mix(in oklab, ${at < 0 ? colors.low : colors.high} ${strength}%, var(--color-raised))`
}

/** The scale of a map: the domain asked for, or that of its values; diverging around its midpoint, or 0. */
export function scaleOf(
  values: readonly number[],
  asked: { scale: 'sequential' | 'diverging'; domain?: [number, number] | undefined; midpoint?: number | undefined }
): Scale {
  const domain: [number, number] = asked.domain ?? [Math.min(...values), Math.max(...values)]
  const midpoint = asked.midpoint ?? 0
  return { kind: asked.scale, domain: [Math.min(domain[0], domain[1]), Math.max(domain[0], domain[1])], midpoint }
}

/** A figure as it reads on a map: fewer decimals the larger it is, and its unit. */
export function formatValue(value: number, unit: string | undefined, locale?: string): string {
  const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)
  if (!unit) return number
  return unit === '%' ? `${number} %` : /^[^\p{L}]/u.test(unit) ? `${number}${unit}` : `${number} ${unit}`
}

// ------------------------------------------------------------------- the street map

export const TILE = 256

/** A place on the Web Mercator world, in pixels at zoom 0, as street maps draw it. */
export function mercator(lon: number, lat: number): [number, number] {
  const clamped = Math.max(-85.0511, Math.min(85.0511, lat))
  const sin = Math.sin((clamped * Math.PI) / 180)
  return [((lon + 180) / 360) * TILE, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * TILE]
}

export interface Frame {
  zoom: number
  /** The top left corner of the frame, in pixels of the world at that zoom. */
  left: number
  top: number
}

/** The closest zoom at which every place fits the frame, its margins kept, centred on them. One place gets a street-level view. */
export function frame(places: readonly { lat: number; lon: number }[], width: number, height: number, margin = 48): Frame {
  const points = places.map((place) => mercator(place.lon, place.lat))
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const spanX = maxX - minX
  const spanY = maxY - minY
  let zoom = 13
  if (spanX > 0 || spanY > 0) {
    const fit = Math.min((width - 2 * margin) / Math.max(spanX, 1e-9), (height - 2 * margin) / Math.max(spanY, 1e-9))
    zoom = Math.max(1, Math.min(15, Math.floor(Math.log2(fit))))
  }
  const scale = 2 ** zoom
  return { zoom, left: ((minX + maxX) / 2) * scale - width / 2, top: ((minY + maxY) / 2) * scale - height / 2 }
}

/** Where a place is drawn in a frame, in pixels from its top left corner. */
export function inFrame(place: { lat: number; lon: number }, at: Frame): [number, number] {
  const [x, y] = mercator(place.lon, place.lat)
  const scale = 2 ** at.zoom
  return [x * scale - at.left, y * scale - at.top]
}

/** The tiles that cover a frame, each with where it is drawn. Columns wrap round the globe; rows stop at its poles. */
export function tilesFor(at: Frame, width: number, height: number): { x: number; y: number; z: number; left: number; top: number }[] {
  const count = 2 ** at.zoom
  const tiles = []
  for (let row = Math.floor(at.top / TILE); row <= Math.floor((at.top + height) / TILE); row++) {
    if (row < 0 || row >= count) continue
    for (let column = Math.floor(at.left / TILE); column <= Math.floor((at.left + width) / TILE); column++) {
      tiles.push({ x: ((column % count) + count) % count, y: row, z: at.zoom, left: column * TILE - at.left, top: row * TILE - at.top })
    }
  }
  return tiles
}

/** Where a marker's label goes: beside it on the right or the left, above or below, or nowhere. */
export interface LabelPlace {
  dx: number
  dy: number
  anchor: 'start' | 'end' | 'middle'
}

/**
 * Labels that do not cover one another. Each place, in the order given (the most important first), takes the
 * first side of its marker where its label is clear of those already placed; a label with no room is left out,
 * and its place shows its name when pointed at.
 */
export function placeLabels(points: readonly [number, number][], texts: readonly string[], size = 11): (LabelPlace | undefined)[] {
  const taken: { left: number; top: number; right: number; bottom: number }[] = points.map(([x, y]) => ({
    left: x - 6,
    top: y - 6,
    right: x + 6,
    bottom: y + 6
  }))
  const sides: LabelPlace[] = [
    { dx: 9, dy: 0, anchor: 'start' },
    { dx: -9, dy: 0, anchor: 'end' },
    { dx: 0, dy: -13, anchor: 'middle' },
    { dx: 0, dy: 13, anchor: 'middle' }
  ]
  return points.map(([x, y], index) => {
    const width = (texts[index] ?? '').length * size * 0.56
    const half = size * 0.65
    for (const side of sides) {
      const left = side.anchor === 'start' ? x + side.dx : side.anchor === 'end' ? x + side.dx - width : x - width / 2
      const box = { left, top: y + side.dy - half, right: left + width, bottom: y + side.dy + half }
      const clear = taken.every(
        (other, at) => at === index || box.right <= other.left || box.left >= other.right || box.bottom <= other.top || box.top >= other.bottom
      )
      if (clear) {
        taken.push(box)
        return side
      }
    }
    return undefined
  })
}
