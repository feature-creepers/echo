import type { ViewSpec } from '@repo/catalog'
import type { ShownView, Thread } from '@repo/protocol'
import { AnimatePresence, motion } from 'motion/react'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { IconButton } from '../primitives/icon-button.tsx'
import { CloseGlyph } from '../primitives/icons.tsx'
import { ViewRenderer } from './view-renderer.tsx'

export interface MarginProps {
  /** Aside cards, newest last. */
  cards: readonly ShownView[]
  /** Topics that finished while another was on the stage. */
  ready: readonly Thread[]
  onFocus(thread: string): void
  onClose(view: string): void
  onSay(text: string): void
}

/** Beside the stage: answers to side questions, and topics whose answer is waiting to be seen. */
export function Margin({ cards, ready, onFocus, onClose, onSay }: MarginProps) {
  return (
    <aside aria-label="Margin" className="scroll-quiet flex w-[22rem] shrink-0 flex-col gap-3 overflow-y-auto py-5 pr-6">
      <AnimatePresence initial={false}>
        {ready.map((thread) => (
          <motion.button
            key={`ready-${thread.id}`}
            type="button"
            layout
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            onClick={() => onFocus(thread.id)}
            className="group flex items-center gap-3 rounded-lg border border-accent/40 bg-surface/90 px-4 py-3 text-left shadow-[0_0_40px_-24px_var(--accent)] backdrop-blur-md transition hover:border-accent"
          >
            <span className="relative flex size-2 shrink-0">
              <span className="absolute inset-0 animate-ping rounded-full bg-accent/60" />
              <span className="relative size-2 rounded-full bg-accent" />
            </span>
            <span className="grid min-w-0 flex-1 gap-0.5">
              <Eyebrow accent>Ready</Eyebrow>
              <span className="truncate text-sm">{thread.title}</span>
            </span>
            <span className="font-mono text-text-faint text-xs transition group-hover:text-text">Show →</span>
          </motion.button>
        ))}
        {[...cards].reverse().map((card) => (
          <motion.article
            key={card.id}
            layout
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24, transition: { duration: 0.2 } }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="grid gap-3 rounded-lg border border-line bg-surface/85 p-4 backdrop-blur-md"
          >
            <header className="-mt-1 -mr-1.5 flex items-center justify-between gap-2">
              <Eyebrow>By the way · {card.title}</Eyebrow>
              <IconButton label="Dismiss" onClick={() => onClose(card.id)}>
                <CloseGlyph />
              </IconButton>
            </header>
            {/* The core checked the view against the catalogue before sending it. */}
            <div className="text-[0.9375rem] [&_h2]:text-xl">
              <ViewRenderer spec={card.spec as ViewSpec} actions={{ say: onSay }} />
            </div>
          </motion.article>
        ))}
      </AnimatePresence>
    </aside>
  )
}
