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

/** A view the user saved. */
export const savedWidgetSchema = z.object({
  id: widgetIdSchema,
  title: widgetTitleSchema,
  /** The collection the user filed it in. Left out, it is unfiled. */
  collection: collectionSchema.optional(),
  /** Pinned widgets are shown in the side sheet, beside the conversation. */
  pinned: z.boolean(),
  /** When it was last pinned, to keep pinned widgets in the order they were pinned. */
  pinnedAt: z.string().optional(),
  /** When it was saved: an ISO 8601 date in UTC. */
  since: z.string(),
  /** When it last changed. */
  at: z.string(),
  /** The view it was saved from, so a client can show that view as saved. */
  from: z.string().min(1).max(64).optional(),
  spec: viewSpecShape
})
export type SavedWidget = z.infer<typeof savedWidgetSchema>

/** The whole library, as a client shows it. */
export const libraryViewSchema = z.object({
  /** Goes up with each change, so a client holding two copies keeps the later one. */
  revision: z.number().int().nonnegative(),
  /** Every saved widget, most recently changed first. */
  widgets: z.array(savedWidgetSchema)
})
export type LibraryView = z.infer<typeof libraryViewSchema>
