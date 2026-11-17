import type { ViewSpec } from '@repo/catalog'
import type { ShownView, Thread } from '@repo/protocol'
import { AnimatePresence, motion } from 'motion/react'
import { SaveControl } from '../library/save-control.tsx'
import { IconButton } from '../primitives/icon-button.tsx'
import { ArrowGlyph, CloseGlyph } from '../primitives/icons.tsx'
import { EASE } from '../styles/motion.ts'
import type { ViewActions } from './context.ts'
import { PanelBar } from './view-panel.tsx'
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
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.24, ease: EASE }}
                onClick={() => onFocus(thread.id)}
                className="group flex h-7 max-w-full items-center gap-2 rounded-md border border-line-strong bg-surface/90 pr-2 pl-2.5 transition-colors duration-(--duration-quick) hover:border-accent/50 hover:bg-raised"
              >
                <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
                <span className="font-mono text-[0.625rem] text-accent uppercase tracking-[0.12em]">Ready</span>
                <span className="min-w-0 truncate text-[0.8125rem]">{thread.title}</span>
                <span className="text-text-faint transition group-hover:translate-x-0.5 group-hover:text-text [&_svg]:size-3.5">
                  <ArrowGlyph />
                </span>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      )}
      {cards.length > 0 && (
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(100%,17rem),1fr))]">
          <AnimatePresence initial={false}>
            {[...cards].reverse().map((card) => (
              <motion.article
                key={card.id}
                layout
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.14 } }}
                transition={{ duration: 0.3, ease: EASE }}
                className="grid min-w-0 content-start overflow-hidden rounded-lg border border-line bg-surface/85"
              >
                <PanelBar lead="By the way" title={card.title}>
                  <SaveControl view={card} />
                  <IconButton label="Dismiss" onClick={() => onClose(card.id)}>
                    <CloseGlyph />
                  </IconButton>
                </PanelBar>
                {/* The core checked the view against the catalogue before sending it. */}
                <div className="scroll-quiet max-h-72 overflow-y-auto px-4 pt-3 pb-4">
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
