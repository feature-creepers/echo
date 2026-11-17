import { z } from 'zod'
import { turnIdSchema } from './conversation.ts'

/**
 * A view as it travels to a client: what the assistant shows for an answer. The core has already checked
 * it against the catalogue (`@repo/catalog`), which knows what each block and its properties mean; here it
 * is only given its shape, so a client built before a block existed can still receive it.
 */
export const viewSpecShape = z.object({
  root: z.string(),
  elements: z.record(z.string(), z.object({ type: z.string(), props: z.record(z.string(), z.unknown()), children: z.array(z.string()) }))
})

export const viewSchema = z.object({
  /** Identifies the view for good. */
  id: z.string().min(1).max(64),
  /** A few words saying what it is about. */
  title: z.string(),
  /** The turn it was shown in. */
  turn: turnIdSchema.optional(),
  /** The thread it belongs to. */
  thread: z.string().min(1).max(64).optional(),
  /** Where it goes: the stage, or the margin for an aside. */
  slot: z.enum(['stage', 'margin']).default('stage'),
  /** The saved widget of the library this view shows again, when it is one. */
  widget: z.string().min(1).max(64).optional(),
  spec: viewSpecShape
})
export type ShownView = z.infer<typeof viewSchema>
