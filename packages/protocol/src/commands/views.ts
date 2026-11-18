import { z } from 'zod'
import { viewSchema } from '../views.ts'

export const viewCommands = {
  /** Read a file the assistant wrote: its latest version, for a preview or a download. */
  'file.read': {
    input: z.object({ file: z.string().min(1).max(64) }),
    output: z.object({ name: z.string(), mime: z.string(), format: z.enum(['markdown', 'text', 'csv']), version: z.number().int(), text: z.string() })
  },

  /**
   * The areas a map names, read by the core from their https address and kept a while: what a RegionMap or a
   * PlaceMap's outline draws. The client needs no access of its own to the address.
   */
  'shapes.read': {
    input: z.object({
      url: z
        .string()
        .regex(/^https:\/\/\S+$/)
        .max(2048)
    }),
    output: z.object({ shapes: z.unknown() })
  },

  /**
   * The JSON document a block's feed names, read by the core and kept half a minute: what a Metric, a Progress or
   * a Chart's series kept current shows (docs/SPEC.md, section 9.4).
   */
  'feed.read': {
    input: z.object({
      url: z
        .string()
        .regex(/^https:\/\/\S+$/)
        .max(2048)
    }),
    output: z.object({ document: z.unknown() })
  },

  /**
   * Read what the assistant is showing now, if anything: for a client that connects after it was shown. The stream
   * is every view of the conversation still open, newest first, so the main screen opens as it was left.
   */
  'view.read': {
    input: z.object({}),
    output: z.object({ view: viewSchema.optional(), margin: z.array(viewSchema).default([]), stream: z.array(viewSchema).default([]) })
  },

  /**
   * Carry out what a Button of a view does on the computer, pressed by the person: its `act`, at once and with no
   * turn of the conversation (docs/SPEC.md, section 9.5). The steps are a view's, which the catalogue checks
   * (`@repo/catalog`); here they are only given their shape, as a view's properties are. A step that cannot be done
   * comes back as an error in words for the person.
   */
  'view.act': {
    input: z.object({ act: z.array(z.record(z.string(), z.unknown())).min(1).max(12) }),
    output: z.object({})
  },

  /** Remove a view from the screen: the one given, wherever it is in the stream, or, left out, the one on the stage. */
  'view.clear': {
    input: z.object({ view: z.string().min(1).max(64).optional() }),
    output: z.object({})
  }
}
