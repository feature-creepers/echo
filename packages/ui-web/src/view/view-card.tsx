import type { ViewSpec } from '@repo/catalog'
import { type ShownView, SNOOZES } from '@repo/protocol'
import { useState } from 'react'
import { SaveControl } from '../library/save-control.tsx'
import { Button } from '../primitives/button.tsx'
import { IconButton } from '../primitives/icon-button.tsx'
import { CloseGlyph } from '../primitives/icons.tsx'
import { Menu } from '../primitives/menu.tsx'
import type { ViewActions } from './context.ts'
import { ViewRenderer } from './view-renderer.tsx'

interface ViewCardProps {
  view: ShownView
  /** What the view's blocks can do: speak to the assistant, read its files, start what they play. */
  actions: ViewActions
  /** The assistant is talking about it: a square of the accent stands before its name. */
  lit: boolean
  onClose(): void
}

/**
 * A view the assistant composed, as one card of an answer: its name as a small label, then the view, bare on the
 * ground. What can be done with it (keep it, snooze its reminder, close it) shows beside its name once it is pointed
 * at or has the keyboard. The answer to a side question says so before its name.
 */
export function ViewCard({ view, actions, lit, onClose }: ViewCardProps) {
  const aside = view.aside === true
  const { snooze } = actions
  return (
    // The stage finds the card by its view, to bring it into sight.
    <div data-view={view.id} className="group/card grid min-w-0 gap-2">
      <header className="flex h-5 min-w-0 items-center gap-2">
        {lit && <span aria-hidden="true" className="size-1.5 shrink-0 bg-accent" />}
        <span className="caps min-w-0 flex-1 truncate text-text-soft">
          {aside && <span className="text-text-faint">By the way · </span>}
          {view.title}
        </span>
        <div className="-my-1 flex shrink-0 items-center opacity-0 transition-opacity duration-(--duration-quick) ease-soft focus-within:opacity-100 group-hover/card:opacity-100 has-[[aria-expanded=true]]:opacity-100 [&_button[aria-label]]:size-6 [&_svg]:size-3.5">
          {view.reminder !== undefined && snooze && <SnoozeControl job={view.reminder} snooze={snooze} onSnoozed={onClose} />}
          <SaveControl view={view} />
          <IconButton label={aside ? 'Dismiss' : 'Close'} onClick={onClose}>
            <CloseGlyph />
          </IconButton>
        </div>
      </header>
      {/* The core checked the view against the catalogue before sending it. */}
      <ViewRenderer spec={view.spec as ViewSpec} actions={actions} />
    </div>
  )
}

/** How a snooze reads in the menu: "10 minutes", "1 hour". */
const snoozeWords = (minutes: number) => (minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? '' : 's'}` : `${minutes} minutes`)

/** Snooze a reminder from its card: it rings again in a while, and its card leaves meanwhile. Says so when it cannot. */
function SnoozeControl({ job, snooze, onSnoozed }: { job: string; snooze(job: string, minutes: number): Promise<void>; onSnoozed(): void }) {
  const [failed, setFailed] = useState(false)
  return (
    <Menu
      label="Snooze"
      header={failed ? <span className="text-danger text-xs">It could not be snoozed.</span> : <span className="caps text-text-faint">Remind me again in</span>}
      trigger={(props, { open }) => (
        <Button kind="quiet" size="sm" className={open ? 'text-text' : 'text-text-soft'} {...props}>
          Snooze
        </Button>
      )}
      items={SNOOZES.map((minutes) => ({
        label: snoozeWords(minutes),
        onSelect: () => {
          setFailed(false)
          snooze(job, minutes).then(onSnoozed, () => setFailed(true))
        }
      }))}
    />
  )
}
