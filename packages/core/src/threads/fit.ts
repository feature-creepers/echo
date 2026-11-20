import type { Exchange, ShownView, Step } from '@repo/protocol'
import { cutText } from '../text.ts'

/**
 * How long a text of a step's preview stays whole: the sheet lists calls folded, by what each was about, and reads
 * one whole only when it is opened.
 */
export const STEP_PREVIEW_TEXT = 300

/** How many items of a list a step's preview keeps: the files a change named, the options a page was given. */
const STEP_PREVIEW_ITEMS = 20

/** How long a text of a step read whole stays whole, at first: shorter only if the step would not fit one message. */
const STEP_WHOLE_TEXT = 200_000

/**
 * The most a page of a thread, or one step read whole, may weigh, in characters of JSON. Well under the line a
 * client accepts (`MAX_LINE_LENGTH`), so the envelope and the thread around it always fit too.
 */
export const THREAD_READ_BUDGET = 600_000

/** A view as the sheet names it, under the request that showed it. */
export type ViewTitle = Pick<ShownView, 'id' | 'title' | 'turn'>

/** A page of a thread, as the sheet reads it. */
export interface ThreadPage {
  exchanges: Exchange[]
  steps: Step[]
  views: ViewTitle[]
  /** How many requests come before the page. */
  earlier: number
  /** How many of the first request's calls are left out, when it alone is too long for a page. */
  earlierSteps: number
}

/** Cut every long text inside what a tool was given, keeping its shape, so a command or a path is still read from it. */
export function cutInput(input: unknown, most: number): unknown {
  if (typeof input === 'string') return cutText(input, most)
  if (Array.isArray(input)) return input.map((item) => cutInput(item, most))
  if (typeof input === 'object' && input !== null) {
    return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, cutInput(value, most)]))
  }
  return input
}

/**
 * What a tool was given, as a folded row needs it: its plain fields, which say what the call was about (a path, a
 * command's start, a query, a title), and the first items of its lists of texts. What is nested deeper, such as a
 * view's elements, is left for the step read whole.
 */
export function previewInput(input: unknown): unknown {
  const plain = (value: unknown) => typeof value === 'number' || typeof value === 'boolean' || value === null
  if (typeof input === 'string') return cutText(input, STEP_PREVIEW_TEXT)
  if (plain(input)) return input
  if (Array.isArray(input)) return previewList(input)
  if (typeof input !== 'object' || input === null) return undefined
  const kept: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') kept[key] = cutText(value, STEP_PREVIEW_TEXT)
    else if (plain(value)) kept[key] = value
    else if (Array.isArray(value)) kept[key] = previewList(value)
  }
  return kept
}

const previewList = (list: readonly unknown[]): string[] =>
  list
    .filter((item): item is string => typeof item === 'string')
    .slice(0, STEP_PREVIEW_ITEMS)
    .map((item) => cutText(item, STEP_PREVIEW_TEXT))

/** A step as a folded row of the sheet shows it: what it was given, previewed, and the start of what it gave back. */
export function stepPreview(step: Step): Step {
  const shown: Step = { ...step }
  if (step.input !== undefined) shown.input = previewInput(step.input)
  if (step.output !== undefined) shown.output = cutText(step.output, STEP_PREVIEW_TEXT)
  return shown
}

/**
 * A step read whole, as the sheet opens it: whole as recorded, unless what it was given is so long, a file written
 * whole for instance, that it would not fit one message. Its texts are then cut, shorter and shorter until it fits.
 */
export function stepWhole(step: Step): Step {
  const weight = (one: Step) => JSON.stringify(one).length
  if (weight(step) <= THREAD_READ_BUDGET) return step
  let most = STEP_WHOLE_TEXT
  for (;;) {
    const cut: Step = { ...step }
    if (step.input !== undefined) cut.input = cutInput(step.input, most)
    if (step.output !== undefined) cut.output = cutText(step.output, most)
    if (weight(cut) <= THREAD_READ_BUDGET || most <= STEP_PREVIEW_TEXT) return cut
    most = Math.floor(most / 2)
  }
}

/**
 * A page of a thread for the sheet. A long piece of project work makes hundreds of requests and thousands of tool
 * calls, more than one message carries: the sheet reads the latest requests first, as many as fit the budget with
 * their calls previewed and their views named, and the earlier ones a page at a time as the person scrolls up.
 * `before` is the request the page ends before; left out, the page ends with the latest. A request too heavy to
 * fit alone keeps its latest calls, the number left out said. Calls and views of no request on the page are not
 * shown by the sheet, and are not sent.
 */
export function fitThread(
  exchanges: readonly Exchange[],
  steps: readonly Step[],
  views: readonly ShownView[],
  before?: string,
  budget = THREAD_READ_BUDGET
): ThreadPage {
  const end = before === undefined ? exchanges.length : exchanges.findIndex((exchange) => exchange.turn === before)
  // A request that is no longer there, forgotten since, has nothing known before it.
  if (end < 0) return { exchanges: [], steps: [], views: [], earlier: 0, earlierSteps: 0 }

  const stepsOf = new Map<string, Step[]>()
  for (const step of steps) stepsOf.set(step.turn, [...(stepsOf.get(step.turn) ?? []), step])
  const viewsOf = new Map<string, ViewTitle[]>()
  for (const view of views) {
    if (view.turn === undefined) continue
    viewsOf.set(view.turn, [...(viewsOf.get(view.turn) ?? []), { id: view.id, title: view.title, turn: view.turn }])
  }

  const page: ThreadPage = { exchanges: [], steps: [], views: [], earlier: 0, earlierSteps: 0 }
  // The page's own frame, its counts written out at their longest; each item below counts the comma before it.
  let used = JSON.stringify({ ...page, earlier: Number.MAX_SAFE_INTEGER, earlierSteps: Number.MAX_SAFE_INTEGER }).length
  let start = end
  while (start > 0) {
    const exchange = exchanges[start - 1] as Exchange
    const previews = (stepsOf.get(exchange.turn) ?? []).map(stepPreview)
    const named = viewsOf.get(exchange.turn) ?? []
    const weights = previews.map((step) => JSON.stringify(step).length + 1)
    const own = JSON.stringify(exchange).length + 1 + JSON.stringify(named).length
    const weight = own + weights.reduce((sum, one) => sum + one, 0)
    if (used + weight > budget) {
      if (page.exchanges.length > 0) break
      // Alone too heavy for a page: its latest calls are kept, as many as fit beside it.
      let room = budget - used - own
      let first = previews.length
      while (first > 0 && room - (weights[first - 1] as number) >= 0) {
        first -= 1
        room -= weights[first] as number
      }
      page.exchanges.unshift(exchange)
      page.steps.unshift(...previews.slice(first))
      page.views.unshift(...named)
      page.earlierSteps = first
      start -= 1
      break
    }
    used += weight
    page.exchanges.unshift(exchange)
    page.steps.unshift(...previews)
    page.views.unshift(...named)
    start -= 1
  }
  page.earlier = start
  return page
}
