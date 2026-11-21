import type { ViewSpec } from '@repo/catalog'
import { type ShownView, SNOOZES } from '@repo/protocol'
import { type ReactNode, useState } from 'react'
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
  onClose(): void
}

/**
 * A view the assistant composed, as a card of the board: a thin bar on top names it and holds its controls, a
 * hairline under it, and the view below. The answer to a side question says so before its title; a reminder's card
 * can be snoozed from its bar.
 */
export function ViewCard({ view, actions, onClose }: ViewCardProps) {
  const aside = view.aside === true
  const { snooze } = actions
  return (
    <article className="grid w-full min-w-0 overflow-hidden bg-surface/90 shadow-[0_0_0_1px_rgb(235_230_218/0.065),inset_0_1px_0_rgb(235_230_218/0.03),0_18px_44px_-26px_rgb(0_0_0/0.9)]">
      <PanelBar lead={aside ? 'By the way' : undefined} title={view.title}>
        {view.reminder !== undefined && snooze && <SnoozeControl job={view.reminder} snooze={snooze} onSnoozed={onClose} />}
        <SaveControl view={view} />
        <IconButton label={aside ? 'Dismiss' : 'Close'} onClick={onClose}>
          <CloseGlyph />
        </IconButton>
      </PanelBar>
      <div className="p-3">
        {/* The core checked the view against the catalogue before sending it. */}
        <ViewRenderer spec={view.spec as ViewSpec} actions={actions} />
      </div>
    </article>
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
      header={
        failed ? <span className="text-danger text-xs">It could not be snoozed.</span> : <span className="text-label text-text-faint">Remind me again in</span>
      }
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

/** The bar on top of a view: its name on the left, what can be done with it on the right, its glyphs small. */
function PanelBar({ title, lead, children }: { title: string; lead?: string | undefined; children: ReactNode }) {
  return (
    <header className="flex h-7 min-w-0 items-center justify-between gap-3 border-line border-b pr-0.5 pl-3">
      <span className="flex min-w-0 items-baseline gap-2 text-xs">
        {lead && <span className="shrink-0 text-[0.6875rem] text-text-faint">{lead}</span>}
        <span className="truncate font-medium text-text-soft">{title}</span>
      </span>
      <div className="flex shrink-0 items-center [&_button[aria-label]]:size-6 [&_svg]:size-3.5">{children}</div>
    </header>
  )
}
