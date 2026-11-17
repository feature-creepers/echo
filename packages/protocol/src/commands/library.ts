import { z } from 'zod'
import { collectionSchema, libraryViewSchema, savedWidgetSchema, widgetIdSchema, widgetTitleSchema } from '../library.ts'

const libraryOutput = z.object({ library: libraryViewSchema })

export const libraryCommands = {
  /** Read the library: every saved widget. */
  'library.read': {
    input: z.object({}),
    output: libraryOutput
  },

  /** Save a view shown now, or shown earlier, to the library. Saving one already saved gives it back as it is. */
  'library.save': {
    input: z.object({ view: z.string().min(1).max(64), title: widgetTitleSchema.optional(), collection: collectionSchema.optional() }),
    output: z.object({ widget: savedWidgetSchema, library: libraryViewSchema })
  },

  /** Rename a widget, file it in a collection (`null` takes it out of any), pin or unpin it. What is left out keeps its value. */
  'library.update': {
    input: z.object({
      widget: widgetIdSchema,
      title: widgetTitleSchema.optional(),
      collection: collectionSchema.nullable().optional(),
      pinned: z.boolean().optional()
    }),
    output: libraryOutput
  },

  /**
   * Put the pinned widgets in this order, from the top of the stack. Widgets that are not pinned are ignored;
   * pinned ones left out keep their order, after those listed.
   */
  'library.arrange': {
    input: z.object({ pinned: z.array(widgetIdSchema).max(200) }),
    output: libraryOutput
  },

  /** Delete a widget: every version of it is erased. */
  'library.delete': {
    input: z.object({ widget: widgetIdSchema }),
    output: libraryOutput
  },

  /** Show a saved widget on the stage, as it was saved. */
  'library.show': {
    input: z.object({ widget: widgetIdSchema }),
    output: z.object({})
  }
}
