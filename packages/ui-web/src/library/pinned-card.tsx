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
 * One pinned widget, bare on the ground: its name in capitals over a hairline, with what can be done with it there
 * while it is pointed at, then the widget drawn live, as dense as in an answer. A tall one is cut to a fixed height,
 * fading where it is cut, until unfolded. In a dock, it is dragged by its name's row.
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
      // The picture dragged is a copy of the card without its mark: bare content would show what it passes over through
      // it, so it is drawn on a plane.
      className="group/card relative grid min-w-0 grid-cols-[minmax(0,1fr)] overflow-hidden not-data-[pin]:material"
    >
      <div
        onPointerDown={onPress && ((event) => root.current && onPress(event, root.current))}
        className={cn('flex h-7 touch-none select-none items-center gap-1 border-line border-b', onPress && 'cursor-grab')}
      >
        {onPress && (
          <span className="text-text-soft opacity-0 transition-opacity duration-(--duration-quick) group-hover/card:opacity-100 [&_svg]:size-3.5">
            <GripGlyph />
          </span>
        )}
        <span className="caps min-w-0 flex-1 truncate text-text-soft">{widget.title}</span>
        <div className="flex items-center opacity-0 transition-opacity duration-(--duration-quick) focus-within:opacity-100 group-hover/card:opacity-100 [&_button]:size-6 [&_svg]:size-3.5">
          <IconButton label={`Show ${widget.title} on the stage`} onClick={() => act(controls.library.show(widget.id))}>
            <ExpandGlyph />
          </IconButton>
          <IconButton label={`Unpin ${widget.title}`} onClick={() => act(controls.library.update({ widget: widget.id, pinned: false }))}>
            <PinGlyph filled />
          </IconButton>
          <IconButton label={shut ? `Unfold ${widget.title}` : `Fold ${widget.title}`} onClick={onShut}>
            <span className={cn('transition-transform duration-(--duration-calm) ease-soft', shut && '-rotate-90')}>
              <ChevronGlyph />
            </span>
          </IconButton>
        </div>
      </div>
      {/* Folded to its name's row, the widget stays drawn: what it plays goes on, and it unfolds as it was. */}
      <div hidden={shut} className="relative min-w-0">
        <div
          className={cn('overflow-hidden', tall && !unfolded && '[mask-image:linear-gradient(to_bottom,black_calc(100%-2rem),transparent)]')}
          style={unfolded ? undefined : { maxHeight: FOLDED_HEIGHT }}
        >
          <div ref={body} className="min-w-0 pt-2 pb-3">
            <WidgetBody spec={widget.spec as ViewSpec} actions={actions} />
          </div>
        </div>
        {tall && (
          <button
            type="button"
            onClick={onUnfold}
            className="caps flex h-6 items-center text-text-soft transition-colors duration-(--duration-quick) ease-soft hover:text-text"
          >
            {unfolded ? 'Show less' : 'Show more'}
          </button>
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
