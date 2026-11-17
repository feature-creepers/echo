import type { ViewSpec } from '@repo/catalog'
import type { ShownView } from '@repo/protocol'
import { AnimatePresence, motion } from 'motion/react'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { IconButton } from '../primitives/icon-button.tsx'
import { CloseGlyph } from '../primitives/icons.tsx'
import { ViewRenderer } from './view-renderer.tsx'

export interface ViewPanelProps {
  view: ShownView
  /** Say something to the assistant, from a button or a choice of the view. */
  onSay(text: string): void
  onClose(): void
}

/** The stage: what the assistant composed for the answer, under its title. A new view slides in over the last. */
export function ViewPanel({ view, onSay, onClose }: ViewPanelProps) {
  return (
    <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-8 pb-6">
      <AnimatePresence mode="wait">
        <motion.article
          key={view.id}
          initial={{ opacity: 0, y: 18, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto grid w-full max-w-5xl gap-5 rounded-xl border border-line bg-surface/50 p-7 shadow-[0_30px_80px_-50px_rgb(0_0_0/0.9)] backdrop-blur-md"
        >
          <header className="-mt-1 flex items-center justify-between gap-4">
            <Eyebrow accent>{view.title}</Eyebrow>
            <IconButton label="Clear the screen" onClick={onClose}>
              <CloseGlyph />
            </IconButton>
          </header>
          {/* The core checked the view against the catalogue before sending it. */}
          <ViewRenderer spec={view.spec as ViewSpec} actions={{ say: onSay }} />
        </motion.article>
      </AnimatePresence>
    </div>
  )
}
