import { AnimatePresence, motion } from 'motion/react'
import { ChevronGlyph } from '../primitives/icons.tsx'
import { settle } from '../styles/motion.ts'
import type { FollowLatest } from './follow-latest.ts'

/**
 * The way back to the end of a log read from its end, floating quietly at the bottom of its box while the person
 * has scrolled away from it. Put it in a box laid over the scroll area's bottom edge.
 */
export function LatestButton({ scroll }: { scroll: FollowLatest }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
      <AnimatePresence>
        {scroll.away && (
          <motion.button
            type="button"
            onClick={scroll.toLatest}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={settle}
            className="material shadow-float pointer-events-auto flex items-center gap-1 py-1 pr-2.5 pl-2 text-label text-text-soft transition-colors hover:text-text"
          >
            <ChevronGlyph /> Latest
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}
