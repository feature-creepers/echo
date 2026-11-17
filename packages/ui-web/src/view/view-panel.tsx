import type { ViewSpec } from '@repo/catalog'
import type { ShownView } from '@repo/protocol'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { SaveControl } from '../library/save-control.tsx'
import { IconButton } from '../primitives/icon-button.tsx'
import { CloseGlyph } from '../primitives/icons.tsx'
import { DURATION, EASE } from '../styles/motion.ts'
import type { ViewActions } from './context.ts'
import { ViewRenderer } from './view-renderer.tsx'

export interface ViewPanelProps {
  view: ShownView
  /** What the view's blocks can do: speak to the assistant, read its files, start what they play. */
  actions: ViewActions
  onClose(): void
}

/**
 * The stage: what the assistant composed for the answer. A thin bar on top names it and holds its controls,
 * a hairline under it, and the view below. A new view takes the place of the last one.
 */
export function ViewPanel({ view, actions, onClose }: ViewPanelProps) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.article
        key={view.id}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0, transition: { duration: DURATION.slow, ease: EASE } }}
        exit={{ opacity: 0, transition: { duration: DURATION.quick, ease: EASE } }}
        className="grid w-full min-w-0 overflow-hidden rounded-lg bg-surface/90 shadow-[0_0_0_1px_rgb(255_255_255/0.065),inset_0_1px_0_rgb(255_255_255/0.03),0_18px_44px_-26px_rgb(0_0_0/0.9)]"
      >
        <PanelBar title={view.title}>
          <SaveControl view={view} />
          <IconButton label="Clear the screen" onClick={onClose}>
            <CloseGlyph />
          </IconButton>
        </PanelBar>
        <div className="px-5 pt-4 pb-5">
          {/* The core checked the view against the catalogue before sending it. */}
          <ViewRenderer spec={view.spec as ViewSpec} actions={actions} />
        </div>
      </motion.article>
    </AnimatePresence>
  )
}

/** The bar on top of a view, wherever it is shown: its name on the left, what can be done with it on the right. */
export function PanelBar({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <header className="flex h-9 min-w-0 items-center justify-between gap-3 border-white/[0.06] border-b pr-1 pl-4">
      <span className="flex min-w-0 items-baseline gap-2 text-xs">
        {lead && <span className="shrink-0 text-[0.6875rem] text-text-faint">{lead}</span>}
        <span className="truncate font-medium text-text-soft">{title}</span>
      </span>
      <div className="flex shrink-0 items-center">{children}</div>
    </header>
  )
}
