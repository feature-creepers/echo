import { z } from 'zod'
import type { Records } from '../ports/records.ts'
import type { Tool } from '../tools/tools.ts'
import type { Screen, Showing } from '../views/screen.ts'

/**
 * The critical stance's way of objecting (docs/SPEC.md, section 11.4). A thread that has a serious concern
 * does not act: it shows a decision card with the two ways forward and asks aloud. The user decides; when
 * they go ahead despite the concern, the decision is recorded and the concern is not raised again.
 *
 * The card is a view like any other, composed from the generic blocks of the catalogue.
 */

/** The type of the record written when the user decides on a concern. */
export const DECISION = 'decision'

const decisionSchema = z.object({ matter: z.string(), concern: z.string(), chosen: z.enum(['proceed', 'alternative']), at: z.string() })
export type Decision = z.infer<typeof decisionSchema>

const raiseInput = z.object({
  concern: z.string().trim().min(1).max(400),
  alternative: z.string().trim().min(1).max(400),
  severity: z.enum(['notable', 'serious', 'critical']).default('serious'),
  proceed: z.string().trim().max(60).optional(),
  instead: z.string().trim().max(60).optional()
})
const recordInput = z.object({
  matter: z.string().trim().min(1).max(200),
  concern: z.string().trim().min(1).max(400),
  chosen: z.enum(['proceed', 'alternative'])
})

/** How many of the latest decisions every session is told about. */
const REMEMBERED = 20

export interface Objections {
  /** The tools a thread of the critical stance objects with, its card going where `showing` says. */
  tools(showing: () => Showing): Tool[]
  /** The decisions made so far, as sessions are told about them. Nothing when there are none. */
  standing(): string | undefined
}

export function createObjections({ records, screen, now }: { records: Records; screen: Screen; now: () => Date }): Objections {
  const decisions = (): Decision[] =>
    records.read([DECISION]).flatMap((record) => {
      const decision = decisionSchema.safeParse(record.payload)
      return decision.success ? [decision.data] : []
    })

  return {
    tools: (showing) => [
      {
        definition: {
          name: 'raise_concern',
          description:
            'Object before acting, when a competent professional would advise against what is asked and the mistake would be costly or hard to undo. Shows a decision card with the two ways forward. Then ask aloud, in one sentence, which they prefer, and stop: do not act until they answer.',
          inputSchema: {
            type: 'object',
            properties: {
              concern: { type: 'string', description: 'What worries you, in one sentence.' },
              alternative: { type: 'string', description: 'The better way, in one sentence.' },
              severity: { type: 'string', enum: ['notable', 'serious', 'critical'] },
              proceed: { type: 'string', description: 'The label of the button that goes ahead as asked. Short.' },
              instead: { type: 'string', description: 'The label of the button that takes the better way. Short.' }
            },
            required: ['concern', 'alternative']
          }
        },
        run(input) {
          const asked = raiseInput.safeParse(input)
          if (!asked.success) return { ok: false, text: 'raise_concern takes a concern and an alternative, each in one sentence.' }
          const { concern, alternative, severity } = asked.data
          const proceed = asked.data.proceed ?? 'Go ahead anyway'
          const instead = asked.data.instead ?? 'Do it the better way'
          const tone = severity === 'critical' ? 'danger' : 'warn'
          const view = {
            root: 'card',
            elements: {
              card: { type: 'Stack', props: { gap: 'normal' }, children: ['heading', 'badge', 'concern', 'better', 'choice'] },
              heading: { type: 'Heading', props: { text: 'Before I go ahead', level: 2 } },
              badge: {
                type: 'Badge',
                props: { text: severity === 'critical' ? 'Hard to undo' : severity === 'serious' ? 'Worth a second look' : 'A small doubt', tone }
              },
              concern: { type: 'Text', props: { text: concern, size: 'large', weight: 'medium' } },
              better: { type: 'Text', props: { text: alternative, tone: 'soft' } },
              choice: {
                type: 'Choice',
                props: {
                  options: [
                    { label: instead, detail: alternative, say: `Let's do it the better way: ${alternative}` },
                    { label: proceed, detail: 'As you asked, at full quality.', say: 'I am sure. Go ahead as I asked.' }
                  ]
                }
              }
            }
          }
          const shown = screen.show({ title: 'A decision', view }, showing())
          if (!shown.ok) return shown
          return {
            ok: true,
            text: 'The card is shown. Ask aloud, in one sentence, which way they prefer, then stop and wait for their answer. When they decide, call record_decision.'
          }
        }
      },
      {
        definition: {
          name: 'record_decision',
          description: 'Record what the person decided about a concern you raised. When they go ahead despite it, you will not raise it again.',
          inputSchema: {
            type: 'object',
            properties: {
              matter: { type: 'string', description: 'What the decision is about, in a few words.' },
              concern: { type: 'string' },
              chosen: { type: 'string', enum: ['proceed', 'alternative'] }
            },
            required: ['matter', 'concern', 'chosen']
          }
        },
        run(input) {
          const asked = recordInput.safeParse(input)
          if (!asked.success) return { ok: false, text: 'record_decision takes the matter, the concern, and what was chosen: "proceed" or "alternative".' }
          records.append([{ type: DECISION, payload: { ...asked.data, at: now().toISOString() } }])
          return {
            ok: true,
            text:
              asked.data.chosen === 'proceed' ? 'Recorded. Carry it out completely, as asked, with no further warning.' : 'Recorded. Go ahead the better way.'
          }
        }
      }
    ],

    standing() {
      const overridden = decisions()
        .filter((decision) => decision.chosen === 'proceed')
        .slice(-REMEMBERED)
      if (overridden.length === 0) return undefined
      const lines = overridden.map((decision) => `- ${decision.at.slice(0, 10)}: ${decision.matter}. They went ahead despite: ${decision.concern}`)
      return `Decisions the person made despite a concern. Respect them and do not raise these concerns again:\n${lines.join('\n')}`
    }
  }
}
