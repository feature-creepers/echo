import { z } from 'zod'
import { viewSpecShape } from './views.ts'

/**
 * The user's library: views the assistant composed that the user bookmarked, to keep, sort, pin beside the
 * conversation and have the assistant bring back as they are (docs/SPEC.md, section 9.8). A saved widget is a
 * view and nothing more: what it plays or shows is its spec, drawn again.
 */

export const widgetIdSchema = z.string().min(1).max(64)

/** The longest a widget's title or a collection's name can be, in characters. */
export const WIDGET_TITLE_MAX_LENGTH = 120
export const COLLECTION_MAX_LENGTH = 60

export const widgetTitleSchema = z.string().trim().min(1).max(WIDGET_TITLE_MAX_LENGTH)
export const collectionSchema = z.string().trim().min(1).max(COLLECTION_MAX_LENGTH)

/** The two docks of the main screen, on either side of the conversation, where pinned widgets sit. */
export const DOCK_SIDES = ['left', 'right'] as const
export const dockSideSchema = z.enum(DOCK_SIDES)
export type DockSide = z.infer<typeof dockSideSchema>

/** A view the user saved. */
export const savedWidgetSchema = z.object({
  id: widgetIdSchema,
  title: widgetTitleSchema,
  /** The collection the user filed it in. Left out, it is unfiled. */
  collection: collectionSchema.optional(),
  /** Pinned widgets float on the main screen, live, docked on either side of the conversation. */
  pinned: z.boolean(),
  /** When it was last pinned. */
  pinnedAt: z.string().optional(),
  /**
   * The dock a pinned widget sits in. The user moves it by dragging; a widget just pinned goes to the dock that
   * holds fewer. Left out on a pinned widget, the right: before there were two docks, every pinned widget stood there.
   */
  side: dockSideSchema.optional(),
  /**
   * Where a pinned widget sits in its dock, from the top: the lowest first. The user sets it by dragging; a
   * widget just pinned goes on top. Left out, the widget follows those that have one, in the order they were pinned.
   */
  place: z.number().int().optional(),
  /** When it was saved: an ISO 8601 date in UTC. */
  since: z.string(),
  /** When it last changed. */
  at: z.string(),
  /** The view it was saved from, so a client can show that view as saved. */
  from: z.string().min(1).max(64).optional(),
  spec: viewSpecShape
})
export type SavedWidget = z.infer<typeof savedWidgetSchema>

/** The dock a pinned widget sits in. */
export const sideOf = (widget: Pick<SavedWidget, 'side'>): DockSide => widget.side ?? 'right'

/**
 * The pinned widgets of each dock, from its top: by the place the user dragged them to, then, for those with
 * none, in the order they were pinned. The core and every client sort them this one way.
 */
export function pinnedBySide(widgets: readonly SavedWidget[]): Record<DockSide, SavedWidget[]> {
  const place = (widget: SavedWidget) => widget.place ?? Number.POSITIVE_INFINITY
  const pinned = widgets
    .filter((widget) => widget.pinned)
    .sort((one, other) => place(one) - place(other) || (one.pinnedAt ?? '').localeCompare(other.pinnedAt ?? ''))
  return { left: pinned.filter((widget) => sideOf(widget) === 'left'), right: pinned.filter((widget) => sideOf(widget) === 'right') }
}

/** Every pinned widget in one list, as a narrow window shows them: the left dock's from its top, then the right dock's. */
export function pinnedInOrder(widgets: readonly SavedWidget[]): SavedWidget[] {
  const { left, right } = pinnedBySide(widgets)
  return [...left, ...right]
}

/** The whole library, as a client shows it. */
export const libraryViewSchema = z.object({
  /** Goes up with each change, so a client holding two copies keeps the later one. */
  revision: z.number().int().nonnegative(),
  /** Every saved widget, most recently changed first. */
  widgets: z.array(savedWidgetSchema)
})
export type LibraryView = z.infer<typeof libraryViewSchema>
