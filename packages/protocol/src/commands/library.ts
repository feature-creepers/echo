import { z } from 'zod'
import { collectionSchema, libraryViewSchema, savedWidgetSchema, widgetIdSchema, widgetTitleSchema } from '../library.ts'
import { httpsAddressSchema } from '../services.ts'

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
   * Put the pinned widgets in these docks, each in this order from its top. Widgets that are not pinned are
   * ignored, and one named twice goes where it is first named; pinned ones left out keep their dock and their
   * order there, after those listed.
   */
  'library.arrange': {
    input: z.object({ left: z.array(widgetIdSchema).max(200), right: z.array(widgetIdSchema).max(200) }),
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
  },

  /** Let a widget app call the services it declares, with the person's sign-in (docs/SPEC.md, section 9.9). */
  'widget.allow': {
    input: z.object({ widget: widgetIdSchema }),
    output: libraryOutput
  },

  /**
   * What a widget app asks of the web: a public address it declares, or the API of a service it is allowed, with the
   * person's sign-in. Answered with what the address answered, or refused with why, in words for its code.
   */
  'widget.call': {
    input: z.object({
      widget: widgetIdSchema,
      url: httpsAddressSchema.max(4000),
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
      headers: z.record(z.string().max(64), z.string().max(2000)).default({}),
      body: z
        .string()
        .max(256 * 1024)
        .optional()
    }),
    output: z.object({ status: z.number().int(), type: z.string().max(200).optional(), body: z.string() })
  },

  /** What a widget app kept: every key it wrote, with its value. */
  'widget.state.read': {
    input: z.object({ widget: widgetIdSchema }),
    output: z.object({ state: z.record(z.string(), z.unknown()) })
  },

  /** Keep a value for a widget app under a key, or with `null` forget it. */
  'widget.state.write': {
    input: z.object({ widget: widgetIdSchema, key: z.string().min(1).max(100), value: z.unknown() }),
    output: z.object({})
  },

  /** Tell the person something from a widget app, with the system's notification: once a minute at most. */
  'widget.notify': {
    input: z.object({ widget: widgetIdSchema, title: z.string().trim().min(1).max(120), body: z.string().max(500).default('') }),
    output: z.object({})
  },

  /** How a build of a widget app started where it is drawn: running, failing with why, or waiting for the person. */
  'widget.report': {
    input: z.object({
      widget: widgetIdSchema,
      built: z.string().min(1).max(64),
      outcome: z.enum(['started', 'failed', 'waiting']),
      message: z.string().max(2000).optional()
    }),
    output: z.object({})
  }
}
