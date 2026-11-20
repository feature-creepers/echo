import { type BlockProps, propertyText, type Regions, readRegions } from '@repo/catalog'
import { geoEqualEarth, geoMercator, geoPath } from 'd3-geo'
import { motion } from 'motion/react'
import { type PointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '../../primitives/cn.ts'
import { Eyebrow } from '../../primitives/eyebrow.tsx'
import { DURATION, EASE } from '../../styles/motion.ts'
import { useViewActions } from '../context.ts'
import { TONE_COLOR } from '../tones.ts'
import { formatValue, frame, inFrame, placeLabels, position, rewoundAll, scaleOf, shade, spansTheWorld, TILE, tilesFor } from './map-geometry.ts'

/** The tallest each map is drawn. A map shorter than this by its shape takes only the height it needs. */
const HEIGHT = { short: 240, normal: 380, tall: 560 } as const

/**
 * A quiet dark street map, served without a key: the app's page sends no referrer, which most tile services
 * require. Its tiles say where they come from, as their terms ask.
 */
const STREETS = (tile: { x: number; y: number; z: number }) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${tile.z}/${tile.y}/${tile.x}`
const STREETS_CREDIT = 'Esri, HERE, Garmin, © OpenStreetMap contributors'

/** Shapes read once per address for the whole app: a map drawn again, or twice, reads nothing new. */
const shapesRead = new Map<string, Promise<Regions>>()

type Loaded = { is: 'loading' } | { is: 'ready'; regions: Regions } | { is: 'failed' }

/** The areas at an address: through the core when the app has one, which read and checked them already; else directly. */
function useShapes(url: string | undefined): Loaded {
  const { readShapes } = useViewActions()
  const [loaded, setLoaded] = useState<Loaded>({ is: 'loading' })
  useEffect(() => {
    if (url === undefined) return
    let reading = shapesRead.get(url)
    if (!reading) {
      reading = (readShapes ? readShapes(url) : fetch(url).then((response) => response.json())).then((json) => {
        const read = readRegions(json)
        if (!read.ok) throw new Error(read.problem)
        return rewoundAll(read.regions)
      })
      shapesRead.set(url, reading)
      reading.catch(() => shapesRead.delete(url))
    }
    let current = true
    setLoaded({ is: 'loading' })
    reading.then(
      (regions) => current && setLoaded({ is: 'ready', regions }),
      () => current && setLoaded({ is: 'failed' })
    )
    return () => {
      current = false
    }
  }, [url, readShapes])
  return loaded
}

/** The width an element is given, kept current as the window changes. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry?.contentRect.width ?? 0)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}

/** What is shown beside the pointer: a name, and its figure or detail. */
interface Pointed {
  x: number
  y: number
  title: string
  detail?: string | undefined
}

function Tooltip({ pointed, width }: { pointed: Pointed | undefined; width: number }) {
  if (!pointed) return null
  const flip = pointed.x > width - 200
  return (
    <div
      className="pointer-events-none absolute z-10 grid max-w-56 gap-0.5 rounded-sm border border-line-strong bg-overlay/95 px-2.5 py-1.5 shadow-lg"
      style={{ left: pointed.x, top: pointed.y, transform: `translate(${flip ? 'calc(-100% - 12px)' : '12px'}, -50%)` }}
    >
      <span className="font-medium text-[0.8125rem] leading-snug">{pointed.title}</span>
      {pointed.detail && <span className="font-mono text-text-soft text-xs tabular-nums">{pointed.detail}</span>}
    </div>
  )
}

/** The frame every map is drawn in, with what it says while its shapes are read or when they cannot be. */
function MapFrame({ loaded, height, children, footer }: { loaded: Loaded | undefined; height: number; children: ReactNode; footer?: ReactNode }) {
  return (
    <figure className="grid min-w-0 gap-2.5">
      <div className="relative overflow-hidden rounded-md border border-line bg-surface/60" style={{ minHeight: loaded?.is === 'ready' ? undefined : height }}>
        {loaded?.is === 'loading' && <div className="absolute inset-0 animate-pulse bg-raised/40" />}
        {loaded?.is === 'failed' && (
          <div className="absolute inset-0 grid place-content-center text-center text-sm text-text-faint">The map's outlines could not be loaded.</div>
        )}
        {children}
      </div>
      {footer}
    </figure>
  )
}

export function RegionMap({ props }: { props: BlockProps<'RegionMap'> }) {
  const loaded = useShapes(props.shapes)
  const { ref, width } = useWidth()
  const [pointed, setPointed] = useState<Pointed & { key: string }>()

  const byRegion = useMemo(() => new Map(props.values.map((entry) => [entry.region.trim(), entry])), [props.values])
  const scale = useMemo(
    () =>
      scaleOf(
        props.values.map((entry) => entry.value),
        props
      ),
    [props]
  )
  const colors = { high: TONE_COLOR[props.tone], low: TONE_COLOR[props.lowTone] }

  const drawn = useMemo(() => {
    if (loaded.is !== 'ready' || width === 0) return undefined
    const regions = props.onlyValued
      ? { ...loaded.regions, features: loaded.regions.features.filter((feature) => byRegion.has(propertyText(feature.properties[props.key]) ?? '')) }
      : loaded.regions
    if (regions.features.length === 0) return undefined
    const projection = spansTheWorld(regions) ? geoEqualEarth() : geoMercator()
    // As wide as the frame, as tall as the areas' shape needs, up to the block's height.
    projection.fitWidth(width - 24, regions as never)
    const natural = geoPath(projection).bounds(regions as never)
    const height = Math.min(HEIGHT[props.height], Math.ceil(natural[1][1] - natural[0][1]) + 24)
    projection.fitExtent(
      [
        [12, 12],
        [width - 12, height - 12]
      ],
      regions as never
    )
    const path = geoPath(projection)
    const areas = regions.features.map((feature, index) => {
      const key = propertyText(feature.properties[props.key]) ?? `#${index}`
      const name = propertyText(feature.properties[props.name ?? '']) ?? byRegion.get(key)?.region ?? key
      return { key, name, d: path(feature as never) ?? '' }
    })
    return { height, areas }
  }, [loaded, width, props.key, props.name, props.height, props.onlyValued, byRegion])

  const describe = (key: string) => {
    const entry = byRegion.get(key)
    return entry ? (entry.label ?? formatValue(entry.value, props.unit)) : 'No figure'
  }
  const point = (event: PointerEvent, area: { key: string; name: string }) => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    setPointed({ key: area.key, x: event.clientX - box.left, y: event.clientY - box.top, title: area.name, detail: describe(area.key) })
  }

  const legend = (
    <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {props.legend && <Eyebrow>{props.legend}</Eyebrow>}
      <div className="flex items-center gap-2 font-mono text-text-soft text-xs tabular-nums">
        <span>{formatValue(scale.domain[0], props.unit)}</span>
        <span
          className="h-2 w-36 rounded-full"
          style={{
            background: `linear-gradient(to right, ${(scale.kind === 'diverging' ? [-1, -0.5, 0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]).map((at) => shade(at, colors)).join(', ')})`
          }}
        />
        <span>{formatValue(scale.domain[1], props.unit)}</span>
        {scale.kind === 'diverging' && <span className="text-text-faint">· centre {formatValue(scale.midpoint, props.unit)}</span>}
      </div>
    </figcaption>
  )

  const hovered = drawn?.areas.find((area) => area.key === pointed?.key)
  return (
    <MapFrame loaded={loaded} height={HEIGHT[props.height]} footer={legend}>
      <div ref={ref} className="relative" onPointerLeave={() => setPointed(undefined)}>
        {drawn && (
          <motion.svg
            width={width}
            height={drawn.height}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: DURATION.slow, ease: EASE }}
            className="block"
            role="img"
            aria-label={props.legend ?? 'Map'}
          >
            <title>{props.legend ?? 'Map'}</title>
            {drawn.areas.map((area) => {
              const entry = byRegion.get(area.key)
              return (
                <path
                  key={area.key}
                  d={area.d}
                  fill={entry ? shade(position(entry.value, scale), colors) : 'var(--color-surface)'}
                  stroke="var(--color-ground)"
                  strokeWidth={0.6}
                  strokeLinejoin="round"
                  onPointerMove={(event) => point(event, area)}
                />
              )
            })}
            {/* The area pointed at, outlined over its neighbours. */}
            {hovered && <path d={hovered.d} fill="none" stroke="var(--color-text)" strokeWidth={1.4} strokeLinejoin="round" pointerEvents="none" />}
          </motion.svg>
        )}
        <Tooltip pointed={pointed} width={width} />
      </div>
    </MapFrame>
  )
}

