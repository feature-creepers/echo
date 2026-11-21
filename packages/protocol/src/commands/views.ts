import { z } from 'zod'

/** An address the core reads for a client: https only. */
const httpsAddress = z
  .string()
  .regex(/^https:\/\/\S+$/)
  .max(2048)

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
    input: z.object({ url: httpsAddress }),
    output: z.object({ shapes: z.unknown() })
  },

  /**
   * The JSON document a block's feed names, read by the core and kept half a minute: what a Metric, a Progress or
   * a Chart's series kept current shows (docs/SPEC.md, section 9.4).
   */
  'feed.read': {
    input: z.object({ url: httpsAddress }),
    output: z.object({ document: z.unknown() })
  },

  /** Remove a card from its answer, for good. */
  'view.clear': {
    input: z.object({ view: z.string().min(1).max(64) }),
    output: z.object({})
  }
}
