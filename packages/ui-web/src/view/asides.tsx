import type { ViewSpec } from '@repo/catalog'
import type { ShownView, Thread } from '@repo/protocol'
import { AnimatePresence, motion } from 'motion/react'
import { SaveControl } from '../library/save-control.tsx'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { IconButton } from '../primitives/icon-button.tsx'
import { ArrowGlyph, CloseGlyph } from '../primitives/icons.tsx'
import type { ViewActions } from './context.ts'
import { ViewRenderer } from './view-renderer.tsx'

export interface AsidesProps {
  /** Answers to side questions, newest last. */
  cards: readonly ShownView[]
  /** Topics that finished while another was on the stage. */
  ready: readonly Thread[]
  onFocus(thread: string): void
  onClose(view: string): void
  /** What the blocks of a card can do. */
  actions(view: ShownView): ViewActions
}

/**
 * What comes up beside the topic without replacing it, in the same column so nothing moves off centre: topics
 * whose answer is waiting, as chips, and answers to side questions, as compact cards over the view.
 */
export function Asides({ cards, ready, onFocus, onClose, actions }: AsidesProps) {
  return (
    <div className="grid w-full min-w-0 gap-3">
      {ready.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2">
          <AnimatePresence initial={false}>
            {ready.map((thread) => (
              <motion.button
                key={thread.id}
                type="button"
                layout
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                onClick={() => onFocus(thread.id)}
                className="group flex h-8 max-w-full items-center gap-2.5 rounded-full border border-accent/40 bg-surface/85 pr-2.5 pl-3 shadow-[0_0_30px_-16px_var(--accent)] backdrop-blur-md transition hover:border-accent"
              >
                <span className="relative flex size-1.5 shrink-0">
                  <span className="absolute inset-0 animate-ping rounded-full bg-accent/60" />
                  <span className="relative size-1.5 rounded-full bg-accent" />
                </span>
                <span className="font-mono text-accent text-label uppercase">Ready</span>
                <span className="min-w-0 truncate text-sm">{thread.title}</span>
                <span className="text-text-faint transition group-hover:translate-x-0.5 group-hover:text-text [&_svg]:size-3.5">
                  <ArrowGlyph />
                </span>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      )}
      {cards.length > 0 && (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,20rem),1fr))]">
          <AnimatePresence initial={false}>
            {[...cards].reverse().map((card) => (
              <motion.article
                key={card.id}
                layout
                initial={{ opacity: 0, y: -10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.18 } }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="grid min-w-0 content-start gap-3 rounded-lg border border-line-strong bg-surface/85 p-4 shadow-[0_24px_60px_-40px_rgb(0_0_0/0.9)] backdrop-blur-md"
              >
                <header className="-mt-1 -mr-1.5 flex items-center justify-between gap-2">
                  <Eyebrow className="min-w-0 truncate">
                    By the way · <span className="text-text-soft">{card.title}</span>
                  </Eyebrow>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <SaveControl view={card} />
                    <IconButton label="Dismiss" onClick={() => onClose(card.id)}>
                      <CloseGlyph />
                    </IconButton>
                  </div>
                </header>
                {/* The core checked the view against the catalogue before sending it. */}
                <div className="scroll-quiet max-h-72 overflow-y-auto text-[0.9375rem] [&_h2]:text-xl">
                  <ViewRenderer spec={card.spec as ViewSpec} actions={actions(card)} />
                </div>
              </motion.article>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
