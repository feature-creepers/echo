import type { ViewSpec } from '@repo/catalog'
import { pinnedOf } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import type { SavedWidget } from '@repo/protocol'
import { AnimatePresence, motion, Reorder, useDragControls } from 'motion/react'
import { type PointerEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { cn } from '../primitives/cn.ts'
import { IconButton } from '../primitives/icon-button.tsx'
import { ChevronGlyph, CollapseGlyph, ExpandGlyph, GripGlyph, PinGlyph } from '../primitives/icons.tsx'
import { DURATION, EASE, glide } from '../styles/motion.ts'
import type { ViewActions } from '../view/context.ts'
import { ViewRenderer } from '../view/view-renderer.tsx'
import type { LibraryControls } from './library-context.ts'

/** The stack's width, and the gap it keeps from the window's edge and from the centred column, in pixels. */
const WIDTH = 272
const GUTTER = 12
/** The centred column of the main screen (45rem): the stack opens by itself only where it leaves the column alone. */
const COLUMN = 720
const ROOMY = COLUMN + 2 * (WIDTH + 2 * GUTTER)
/** How tall a widget is drawn before it is folded, with a way to unfold it. */
const FOLDED_HEIGHT = 288

/**
 * The widgets the user pinned, floating on the right of the main screen: live (a pinned radio plays, a chart is
 * as it was saved), stacked from the top in the user's own order, scrolled with the wheel and put in order by
 * dragging a card by its bar. The order is the library's, kept by the core.
 *
 * It never pushes the centred column. Where the window leaves room in its right margin it is open; where it does
 * not, it waits folded into a small tab, and opened from there it floats over the stage until folded again.
 */
export function PinnedStack({ controls, actions }: { controls: LibraryControls; actions: ViewActions }) {
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

  // Open by default only when the window's right margin can hold the stack; the user's choice wins until the
  // window crosses that width again.
  const root = useRef<HTMLDivElement>(null)
  const [roomy, setRoomy] = useState(true)
  const [chosen, setChosen] = useState<boolean>()
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const next = (entry?.contentRect.width ?? 0) >= ROOMY
      setRoomy((was) => {
        if (was !== next) setChosen(undefined)
        return next
      })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const open = chosen ?? roomy

  const shown = order.flatMap((id) => byId.get(id) ?? [])

  return (
    <div ref={root} className="pointer-events-none absolute inset-0 z-20">
      <AnimatePresence initial={false}>
        {pinned.length > 0 &&
          (open ? (
            <motion.aside
              key="open"
              aria-label="Pinned widgets"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0, transition: { duration: DURATION.calm, ease: EASE } }}
              exit={{ opacity: 0, x: 12, transition: { duration: DURATION.quick, ease: EASE } }}
              style={{ width: WIDTH, right: GUTTER }}
              className={cn(
                'pointer-events-auto absolute top-3 flex flex-col',
                // In the margin it needs no ground of its own; over the stage it is a panel, so what is under it does not show through.
                roomy ? 'bottom-4' : 'bottom-24 rounded-lg border border-line-strong bg-ground px-1.5 pb-1 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.95)]'
              )}
            >
              <header className="flex h-7 shrink-0 items-center justify-between pr-0.5 pl-1">
                <span className="flex items-center gap-1.5 font-mono text-[0.625rem] text-text-faint uppercase tracking-[0.12em]">
                  Pinned <span className="text-text-faint/60 tabular-nums">{pinned.length}</span>
                </span>
                <IconButton label="Fold the pinned widgets away" onClick={() => setChosen(false)}>
                  <CollapseGlyph />
                </IconButton>
              </header>
              {/* The list scrolls with the wheel, and fades out at its ends instead of being cut. */}
              <motion.div
                layoutScroll
                className="scroll-quiet -mx-1 min-h-0 flex-1 overflow-y-auto px-1 pt-1 pb-2 [mask-image:linear-gradient(to_bottom,transparent,black_6px,black_calc(100%-16px),transparent)]"
              >
                <Reorder.Group axis="y" values={order} onReorder={setOrder} className="grid gap-2">
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
          ) : (
            <motion.button
              key="folded"
              type="button"
              aria-label={`Show the pinned widgets (${pinned.length})`}
              title="Show the pinned widgets"
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0, transition: { duration: DURATION.calm, ease: EASE } }}
              exit={{ opacity: 0, x: 8, transition: { duration: DURATION.quick, ease: EASE } }}
              onClick={() => setChosen(true)}
              style={{ right: GUTTER }}
              className="pointer-events-auto absolute top-3 flex h-7 items-center gap-1.5 rounded-md border border-line-strong bg-surface/90 pr-2 pl-1.5 text-text-soft shadow-[0_8px_24px_-12px_rgb(0_0_0/0.9)] backdrop-blur-xl transition-colors duration-(--duration-quick) hover:border-text-faint/50 hover:text-text [&_svg]:size-3.5"
            >
              <PinGlyph filled />
              <span className="font-mono text-[0.625rem] uppercase tracking-[0.12em]">Pinned</span>
              <span className="font-mono text-[0.625rem] text-text-faint tabular-nums">{pinned.length}</span>
            </motion.button>
          ))}
      </AnimatePresence>
    </div>
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
      whileDrag={{ scale: 1.02, boxShadow: '0 18px 40px -16px rgb(0 0 0 / 0.95)', zIndex: 10 }}
      className="group/card relative grid overflow-hidden rounded-lg border border-line bg-surface shadow-[inset_0_1px_0_rgb(255_255_255/0.03)]"
    >
      <div
        onPointerDown={grab}
        className="flex h-8 cursor-grab touch-none select-none items-center gap-1 border-line border-b pr-1 pl-1.5 active:cursor-grabbing"
      >
        <span className="text-text-faint/50 transition-colors group-hover/card:text-text-faint [&_svg]:size-3.5">
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
          <div ref={body} className="px-3 pt-2.5 pb-3 [zoom:0.86]">
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
              className="flex h-5 items-center gap-1 rounded-sm px-1.5 font-mono text-[0.5625rem] text-text-faint uppercase tracking-[0.12em] transition-colors hover:bg-white/[0.05] hover:text-text"
            >
              {unfolded ? 'Less' : 'More'}
            </button>
          </div>
        )}
      </div>
    </Reorder.Item>
  )
}
