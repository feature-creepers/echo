import { validateView } from '@repo/catalog'
import { type Event, type ShownView, type TurnId, viewSchema } from '@repo/protocol'
import { z } from 'zod'
import type { Records } from '../ports/records.ts'
import type { ToolResult } from '../ports/tools.ts'

/** The types of the records written when a view is shown and when the screen is cleared. */
export const VIEW_SHOWN = 'view.shown'
export const VIEW_CLEARED = 'view.cleared'

const request = z.object({ title: z.string().trim().min(1).max(120), view: z.unknown() })

export interface ScreenOptions {
  records: Records
  /** A new identifier, unique for good. */
  newId: () => string
  /** The turn under way, which a view shown now belongs to. */
  turn: () => TurnId | undefined
}

/** What the assistant shows: one view at a time, each replacing the last. */
export interface Screen {
  /** What is shown now, if anything. */
  current(): ShownView | undefined
  /** Show what a session asked to show. The answer says "shown", or lists what to correct. */
  show(asked: unknown): ToolResult
  /** Remove what is shown. */
  clear(): void
  /** Be told each time something is shown or cleared. Returns a function that stops the telling. */
  onEvent(listener: (event: Event) => void): () => void
}

/**
 * The screen checks a view against the catalogue before showing it to every client. A view that does not
 * pass is not shown, and the answer lists every problem so it can be written again. Each view shown is
 * recorded, so an earlier one is never lost, and what was on screen is there again after a restart.
 */
export function createScreen({ records, newId, turn }: ScreenOptions): Screen {
  const listeners = new Set<(event: Event) => void>()
  const emit = (event: Event) => {
    for (const listener of listeners) listener(event)
  }

  let shown: ShownView | undefined
  for (const record of records.read([VIEW_SHOWN, VIEW_CLEARED])) {
    if (record.type === VIEW_CLEARED) {
      shown = undefined
      continue
    }
    const view = viewSchema.safeParse(record.payload)
    if (view.success) shown = view.data
  }

  return {
    current: () => shown,

    show(asked) {
      const read = request.safeParse(asked)
      if (!read.success) return { ok: false, text: 'Give a title, in a few words, and a view.' }
      const checked = validateView(read.data.view)
      if (!checked.ok) return { ok: false, text: `The view was not shown. Correct this and show it again:\n- ${checked.problems.join('\n- ')}` }

      const during = turn()
      const view: ShownView =
        during === undefined
          ? { id: newId(), title: read.data.title, spec: checked.spec }
          : { id: newId(), title: read.data.title, turn: during, spec: checked.spec }
      shown = view
      records.append([{ type: VIEW_SHOWN, payload: view }])
      emit({ type: 'event', name: 'view.shown', view })
      return { ok: true, text: 'Shown.' }
    },

    clear() {
      if (!shown) return
      shown = undefined
      records.append([{ type: VIEW_CLEARED, payload: {} }])
      emit({ type: 'event', name: 'view.cleared' })
    },

    onEvent(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }
  }
}
