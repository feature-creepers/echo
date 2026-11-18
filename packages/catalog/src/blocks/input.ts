import { z } from 'zod'
import { actSchema } from '../act.ts'
import type { Block } from '../block.ts'

/**
 * Blocks the user can act on. Most end in something the user says to the assistant: pressing a button or picking
 * an option is a turn of the conversation, in the words given in `say`. A Button may instead act on the computer
 * itself (`act`), at once and with no turn, so a widget the person keeps drives an app or the sound without asking
 * anyone (docs/SPEC.md, section 9.5).
 */
export const inputBlocks = {
  Button: {
    description:
      "Something the user can press. Give `say` or `act`. `say` is what pressing it tells you, as if the user had said it: write it in the first person. `act` is done on the computer at once, with no call to you, for controls kept on a widget: `key` presses a system key (media keys drive the app that plays, volume keys the sound); `open` opens a link in its app (spotify:playlist:<id>); `click` presses an element of an allowed app's window by the name desktop_look shows, waiting up to `within` seconds. Steps run in order.",
    props: z.object({
      label: z.string(),
      say: z.string().optional(),
      act: actSchema.optional(),
      emphasis: z.enum(['primary', 'secondary']).default('secondary')
    }),
    children: false,
    check: (props) => ((props.say === undefined) === (props.act === undefined) ? 'Give the button `say` or `act`, one of the two.' : undefined)
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
