import type { ViewSpec } from '@repo/catalog'
import type { ShownView } from '@repo/protocol'
import { AnimatePresence, motion } from 'motion/react'
import { SaveControl } from '../library/save-control.tsx'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { IconButton } from '../primitives/icon-button.tsx'
import { CloseGlyph } from '../primitives/icons.tsx'
import type { ViewActions } from './context.ts'
import { ViewRenderer } from './view-renderer.tsx'

export interface ViewPanelProps {
  view: ShownView
  /** What the view's blocks can do: speak to the assistant, read its files, start what they play. */
  actions: ViewActions
  onClose(): void
}

/** The stage: what the assistant composed for the answer, under its title. A new view slides in over the last. */
export function ViewPanel({ view, actions, onClose }: ViewPanelProps) {
  return (
    <AnimatePresence mode="wait">
      <motion.article
        key={view.id}
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="grid w-full min-w-0 gap-5 rounded-xl border border-line bg-surface/50 p-7 shadow-[0_30px_80px_-50px_rgb(0_0_0/0.9)] backdrop-blur-md"
      >
        <header className="-mt-1 -mr-2 flex items-center justify-between gap-4">
          <Eyebrow accent className="min-w-0 truncate">
            {view.title}
          </Eyebrow>
          <div className="flex shrink-0 items-center gap-0.5">
            <SaveControl view={view} />
            <IconButton label="Clear the screen" onClick={onClose}>
              <CloseGlyph />
            </IconButton>
          </div>
        </header>
        {/* The core checked the view against the catalogue before sending it. */}
        <ViewRenderer spec={view.spec as ViewSpec} actions={actions} />
      </motion.article>
    </AnimatePresence>
  )
}
