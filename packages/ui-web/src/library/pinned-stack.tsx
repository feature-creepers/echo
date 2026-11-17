import type { ViewSpec } from '@repo/catalog'
import { pinnedOf } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import type { SavedWidget } from '@repo/protocol'
import { motion, Reorder, useDragControls } from 'motion/react'
import { type PointerEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { cn } from '../primitives/cn.ts'
import { IconButton } from '../primitives/icon-button.tsx'
import { ChevronGlyph, CloseGlyph, ExpandGlyph, GripGlyph, PinGlyph } from '../primitives/icons.tsx'
import { DURATION, EASE, glide } from '../styles/motion.ts'
import type { ViewActions } from '../view/context.ts'
import { ViewRenderer } from '../view/view-renderer.tsx'
import type { LibraryControls } from './library-context.ts'

/** The stack's width, and the gap it keeps from the window's edges and from the column, in pixels. */
const WIDTH = 280
const GUTTER = 12
/**
 * The narrowest window where the stack sits beside the conversation: the 720 px column, a comfortable 40 px on
 * each side of it, and the stack with its gutters. Narrower, the stack waits behind a toggle and floats over.
 */
export const DOCK_WIDTH = 720 + 2 * 40 + WIDTH + 2 * GUTTER
/** How far the conversation moves left while the stack is docked, so it is centred in the space left of it. */
export const DOCKED_SHIFT = -(WIDTH + 2 * GUTTER) / 2
/** How tall a widget is drawn before it is folded, with a way to unfold it. */
const FOLDED_HEIGHT = 288

/** Where the pinned widgets stand: docked beside the conversation, floating over it, or out of sight. */
export interface PinnedDock {
  /** How many widgets are pinned. */
  count: number
  /** The window is wide enough for the stack to sit beside the conversation. */
  wide: boolean
  /** The stack is on screen. */
  shown: boolean
  toggle(): void
  hide(): void
}

/**
 * Where the pinned widgets stand, from the window's width and the user's choice. Wide enough, they show beside
 * the conversation; narrower, they wait behind a toggle. The user's choice holds until the window crosses
 * that width again.
 */
export function usePinnedDock(count: number): PinnedDock {
  const query = `(min-width: ${DOCK_WIDTH}px)`
  const [wide, setWide] = useState(() => window.matchMedia(query).matches)
  const [chosen, setChosen] = useState<boolean>()
  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = () => {
      setWide(media.matches)
      setChosen(undefined)
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [query])
  const shown = count > 0 && (chosen ?? wide)
  return useMemo(() => ({ count, wide, shown, toggle: () => setChosen(!shown), hide: () => setChosen(false) }), [count, wide, shown])
}

/**
 * The widgets the user pinned, on the right of the main screen: live (a pinned radio plays, a chart is as it was
 * saved), stacked from the top in the user's own order, scrolled with the wheel and put in order by dragging a
 * card by its bar. The order is the library's, kept by the core.
 *
 * In a wide window the stack is docked beside the conversation, which moves to the centre of the space left of
 * it. In a narrow one it slides over the right of the stage from the title row's toggle, as a translucent panel,
 * and closes with the same toggle, its close button or Escape.
 */
export function PinnedStack({ controls, actions, dock }: { controls: LibraryControls; actions: ViewActions; dock: PinnedDock }) {
  const library = useFollowed(controls.library)
  const pinned = pinnedOf(library)
  const byId = useMemo(() => new Map(pinned.map((widget) => [widget.id, widget])), [pinned])
  // The library's order, as one string, so that a new copy of the same list is not a change.
  const storedKey = pinned.map((widget) => widget.id).join(' ')
  const stored = useMemo(() => (storedKey === '' ? [] : storedKey.split(' ')), [storedKey])

  // The order on screen: the library's, except while a card is dragged and until the core has the new one.
  const [order, setOrder] = useState(stored)
  const dragging = useRef(false)
  const latest = useRef(order)
  latest.current = order
  useEffect(() => {
    if (!dragging.current) setOrder(stored)
  }, [stored])

  const commit = () => {
    dragging.current = false
    const next = latest.current
    if (next.join(' ') === storedKey) return
    controls.library.arrange(next).catch(() => setOrder(stored))
  }

  const floating = dock.shown && !dock.wide
  const { hide } = dock
  useEffect(() => {
    if (!floating) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [floating, hide])

  const shown = order.flatMap((id) => byId.get(id) ?? [])

  if (pinned.length === 0) return null
  // Hidden, the stack stays drawn and only fades and slides away: showing it again costs no new layout, and what
  // its widgets hold (a scroll position, an unfolded card) is kept.
  const offset = floating ? 24 : 16
  return (
    <motion.aside
      key={floating ? 'floating' : 'docked'}
      aria-label="Pinned widgets"
      aria-hidden={!dock.shown}
      inert={!dock.shown}
      initial={false}
      animate={
        dock.shown
          ? { opacity: 1, x: 0, visibility: 'visible', transition: { duration: DURATION.slow, ease: EASE } }
          : { opacity: 0, x: offset, transitionEnd: { visibility: 'hidden' }, transition: { duration: DURATION.calm, ease: EASE } }
      }
      style={{ width: floating ? WIDTH + 2 * GUTTER : WIDTH, right: floating ? GUTTER / 2 : GUTTER }}
      className={cn(
        'absolute z-20 flex flex-col',
        // Docked, it needs no ground of its own; floating over the stage, it is a translucent panel.
        floating ? 'material shadow-float top-1.5 bottom-1.5 rounded-lg px-2.5 pb-1' : 'top-3 bottom-4'
      )}
    >
      <header className={cn('flex shrink-0 items-center justify-between pl-1', floating ? 'h-10 pr-0' : 'h-7 pr-0.5')}>
        <span className="flex items-baseline gap-1.5 font-medium text-text-soft text-xs">
          Pinned <span className="font-normal text-text-faint tabular-nums">{pinned.length}</span>
        </span>
        {floating && (
          <IconButton label="Close the pinned widgets" onClick={dock.hide} className="size-6 [&_svg]:size-3.5">
            <CloseGlyph />
          </IconButton>
        )}
      </header>
      {/* The list scrolls with the wheel, and fades out at its ends instead of being cut. */}
      <motion.div
        layoutScroll
        className="scroll-quiet -mx-1 min-h-0 flex-1 overflow-y-auto px-1 pt-1 pb-3 [mask-image:linear-gradient(to_bottom,transparent,black_6px,black_calc(100%-16px),transparent)]"
      >
        <Reorder.Group axis="y" values={order} onReorder={setOrder} className="grid gap-2.5">
          {shown.map((widget) => (
            <PinnedCard
              key={widget.id}
              widget={widget}
              controls={controls}
              actions={actions}
              onDragStart={() => {
                dragging.current = true
              }}
              onDragEnd={commit}
            />
          ))}
        </Reorder.Group>
      </motion.div>
    </motion.aside>
  )
}

interface PinnedCardProps {
  widget: SavedWidget
  controls: LibraryControls
  actions: ViewActions
  onDragStart(): void
  onDragEnd(): void
}

/**
 * One pinned widget: a bar to drag it by, with its name and what can be done with it, over the widget drawn
 * live and a little smaller than on the stage. A tall one is folded to a fixed height until unfolded.
 */
function PinnedCard({ widget, controls, actions, onDragStart, onDragEnd }: PinnedCardProps) {
  const drag = useDragControls()
  const [shut, setShut] = useState(false)
  const [unfolded, setUnfolded] = useState(false)
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

  const grab = (event: PointerEvent) => {
    // The bar's own buttons are pressed, not dragged.
    if ((event.target as HTMLElement).closest('button')) return
    event.preventDefault()
    drag.start(event)
  }
  const act = (work: Promise<unknown>) => void work.catch(() => undefined)

  return (
    <Reorder.Item
      value={widget.id}
      dragListener={false}
      dragControls={drag}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      layout="position"
      transition={glide}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      whileDrag={{ scale: 1.02, boxShadow: '0 20px 44px -14px rgb(0 0 0 / 0.9)', zIndex: 10 }}
      className="group/card relative grid overflow-hidden rounded-lg bg-surface shadow-[0_0_0_1px_rgb(255_255_255/0.06),0_6px_18px_-10px_rgb(0_0_0/0.7)]"
    >
      <div onPointerDown={grab} className="flex h-8 cursor-grab touch-none select-none items-center gap-1 pr-1 pl-1.5 active:cursor-grabbing">
        <span className="text-text-faint/0 transition-colors group-hover/card:text-text-faint [&_svg]:size-3.5">
          <GripGlyph />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-text-soft text-xs">{widget.title}</span>
        <div className="flex items-center opacity-0 transition-opacity duration-(--duration-quick) focus-within:opacity-100 group-hover/card:opacity-100 [&_button]:size-6 [&_svg]:size-3.5">
          <IconButton label={`Show ${widget.title} on the stage`} onClick={() => act(controls.library.show(widget.id))}>
            <ExpandGlyph />
          </IconButton>
          <IconButton label={`Unpin ${widget.title}`} onClick={() => act(controls.library.update({ widget: widget.id, pinned: false }))}>
            <PinGlyph filled />
          </IconButton>
        </div>
        <IconButton label={shut ? `Unfold ${widget.title}` : `Fold ${widget.title}`} onClick={() => setShut((was) => !was)} className="size-6 [&_svg]:size-3.5">
          <span className={cn('transition-transform duration-(--duration-calm) ease-soft', shut && '-rotate-90')}>
            <ChevronGlyph />
          </span>
        </IconButton>
      </div>
      {/* Folded to its bar, the widget stays drawn: what it plays goes on, and it unfolds as it was. */}
      <div hidden={shut} className="relative">
        <div className="overflow-hidden" style={unfolded ? undefined : { maxHeight: FOLDED_HEIGHT }}>
          {/* Drawn a little smaller than on the stage: the same widget, at the size of a margin. */}
          <div ref={body} className="px-3 pt-1 pb-3 [zoom:0.86]">
            <ViewRenderer spec={widget.spec as ViewSpec} actions={actions} />
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
              onClick={() => setUnfolded((was) => !was)}
              className="flex h-5 items-center gap-1 rounded-sm px-2 text-[0.6875rem] text-text-soft transition-colors hover:bg-white/[0.06] hover:text-text"
            >
              {unfolded ? 'Show less' : 'Show more'}
            </button>
          </div>
        )}
      </div>
    </Reorder.Item>
  )
}
