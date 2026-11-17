import type { Thread } from '@repo/protocol'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowGlyph } from '../primitives/icons.tsx'
import { EASE } from '../styles/motion.ts'

export interface ReadyChipsProps {
  /** Topics that finished while another was in focus. */
  ready: readonly Thread[]
  onFocus(thread: string): void
}

/** Topics whose answer is waiting, as small chips under what the assistant is saying: one press brings one back. */
export function ReadyChips({ ready, onFocus }: ReadyChipsProps) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      <AnimatePresence initial={false}>
        {ready.map((thread) => (
          <motion.button
            key={thread.id}
            type="button"
            layout
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.24, ease: EASE }}
            onClick={() => onFocus(thread.id)}
            className="group flex h-7 max-w-full items-center gap-2 rounded-md bg-white/[0.07] pr-2 pl-2.5 shadow-[0_1px_2px_rgb(0_0_0/0.3),inset_0_0_0_0.5px_rgb(255_255_255/0.1)] transition-colors duration-(--duration-quick) hover:bg-white/[0.1]"
          >
            <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
            <span className="font-medium text-[0.6875rem] text-accent">Ready</span>
            <span className="min-w-0 truncate text-[0.8125rem]">{thread.title}</span>
            <span className="text-text-faint transition group-hover:translate-x-0.5 group-hover:text-text [&_svg]:size-3.5">
              <ArrowGlyph />
            </span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  )
}
