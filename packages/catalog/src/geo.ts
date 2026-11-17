/**
 * Reading the GeoJSON a map names, and checking a map's figures against it, so that a model hears what is
 * wrong (a property that does not exist, codes that match no area) instead of the person seeing an empty map.
 */

export type Position = [number, number, ...number[]]
export type Geometry = { type: 'Polygon'; coordinates: Position[][] } | { type: 'MultiPolygon'; coordinates: Position[][][] }
export interface Feature {
  type: 'Feature'
  geometry: Geometry
  properties: Record<string, unknown>
}
export interface Regions {
  type: 'FeatureCollection'
  features: Feature[]
}

/** The most areas a map draws. A file with more is too detailed for an answer. */
export const MAX_REGIONS = 5000

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Coordinates rounded to about ten metres: finer than any screen draws a map, and a third lighter to send. */
const round = (value: number) => Math.round(value * 1e4) / 1e4

const ring = (value: unknown): Position[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const points: Position[] = []
  for (const point of value) {
    if (!Array.isArray(point) || typeof point[0] !== 'number' || typeof point[1] !== 'number') return undefined
    points.push([round(point[0]), round(point[1])])
  }
  return points
}

const polygon = (value: unknown): Position[][] | undefined => {
  if (!Array.isArray(value)) return undefined
  const rings = value.map(ring)
  return rings.every((one) => one !== undefined) ? (rings as Position[][]) : undefined
}

/**
 * The areas of a GeoJSON document: its polygons, with their properties, and nothing else. Points and lines
 * are left out; a single Feature or a bare geometry is read as a collection of one.
 */
export function readRegions(json: unknown): { ok: true; regions: Regions } | { ok: false; problem: string } {
  const features: unknown[] = isObject(json)
    ? json.type === 'FeatureCollection' && Array.isArray(json.features)
      ? json.features
      : json.type === 'Feature'
        ? [json]
        : json.type === 'Polygon' || json.type === 'MultiPolygon'
          ? [{ type: 'Feature', geometry: json, properties: {} }]
          : []
    : []
  if (features.length === 0) {
    return { ok: false, problem: 'it is not a GeoJSON FeatureCollection of areas. If it is TopoJSON or another format, find a GeoJSON version.' }
  }
  const read: Feature[] = []
  for (const feature of features) {
    if (!isObject(feature) || !isObject(feature.geometry)) continue
    const { type, coordinates } = feature.geometry
    const properties = isObject(feature.properties) ? feature.properties : {}
    if (type === 'Polygon') {
      const rings = polygon(coordinates)
      if (rings) read.push({ type: 'Feature', geometry: { type, coordinates: rings }, properties })
    } else if (type === 'MultiPolygon' && Array.isArray(coordinates)) {
      const polygons = coordinates.map(polygon)
      if (polygons.every((one) => one !== undefined)) read.push({ type: 'Feature', geometry: { type, coordinates: polygons as Position[][][] }, properties })
    }
  }
  if (read.length === 0) return { ok: false, problem: 'it holds no areas (no Polygon or MultiPolygon features), so it cannot be coloured.' }
  if (read.length > MAX_REGIONS) return { ok: false, problem: `it holds ${read.length} areas, more than the ${MAX_REGIONS} a map draws. Use a coarser level.` }
  return { ok: true, regions: { type: 'FeatureCollection', features: read } }
}

/** The text of a property, as figures are matched against it. */
export const propertyText = (value: unknown): string | undefined =>
  typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : undefined

const sample = (values: Iterable<string>, count = 6) => [...values].slice(0, count).map((value) => JSON.stringify(value))

export interface JoinCheck {
  /** What must be corrected before the map is shown. */
  problems: string[]
  /** What is worth knowing but does not stop it: areas left without a figure. */
  notes: string[]
}

/**
 * Check that the figures of a map find their areas: the property exists, every region names an area once,
 * and say how many areas are left without a figure.
 */
export function checkJoin(
  regions: Regions,
  map: { key: string; name?: string | undefined; values: readonly { region: string }[]; onlyValued?: boolean | undefined }
): JoinCheck {
  const problems: string[] = []
  const notes: string[] = []
  const properties = new Set(regions.features.flatMap((feature) => Object.keys(feature.properties)))
  const listed = sample(properties, 12).join(', ') || 'none'
  if (!properties.has(map.key)) {
    problems.push(`key: no area of the shapes has a property "${map.key}". Their properties are: ${listed}.`)
    return { problems, notes }
  }
  if (map.name !== undefined && !properties.has(map.name)) problems.push(`name: no area has a property "${map.name}". Their properties are: ${listed}.`)

  const keys = new Set<string>()
  for (const feature of regions.features) {
    const key = propertyText(feature.properties[map.key])
    if (key !== undefined) keys.add(key)
  }
  const seen = new Set<string>()
  const twice = new Set<string>()
  const unknown: string[] = []
  for (const { region } of map.values) {
    const id = region.trim()
    if (seen.has(id)) twice.add(id)
    seen.add(id)
    if (!keys.has(id)) unknown.push(id)
  }
  if (unknown.length > 0) {
    problems.push(
      `values: ${unknown.length} of ${map.values.length} regions match no area's "${map.key}": ${sample(unknown, 10).join(', ')}${unknown.length > 10 ? ', …' : ''}. The areas' "${map.key}" values look like: ${sample(keys, 8).join(', ')}. Match that form, or leave out regions this file does not have.`
    )
  }
  if (twice.size > 0) problems.push(`values: these regions are given more than once: ${sample(twice, 10).join(', ')}. Give each one value.`)
  const empty = [...keys].filter((key) => !seen.has(key))
  if (problems.length === 0 && empty.length > 0 && map.onlyValued !== true) {
    notes.push(`${empty.length} of ${keys.size} areas have no value and are drawn empty${empty.length <= 10 ? `: ${sample(empty, 10).join(', ')}` : ''}.`)
  }
  return { problems, notes }
}
