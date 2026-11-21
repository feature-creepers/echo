import { z } from 'zod'
import type { Block } from '../block.ts'

/**
 * A widget app, drawn live where a view goes (docs/SPEC.md, section 9.9). Its code is the library's, beside the
 * widget: the block only names it, so a view stays a description and never carries code.
 */
export const appBlocks = {
  App: {
    description: 'A widget app of the library, live, by its id. Show a saved one with library_show; build one with widget_build.',
    props: z.object({ widget: z.string().min(1).max(64) }),
    children: false
  }
} satisfies Record<string, Block>
