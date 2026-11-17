import { z } from 'zod'
import type { Block } from '../block.ts'

/**
 * Blocks the user can act on. Each ends in something the user says to the assistant: pressing a button or
 * picking an option is a turn of the conversation, in the words given in `say`.
 */
export const inputBlocks = {
  Button: {
    description: 'Something the user can press. `say` is what pressing it tells you, as if the user had said it: write it in the first person.',
    props: z.object({ label: z.string(), say: z.string(), emphasis: z.enum(['primary', 'secondary']).default('secondary') }),
    children: false
  },
  Choice: {
    description: 'A question with a few answers to pick from. Picking one tells you its `say`, as if the user had said it.',
    props: z.object({
      question: z.string().optional(),
      options: z
        .array(z.object({ label: z.string(), detail: z.string().optional(), say: z.string() }))
        .min(2)
        .max(8)
    }),
    children: false
  },
  Field: {
    description: 'A line the user types an answer into. What they type is said to you after `say`, which introduces it: "My postcode is".',
    props: z.object({ label: z.string(), placeholder: z.string().optional(), say: z.string() }),
    children: false
  }
} satisfies Record<string, Block>
