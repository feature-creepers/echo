import { z } from 'zod'
import type { Block } from '../block.ts'

/**
 * Blocks the user can act on. Each ends in something the user says to the assistant: pressing a button or answering
 * questions is a turn of the conversation, in the words given in `say` or made of the answers.
 */
export const inputBlocks = {
  Button: {
    description: 'Something the user can press. `say` is what pressing it tells you, as if the user had said it: write it in the first person.',
    props: z.object({
      label: z.string(),
      say: z.string(),
      emphasis: z.enum(['primary', 'secondary']).default('secondary')
    }),
    children: false
  },
  Questions: {
    description:
      "How you ask anything that decides what you do next: which way, which option, whether to go ahead. One to four questions of two to six answers, the one you advise first and `recommended`, what each costs in `detail`. A typed answer is offered too, unless `other` is false. The person's answers come back to you as their words: each question, then its answers.",
    props: z.object({
      questions: z
        .array(
          z.object({
            question: z.string().optional(),
            multiple: z.boolean().default(false),
            options: z
              .array(z.object({ label: z.string(), detail: z.string().optional(), recommended: z.boolean().default(false), say: z.string().optional() }))
              .min(2)
              .max(6),
            other: z.boolean().default(true)
          })
        )
        .min(1)
        .max(4)
    }),
    children: false,
    check: (props) => {
      const questions = props.questions as { question?: string }[]
      return questions.length > 1 && questions.some((one) => !one.question) ? 'With several questions, give each its `question`.' : undefined
    }
  },
  FilePreview: {
    description: 'A document you wrote with file_write, shown to read, with a button to download it. Use it whenever you wrote one; say aloud only what it is.',
    props: z.object({ file: z.string(), height: z.enum(['short', 'normal', 'tall']).default('normal') }),
    children: false
  },
  Field: {
    description: 'A line the user types an answer into. What they type is said to you after `say`, which introduces it: "My postcode is".',
    props: z.object({ label: z.string(), placeholder: z.string().optional(), say: z.string() }),
    children: false
  }
} satisfies Record<string, Block>