export function PlaceMap({ props }: { props: BlockProps<'PlaceMap'> }) {
  const loaded = useShapes(props.outline)
  const { ref, width } = useWidth()
  const [pointed, setPointed] = useState<Pointed & { index: number }>()
  const height = HEIGHT[props.height]

  // Over an outline, the places are projected with the areas; on a street map, with the tiles.
  const placed = useMemo(() => {
    if (width === 0) return undefined
    if (props.outline !== undefined) {
      if (loaded.is !== 'ready') return undefined
      const projection = spansTheWorld(loaded.regions) ? geoEqualEarth() : geoMercator()
      const everything = {
        type: 'FeatureCollection',
        features: [
          ...loaded.regions.features,
          { type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates: props.places.map((place) => [place.lon, place.lat]) } }
        ]
      }
      projection.fitExtent(
        [
          [24, 24],
          [width - 24, height - 24]
        ],
        everything as never
      )
      const path = geoPath(projection)
      return {
        outline: loaded.regions.features.map((feature) => path(feature as never) ?? ''),
        points: props.places.map((place) => (projection([place.lon, place.lat]) ?? [0, 0]) as [number, number]),
        tiles: []
      }
    }
    const at = frame(props.places, width, height)
    return { outline: [], points: props.places.map((place) => inFrame(place, at)), tiles: tilesFor(at, width, height) }
  }, [props.outline, props.places, loaded, width, height])

  const labels = useMemo(
    () =>
      placed
        ? placeLabels(
            placed.points,
            props.places.map((place) => place.label)
          )
        : [],
    [placed, props.places]
  )
  const route = placed && props.route ? placed.points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ') : undefined

  return (
    <MapFrame loaded={props.outline === undefined ? undefined : loaded} height={height}>
      <div ref={ref} className="relative overflow-hidden" style={{ height }} onPointerLeave={() => setPointed(undefined)}>
        {placed?.tiles.map((tile) => (
          <img
            key={`${tile.z}/${tile.x}/${tile.y}/${tile.left}`}
            src={STREETS(tile)}
            alt=""
            draggable={false}
            referrerPolicy="no-referrer"
            width={TILE}
            height={TILE}
            onLoad={(event) => event.currentTarget.classList.remove('opacity-0')}
            className="absolute max-w-none opacity-0 brightness-[0.62] transition-opacity duration-(--duration-slow) ease-soft"
            style={{ left: tile.left, top: tile.top }}
          />
        ))}
        {placed && (
          <svg width={width} height={height} className="absolute inset-0" role="img" aria-label={props.places.map((place) => place.label).join(', ')}>
            <title>{props.places.map((place) => place.label).join(', ')}</title>
            {placed.outline.map((d, index) => (
              <path key={index} d={d} fill="var(--color-raised)" stroke="var(--color-line-strong)" strokeWidth={0.6} strokeLinejoin="round" />
            ))}
            {route && (
              <polyline points={route} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" opacity={0.75} />
            )}
            {props.places.map((place, index) => {
              const [x, y] = placed.points[index] ?? [0, 0]
              const active = pointed?.index === index
              return (
                <g
                  key={index}
                  onPointerMove={(event) => {
                    const box = ref.current?.getBoundingClientRect()
                    if (box) setPointed({ index, x: event.clientX - box.left, y: event.clientY - box.top, title: place.label, detail: place.detail })
                  }}
                >
                  <circle cx={x} cy={y} r={14} fill="transparent" />
                  <circle
                    cx={x}
                    cy={y}
                    r={5}
                    fill={TONE_COLOR[place.tone]}
                    stroke="var(--color-ground)"
                    strokeWidth={2}
                    className={cn('origin-center transition-transform duration-(--duration-quick) ease-soft [transform-box:fill-box]', active && 'scale-[1.3]')}
                  />
                  {labels[index] && (
                    <text
                      x={x + (labels[index]?.dx ?? 0)}
                      y={y + (labels[index]?.dy ?? 0)}
                      dy="0.35em"
                      textAnchor={labels[index]?.anchor}
                      className={cn('font-sans text-[11px]', active ? 'fill-text' : 'fill-text-soft')}
                      stroke="var(--color-ground)"
                      strokeWidth={3}
                      paintOrder="stroke"
                      strokeLinejoin="round"
                    >
                      {place.label}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
        )}
        {props.outline === undefined && <span className="pointer-events-none absolute right-2 bottom-1.5 text-[9px] text-text-faint/80">{STREETS_CREDIT}</span>}
        <Tooltip pointed={pointed?.detail || (pointed && !labels[pointed.index]) ? pointed : undefined} width={width} />
      </div>
    </MapFrame>
  )
}
