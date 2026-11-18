import { z } from 'zod'

/** The shortest time between two readings of a feed: a public address is not asked more often than this. */
export const FEED_MIN_SECONDS = 60
/** How long between two readings when the view does not say. */
export const FEED_DEFAULT_SECONDS = 300

const address = z
  .string()
  .regex(/^https:\/\/\S+$/, 'an https address')
  .max(2048)
const every = z.number().int().min(FEED_MIN_SECONDS).max(86_400).optional()

/**
 * A figure kept current from a public JSON address, with no model call: the core reads the address, the renderer
 * takes the figure at `path` (keys and indices joined by dots, such as `0.markets.2.price`), multiplies it by
 * `scale` and rounds it to `decimals`. The figure written in the view is shown until the first reading.
 */
export const feedSchema = z.object({
  url: address,
  path: z.string().min(1).max(300),
  scale: z.number().optional(),
  decimals: z.number().int().min(0).max(6).optional(),
  every
})
export type Feed = z.infer<typeof feedSchema>

/**
 * The points of a Chart's series kept current from a public JSON address: `path` leads to an array, and each of
 * its items gives a point, its label at `x` and its value at `y` (paths within the item).
 */
export const seriesFeedSchema = z.object({
  url: address,
  path: z.string().max(300),
  x: z.string().min(1).max(100),
  y: z.string().min(1).max(100),
  scale: z.number().optional(),
  every
})
export type SeriesFeed = z.infer<typeof seriesFeedSchema>

/** The most points a series fed from an address keeps: the latest ones. */
export const FEED_MAX_POINTS = 120

/**
 * What is at `path` in a document. A step through a string that holds JSON reads that JSON, since many APIs give
 * arrays as encoded text (`"[\"0.23\", \"0.77\"]"`). An empty path is the document itself.
 */
export function valueAt(document: unknown, path: string): unknown {
  let here = document
  for (const step of path.split('.').filter((part) => part.length > 0)) {
    if (typeof here === 'string') {
      try {
        here = JSON.parse(here)
      } catch {
        return undefined
      }
    }
    if (Array.isArray(here)) {
      if (!/^\d+$/.test(step)) return undefined
      here = here[Number(step)]
    } else if (here !== null && typeof here === 'object') {
      here = Object.hasOwn(here, step) ? (here as Record<string, unknown>)[step] : undefined
    } else return undefined
    if (here === undefined) return undefined
  }
  return here
}

const asNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return undefined
}

export type FeedRead<T> = { ok: true; value: T } | { ok: false; problem: string }

/** The figure a feed gives from its document: a number scaled and rounded, or a text as it is. */
export function feedFigure(document: unknown, feed: Pick<Feed, 'path' | 'scale' | 'decimals'>): FeedRead<{ text: string; number?: number }> {
  const found = valueAt(document, feed.path)
  if (found === undefined || found === null) return { ok: false, problem: `nothing is at "${feed.path}"` }
  const number = asNumber(found)
  if (number !== undefined) {
    const scaled = number * (feed.scale ?? 1)
    const rounded = feed.decimals === undefined ? scaled : Number(scaled.toFixed(feed.decimals))
    return { ok: true, value: { text: feed.decimals === undefined ? String(rounded) : rounded.toFixed(feed.decimals), number: rounded } }
  }
  if (typeof found === 'string' || typeof found === 'boolean') return { ok: true, value: { text: String(found) } }
  return { ok: false, problem: `"${feed.path}" holds ${Array.isArray(found) ? 'an array' : 'an object'}, not a figure: go one step further` }
}

/** The points a series feed gives from its document, the latest `FEED_MAX_POINTS` of them. */
export function feedPoints(document: unknown, feed: Pick<SeriesFeed, 'path' | 'x' | 'y' | 'scale'>): FeedRead<{ x: string; y: number }[]> {
  let items = valueAt(document, feed.path)
  if (typeof items === 'string') {
    try {
      items = JSON.parse(items)
    } catch {}
  }
  if (!Array.isArray(items)) return { ok: false, problem: `"${feed.path || '(the document)'}" is not an array` }
  const points: { x: string; y: number }[] = []
  for (const item of items) {
    const label = valueAt(item, feed.x)
    const value = asNumber(valueAt(item, feed.y))
    if (label === undefined || label === null || value === undefined) continue
    points.push({ x: String(label), y: value * (feed.scale ?? 1) })
  }
  if (points.length === 0) return { ok: false, problem: `no item of "${feed.path || '(the document)'}" has a label at "${feed.x}" and a number at "${feed.y}"` }
  return { ok: true, value: points.slice(-FEED_MAX_POINTS) }
}

/** Every feed of a view, by element: what the core checks before a view is shown. */
export function feedsOf(elements: Record<string, { type: string; props?: unknown }>): { id: string; type: string; feed: Feed | SeriesFeed; series?: number }[] {
  const found: { id: string; type: string; feed: Feed | SeriesFeed; series?: number }[] = []
  for (const [id, element] of Object.entries(elements)) {
    const props = (element.props ?? {}) as { feed?: Feed; series?: { feed?: SeriesFeed }[] }
    if (props.feed) found.push({ id, type: element.type, feed: props.feed })
    for (const [index, series] of (element.type === 'Chart' ? (props.series ?? []) : []).entries())
      if (series.feed) found.push({ id, type: element.type, feed: series.feed, series: index })
  }
  return found
}
