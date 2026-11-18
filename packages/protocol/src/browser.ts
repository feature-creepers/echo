import { z } from 'zod'

/**
 * The web browser the assistant drives, as a client shows it (docs/SPEC.md, section 12.1): which one the core
 * found on its computer, and whether its window is open. Whether the assistant may use it is a setting
 * (`access.browser`).
 */
export const browserStateSchema = z.object({
  /** Whether a browser the assistant can drive was found. */
  found: z.boolean(),
  /** Its name, as the person knows it: "Microsoft Edge", "Google Chrome". */
  name: z.string().max(200).optional(),
  /** Where it is installed. */
  path: z.string().max(4096).optional(),
  /** Why none can be used, in words for the person. Left out when one was found. */
  problem: z.string().max(1000).optional(),
  /** Whether its window is open now. */
  running: z.boolean()
})
export type BrowserState = z.infer<typeof browserStateSchema>
