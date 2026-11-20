import { type ViewSpec, validateView } from '@repo/catalog'
import {
  type CommandError,
  type CommandInput,
  DOCK_SIDES,
  type DockSide,
  type Event,
  type LibraryView,
  pinnedBySide,
  type SavedWidget,
  type ShownView,
  savedWidgetSchema,
  viewSpecShape
} from '@repo/protocol'
import { z } from 'zod'
import { foldWord, keywordsOf } from '../memory/searchable.ts'
import { ERASURE, type Records, type StoredRecord } from '../ports/records.ts'
import type { ToolResult } from '../ports/tools.ts'
import type { Tool } from '../tools/tools.ts'
import type { Screen, Showing } from '../views/screen.ts'
import { LIBRARY_INSTRUCTIONS, type LibraryEdit, libraryTools } from './tools.ts'

/**
 * The library (docs/SPEC.md, section 9.8): views the user bookmarked, kept to be sorted, pinned on the main
 * screen in docks and an order of the user's own, and brought back as they are when asked for again.
 *
 * A widget is never changed in place. Each version is a record of type `library.widget` carrying the
 * widget's own identifier and its whole state: a later record with the same identifier replaces it. Deleting
 * is an erasure naming every version, which empties them, so a deleted widget is gone from every device.
 */

/** The type of a widget record: one version of one saved widget. */
export const WIDGET = 'library.widget'

const widgetRecordSchema = savedWidgetSchema.omit({ id: true, at: true }).extend({ widget: z.string().min(1).max(64), spec: viewSpecShape })
type WidgetRecord = z.infer<typeof widgetRecordSchema>

/** A widget as the core holds it: its latest version, and the records of every version. */
interface Kept {
  widget: SavedWidget
  versions: string[]
}

/** How many saved widgets every session is told about by name. Past that, it searches. */
const LISTED = 30
/** How many widgets a search gives back. */
const FOUND = 8

type LibraryChange = { ok: true; library: LibraryView } | { ok: false; error: CommandError }

interface LibraryOptions {
  records: Records
  screen: Screen
  now: () => Date
  /** A new identifier, unique for good, for each new widget. */
  newId: () => string
}

export interface Library {
  read(): LibraryView
  get(widget: string): SavedWidget | undefined
  /** Save a view shown now or earlier. Saving one already saved gives back the widget it became. */
  save(input: CommandInput<'library.save'>): { ok: true; widget: SavedWidget; library: LibraryView } | { ok: false; error: CommandError }
  update(input: CommandInput<'library.update'>): LibraryChange
  /** Put the pinned widgets in docks, each in an order from its top. */
  arrange(input: CommandInput<'library.arrange'>): LibraryChange
  remove(widget: string): LibraryChange
  /** Show a saved widget as it is, where `showing` says. */
  show(widget: string, showing: Showing): ToolResult
  /** The saved widgets that best match what was asked for, best first. */
  search(query: string): SavedWidget[]
  /** The tools a thread finds, shows and keeps widgets with. */
  tools(showing: () => Showing): Tool[]
  /** What sessions are told about the library and its tools. */
  instructions: string
  /** The saved widgets, by name, for a session to know they exist. Nothing while the library is empty. */
  standing(role: 'orchestrator' | 'thread'): string | undefined
  /** Be told `library.changed`. Returns a function that stops the telling. */
  onEvent(listener: (event: Event) => void): () => void
}

const unknown = (widget: string): { ok: false; error: CommandError } => ({
  ok: false,
  error: { code: 'unknown-widget', message: `There is no saved widget "${widget}".` }
})

