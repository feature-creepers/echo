import { z } from 'zod'
import { httpsAddressSchema, serviceSchema } from './services.ts'
import { viewSpecShape } from './views.ts'

/**
 * The user's library: views the assistant composed that the user bookmarked, to keep, sort, pin beside the
 * conversation and have the assistant bring back as they are (docs/SPEC.md, section 9.8), and the widget apps the
 * assistant builds for them (section 9.9). A saved widget is a view: what it plays or shows is its spec, drawn again.
 * An app is a view of one App block, with its code beside it.
 */

export const widgetIdSchema = z.string().min(1).max(64)

/** The longest a widget's title or a collection's name can be, in characters. */
export const WIDGET_TITLE_MAX_LENGTH = 120
export const COLLECTION_MAX_LENGTH = 60

export const widgetTitleSchema = z.string().trim().min(1).max(WIDGET_TITLE_MAX_LENGTH)
export const collectionSchema = z.string().trim().min(1).max(COLLECTION_MAX_LENGTH)

/** The two docks of the main screen, on either side of the conversation, where pinned widgets sit. */
export const DOCK_SIDES = ['left', 'right'] as const
const dockSideSchema = z.enum(DOCK_SIDES)
export type DockSide = z.infer<typeof dockSideSchema>

/** The longest page a widget app may have, in characters. */
export const APP_MAX_LENGTH = 400_000

/**
 * A widget that is an app (docs/SPEC.md, section 9.9): a page of its own, run in a sandbox, that reaches only the
 * public addresses and the services it declares, the services only once the person allowed it.
 */
export const widgetAppSchema = z.object({
  /** Its page: HTML, its scripts and styles written in it. */
  html: z.string().min(1).max(APP_MAX_LENGTH),
  /** The public https addresses it reads with no sign-in, by their start. */
  addresses: z.array(httpsAddressSchema).max(8).default([]),
  /** The services it calls with the person's sign-in. */
  services: z.array(serviceSchema).max(4).default([]),
  /** The APIs of its services the person let it call. */
  allowed: z.array(httpsAddressSchema).max(4).default([]),
  /** Which build of its code this is: the clients say how each build started. */
  built: z.string().min(1).max(64)
})
export type WidgetApp = z.infer<typeof widgetAppSchema>

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
  spec: viewSpecShape,
  /** Its code, when it is an app. */
  app: widgetAppSchema.optional()
})
export type SavedWidget = z.infer<typeof savedWidgetSchema>

/** The dock a pinned widget sits in. */
const sideOf = (widget: Pick<SavedWidget, 'side'>): DockSide => widget.side ?? 'right'

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
