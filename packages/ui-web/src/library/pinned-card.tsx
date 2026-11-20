import type { ViewSpec } from '@repo/catalog'
import type { SavedWidget } from '@repo/protocol'
import { motion } from 'motion/react'
import { memo, type PointerEvent as ReactPointerEvent, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '../primitives/cn.ts'
import { IconButton } from '../primitives/icon-button.tsx'
import { ChevronGlyph, ExpandGlyph, GripGlyph, PinGlyph } from '../primitives/icons.tsx'
import { glide } from '../styles/motion.ts'
import type { ViewActions } from '../view/context.ts'
import { ViewRenderer } from '../view/view-renderer.tsx'
import type { LibraryControls } from './library-context.ts'

/** How tall a widget is drawn before it is folded, with a way to unfold it. */
const FOLDED_HEIGHT = 288

interface PinnedCardProps {
  widget: SavedWidget
  controls: LibraryControls
  actions: ViewActions
  /** The card is being dragged: a picture of it follows the pointer, and it leaves its place. */
  dragged: boolean
  /** The card was just dropped where it is: the picture that was dragged is there already, so it shows at once. */
  landed: boolean
  shut: boolean
  unfolded: boolean
  onShut(): void
  onUnfold(): void
  /** Its bar is pressed: the card may be dragged. Left out, it stays where it is. */
  onPress?: ((event: ReactPointerEvent<HTMLElement>, card: HTMLElement) => void) | undefined
}

/**
 * One pinned widget: a bar with its name and what can be done with it, over the widget drawn live and a little
 * smaller than on the stage. A tall one is folded to a fixed height until unfolded. In a dock, it is dragged by
 * its bar.
 */
export function PinnedCard({ widget, controls, actions, dragged, landed, shut, unfolded, onShut, onUnfold, onPress }: PinnedCardProps) {
  const root = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const [tall, setTall] = useState(false)

  // Whether the widget is taller than a folded card, measured as it is drawn and whenever it changes size.
  useLayoutEffect(() => {
    const element = body.current
    if (!element) return
    const observer = new ResizeObserver(() => setTall(element.getBoundingClientRect().height > FOLDED_HEIGHT + 8))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const act = (work: Promise<unknown>) => void work.catch(() => undefined)

  return (
    <motion.div
      ref={root}
      // The drag finds the cards of a dock by this mark.
      data-pin={widget.id}
      layout="position"
      transition={glide}
      initial={landed ? false : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      // Dragged, the card leaves the layout: the picture that follows the pointer stands for it.
      style={{ display: dragged ? 'none' : undefined }}
      className="group/card relative grid min-w-0 grid-cols-[minmax(0,1fr)] overflow-hidden rounded-lg bg-surface shadow-[0_0_0_1px_rgb(255_255_255/0.06),0_6px_18px_-10px_rgb(0_0_0/0.7)]"
    >
      <div
        onPointerDown={onPress && ((event) => root.current && onPress(event, root.current))}
        className={cn('flex h-8 touch-none select-none items-center gap-1 pr-1 pl-1.5', onPress ? 'cursor-grab' : 'pl-3')}
      >
        {onPress && (
          <span className="text-text-faint/0 transition-colors group-hover/card:text-text-faint [&_svg]:size-3.5">
            <GripGlyph />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate font-medium text-text-soft text-xs">{widget.title}</span>
        <div className="flex items-center opacity-0 transition-opacity duration-(--duration-quick) focus-within:opacity-100 group-hover/card:opacity-100 [&_button]:size-6 [&_svg]:size-3.5">
          <IconButton label={`Show ${widget.title} on the stage`} onClick={() => act(controls.library.show(widget.id))}>
            <ExpandGlyph />
          </IconButton>
          <IconButton label={`Unpin ${widget.title}`} onClick={() => act(controls.library.update({ widget: widget.id, pinned: false }))}>
            <PinGlyph filled />
          </IconButton>
        </div>
        <IconButton label={shut ? `Unfold ${widget.title}` : `Fold ${widget.title}`} onClick={onShut} className="size-6 [&_svg]:size-3.5">
          <span className={cn('transition-transform duration-(--duration-calm) ease-soft', shut && '-rotate-90')}>
            <ChevronGlyph />
          </span>
        </IconButton>
      </div>
      {/* Folded to its bar, the widget stays drawn: what it plays goes on, and it unfolds as it was. */}
      <div hidden={shut} className="relative min-w-0">
        <div className="overflow-hidden" style={unfolded ? undefined : { maxHeight: FOLDED_HEIGHT }}>
          {/* Drawn a little smaller than on the stage: the same widget, at the size of a margin. */}
          <div ref={body} className="min-w-0 px-3 pt-1 pb-3 [zoom:0.86]">
            <WidgetBody spec={widget.spec as ViewSpec} actions={actions} />
          </div>
        </div>
        {tall && (
          <div
            className={cn(
              'flex justify-center pb-1.5',
              !unfolded && 'absolute inset-x-0 bottom-0 bg-gradient-to-t from-surface via-surface/90 to-transparent pt-8'
            )}
          >
            <button
              type="button"
              onClick={onUnfold}
              className="flex h-5 items-center gap-1 rounded-sm px-2 text-[0.6875rem] text-text-soft transition-colors hover:bg-white/[0.06] hover:text-text"
            >
              {unfolded ? 'Show less' : 'Show more'}
            </button>
          </div>
        )}
      </div>
    </motion.div>
  )
}

/**
 * The widget itself, drawn again only when it changes: while a card is dragged, the cards around it render on each
 * move of the slot so they glide aside, and what they show has no reason to be drawn again.
 */
const WidgetBody = memo(function WidgetBody({ spec, actions }: { spec: ViewSpec; actions: ViewActions }) {
  return <ViewRenderer spec={spec} actions={actions} />
})