export function createLibrary({ records, screen, now, newId }: LibraryOptions): Library {
  const listeners = new Set<(event: Event) => void>()
  const kept = new Map<string, Kept>()
  let revision = 0

  const take = (record: StoredRecord) => {
    const read = widgetRecordSchema.safeParse(record.payload)
    if (!read.success) return
    const { widget: id, side, ...rest } = read.data
    // A widget pinned before there were two docks has no side: it stood on the right, and stays there in its order.
    const docked = rest.pinned ? { side: side ?? 'right' } : {}
    const widget: SavedWidget = { id, ...rest, ...docked, at: record.at }
    kept.set(id, { widget, versions: [...(kept.get(id)?.versions ?? []), record.id] })
  }
  for (const record of records.read([WIDGET])) take(record)
  revision = kept.size

  const read = (): LibraryView => ({
    revision,
    widgets: [...kept.values()].map((entry) => entry.widget).sort((one, other) => other.at.localeCompare(one.at))
  })
  const changed = () => {
    revision++
    const library = read()
    for (const listener of listeners) listener({ type: 'event', name: 'library.changed', library })
    return library
  }
  const write = (widget: Omit<SavedWidget, 'at'>) => {
    const { id, ...rest } = widget
    const payload: WidgetRecord = { widget: id, ...rest }
    const [record] = records.append([{ type: WIDGET, payload }])
    if (record) take(record)
    return kept.get(id)?.widget as SavedWidget
  }

  const save: Library['save'] = (input) => {
    const view = screen.find(input.view)
    if (!view) return { ok: false, error: { code: 'unknown-widget', message: `There is no view "${input.view}".` } }
    // A view that is itself a saved widget, or was saved already, is that widget.
    const already = view.widget === undefined ? findFrom(view.id) : kept.get(view.widget)?.widget
    if (already) return { ok: true, widget: already, library: read() }
    const at = now().toISOString()
    const widget = write({
      id: newId(),
      title: input.title ?? view.title,
      ...(input.collection === undefined ? {} : { collection: input.collection }),
      pinned: false,
      since: at,
      from: view.id,
      spec: view.spec
    })
    return { ok: true, widget, library: changed() }
  }

  const findFrom = (view: string) => [...kept.values()].find((entry) => entry.widget.from === view)?.widget

  const update: Library['update'] = (input) => {
    const before = kept.get(input.widget)?.widget
    if (!before) return unknown(input.widget)
    const { at: _at, collection, pinnedAt, side, place, ...rest } = before
    const filed = input.collection === undefined ? collection : (input.collection ?? undefined)
    const pinned = input.pinned ?? before.pinned
    const pinnedSince = pinned ? (before.pinned ? pinnedAt : now().toISOString()) : undefined
    // A widget just pinned goes on top of the dock that holds fewer, the right one when both hold as many, where the
    // user sees it and the two docks stay balanced. Unpinned, it has no dock and no place.
    const docked = pinned ? (before.pinned ? side : emptier()) : undefined
    const placed = docked === undefined ? undefined : before.pinned ? place : top(docked)
    write({
      ...rest,
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(filed === undefined ? {} : { collection: filed }),
      pinned,
      ...(pinnedSince === undefined ? {} : { pinnedAt: pinnedSince }),
      ...(docked === undefined ? {} : { side: docked }),
      ...(placed === undefined ? {} : { place: placed })
    })
    return { ok: true, library: changed() }
  }

  /** The dock holding fewer pinned widgets: the right one when both hold as many. */
  const emptier = (): DockSide => {
    const docks = pinnedBySide(read().widgets)
    return docks.left.length < docks.right.length ? 'left' : 'right'
  }
  /** A place above every pinned widget of a dock. */
  const top = (side: DockSide) => Math.min(0, ...pinnedBySide(read().widgets)[side].map((widget, index) => widget.place ?? index)) - 1

  const arrange: Library['arrange'] = (input) => {
    const docks = pinnedBySide(read().widgets)
    const pinned = new Map([...docks.left, ...docks.right].map((widget) => [widget.id, widget]))
    // A widget named in both lists goes where it is first named, the left one being read first.
    const named = new Set<string>()
    const listed = (ids: readonly string[]) =>
      ids.flatMap((id) => {
        const widget = pinned.get(id)
        if (!widget || named.has(id)) return []
        named.add(id)
        return [widget]
      })
    const order: Record<DockSide, SavedWidget[]> = { left: listed(input.left), right: listed(input.right) }
    for (const side of DOCK_SIDES) order[side].push(...docks[side].filter((widget) => !named.has(widget.id)))
    // Only the widgets whose dock or place changes get a new version.
    let moved = 0
    for (const side of DOCK_SIDES) {
      order[side].forEach((widget, place) => {
        if (widget.side === side && widget.place === place) return
        const { at: _at, ...rest } = widget
        write({ ...rest, side, place })
        moved++
      })
    }
    return { ok: true, library: moved > 0 ? changed() : read() }
  }

  const replace = (id: string, spec: ViewSpec, title?: string) => {
    const before = kept.get(id)?.widget
    if (!before) return
    const { at: _at, ...rest } = before
    write({ ...rest, spec, ...(title === undefined ? {} : { title }) })
    changed()
  }

  const remove: Library['remove'] = (id) => {
    const entry = kept.get(id)
    if (!entry) return unknown(id)
    records.append([{ type: ERASURE, payload: { records: entry.versions } }])
    kept.delete(id)
    return { ok: true, library: changed() }
  }

  const show: Library['show'] = (id, showing) => {
    const widget = kept.get(id)?.widget
    if (!widget) return { ok: false, text: `There is no saved widget "${id}". Search the library for it.` }
    // The catalogue may have changed since it was saved: it is checked again, never trusted as it was.
    const checked = validateView(widget.spec)
    if (!checked.ok) return { ok: false, text: `"${widget.title}" no longer fits the blocks there are. Compose it again:\n- ${checked.problems.join('\n- ')}` }
    return screen.present({ title: widget.title, spec: checked.spec, widget: widget.id }, showing)
  }

  const search: Library['search'] = (query) => {
    const keywords = keywordsOf(query)
    const widgets = read().widgets
    if (keywords.length === 0) return widgets.slice(0, FOUND)
    return widgets
      .map((widget) => ({ widget, score: score(widget, keywords) }))
      .filter((hit) => hit.score > 0)
      .sort((one, other) => other.score - one.score)
      .slice(0, FOUND)
      .map((hit) => hit.widget)
  }

  const library: Library = {
    read,
    get: (id) => kept.get(id)?.widget,
    save,
    update,
    arrange,
    remove,
    show,
    search,
    tools: (showing) =>
      libraryTools({
        search,
        show: (id) => show(id, showing()),
        save(title, collection) {
          const view = screen.latest(showing().thread)
          if (!view) return { ok: false, text: 'Nothing of yours is on screen to save. Show it first.' }
          const saved = save({ view: view.id, ...(title === undefined ? {} : { title }), ...(collection === undefined ? {} : { collection }) })
          return saved.ok ? { ok: true, text: `Saved as "${saved.widget.title}" [${saved.widget.id}].` } : { ok: false, text: saved.error.message }
        },
        update(input: LibraryEdit) {
          if (!kept.has(input.widget)) return { ok: false, text: `There is no saved widget "${input.widget}". Search the library for it.` }
          if (input.view !== undefined) {
            const checked = validateView(input.view)
            if (!checked.ok) return { ok: false, text: `Nothing was changed. Correct the view and call again:\n- ${checked.problems.join('\n- ')}` }
            replace(input.widget, checked.spec, input.title)
          }
          const rest = {
            widget: input.widget,
            ...(input.view === undefined && input.title !== undefined ? { title: input.title } : {}),
            ...(input.collection === undefined ? {} : { collection: input.collection }),
            ...(input.pinned === undefined ? {} : { pinned: input.pinned })
          }
          if (Object.keys(rest).length > 1) update(rest)
          if (input.view === undefined) return { ok: true, text: 'Saved.' }
          // The person asked for the change to see it: the new version is shown at once, where this thread shows things.
          // Shown outside the turn, it starts nothing by itself: changing a radio's words is not asking to hear it.
          const shown = show(input.widget, { ...showing(), turn: undefined })
          return shown.ok ? { ok: true, text: 'Saved as a new version, and shown.' } : { ok: true, text: `Saved as a new version. ${shown.text}` }
        },
        remove(id) {
          const title = kept.get(id)?.widget.title
          return remove(id).ok ? { ok: true, text: `"${title}" is no longer in the library.` } : { ok: false, text: `There is no saved widget "${id}".` }
        }
      }),
    instructions: LIBRARY_INSTRUCTIONS,
    standing(role) {
      const widgets = read().widgets
      if (widgets.length === 0) return undefined
      const listed = widgets
        .slice(0, LISTED)
        .map((widget) => `- [${widget.id}] "${widget.title}"${widget.collection ? ` in ${widget.collection}` : ''}: ${summary(widget.spec)}`)
      const more = widgets.length > LISTED ? `\n…and ${widgets.length - LISTED} more, found with library_search.` : ''
      const lead =
        role === 'orchestrator'
          ? 'The person saved some of your views in their library, to have them again. When they ask for something one of them covers, pass the request to a thread and name the saved widget, so it comes back as it is.'
          : 'The person saved some of your views in their library. When they ask for something one of these covers, show it with library_show rather than composing a new view.'
      return `${lead}\n${listed.join('\n')}${more}`
    },
    onEvent(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }
  }
  return library
}

/** The words of a widget a search finds it by, each with a weight: its title counts most, its content least. */
function score(widget: SavedWidget, keywords: readonly string[]): number {
  const fields: [string, number][] = [
    [widget.title, 4],
    [widget.collection ?? '', 2],
    [textsOf(widget.spec).join(' '), 1]
  ]
  let total = 0
  for (const keyword of keywords) {
    let best = 0
    for (const [text, weight] of fields) {
      const words = (text.match(/[\p{L}\p{N}]+/gu) ?? []).map(foldWord)
      if (words.some((word) => (keyword.length >= 4 ? word.startsWith(keyword) : word === keyword))) best = Math.max(best, weight)
    }
    total += best
  }
  return total
}

/** Every piece of text in a view's properties, addresses included: a stream's address often names its station. */
function textsOf(spec: ShownView['spec']): string[] {
  const texts: string[] = []
  const walk = (value: unknown) => {
    if (typeof value === 'string') texts.push(value)
    else if (Array.isArray(value)) for (const item of value) walk(item)
    else if (typeof value === 'object' && value !== null) for (const item of Object.values(value)) walk(item)
  }
  for (const element of Object.values(spec.elements)) walk(element.props)
  return texts
}

/** A widget in a few words, for a model to tell what it is without seeing it: what it plays, then its first texts. */
export function summary(spec: ShownView['spec']): string {
  const elements = Object.values(spec.elements)
  const media = elements.filter((element) => element.type === 'Media').map((element) => element.props as { title?: string; live?: boolean; kind?: string })
  const plays = media.map((props) => `plays "${props.title}"${props.live ? ' (live)' : ''}`)
  const heading = elements.find((element) => element.type === 'Heading')?.props as { text?: string } | undefined
  const kinds = [...new Set(elements.map((element) => element.type))].filter((type) => !['Stack', 'Row', 'Grid', 'Divider'].includes(type))
  const parts = [...plays, heading?.text ? `"${heading.text}"` : undefined, `${kinds.slice(0, 6).join(', ')}`].filter(Boolean)
  const text = parts.join('; ')
  return text.length > 160 ? `${text.slice(0, 159)}…` : text
}
