import type { ShownView } from '@repo/protocol'
import { animate, type MotionValue, motion, motionValue } from 'motion/react'
import { type CSSProperties, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useScrollEdges } from '../conversation/scroll-edges.ts'
import { cn } from '../primitives/cn.ts'
import { DURATION, EASE, glide } from '../styles/motion.ts'
import { boardOf, type Columns, columnsOf, keptOf } from './board.ts'
import type { ViewActions } from './context.ts'
import { ViewCard } from './view-card.tsx'

interface ViewBoardProps {
  /** The views to show, newest first. */
  views: readonly ShownView[]
  /** The views that arrived while the app was open: they come in, where the ones read on opening are simply there. */
  arrived: readonly string[]
  /** The view the core looks at, the one it is talking about: it is lit, as by the core's own light. */
  attended?: string | undefined
  /** What the blocks of a view can do. Kept the same between renders, so a card is drawn again only when it changes. */
  actions(view: ShownView): ViewActions
  onClose(view: ShownView): void
  className?: string | undefined
  style?: CSSProperties | undefined
}

/**
 * Where the board fades out where it is cut: under the header when scrolled, and at its foot, just above the composer,
 * when there is more below. Only where something is cut: a mask costs the compositor while anything moves under it.
 */
const FADES = {
  none: '',
  above: '[mask-image:linear-gradient(to_bottom,transparent,black_12px)]',
  below: '[mask-image:linear-gradient(to_bottom,black_calc(100%-28px),transparent)]',
  both: '[mask-image:linear-gradient(to_bottom,transparent,black_12px,black_calc(100%-28px),transparent)]'
} as const

const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The views of the conversation as a board of cards: as many columns as the board's own width holds, the newest view
 * at the top left and the others in reading order across the columns, each column a stack. A new view comes in at
 * the top left, growing slightly as it fades in, while the others glide to their new places; a closed card fades
 * where it stands, then the others close the gap. The board scrolls by itself, and back to its top when a view is
 * put on top.
 */
export function ViewBoard({ views, arrived, attended, actions, onClose, className, style }: ViewBoardProps) {
  const [board] = useState(createBoard)
  const [cards, setCards] = useState(() => keptOf<ShownView>([], views))
  const [given, setGiven] = useState(views)
  if (given !== views) {
    setGiven(views)
    setCards(keptOf(cards, views))
  }
  const left = useCallback((id: string) => setCards((was) => was.filter((card) => !(card.leaving && card.view.id === id))), [])

  useLayoutEffect(() => board.arrange(cards.map((card) => card.view.id)), [cards, board])
  useLayoutEffect(() => board.dispose, [board])

  // A view put on top, new or shown again, brings the board back to its top, wherever the person had scrolled to.
  const shown = useRef(views)
  useEffect(() => {
    const before = shown.current
    shown.current = views
    const top = views[0]
    const was = before[0]
    if (top === undefined || was === undefined || top.id === was.id) return
    if (!before.some((view) => view.id === top.id) || views.some((view) => view.id === was.id)) board.toTop()
  }, [views, board])

  const [watchEdges, edges] = useScrollEdges()
  const scroller = useCallback(
    (element: HTMLDivElement | null) => {
      board.attachScroller(element)
      watchEdges(element)
    },
    [board, watchEdges]
  )
  const fade = FADES[edges.above ? (edges.below ? 'both' : 'above') : edges.below ? 'below' : 'none']

  return (
    <div ref={scroller} className={cn('scroll-none overflow-y-auto overscroll-contain', fade, className)} style={style}>
      <div ref={board.attachBoard} className="relative">
        {cards.map(({ view, leaving }) => (
          <BoardCard
            key={view.id}
            view={view}
            board={board}
            appear={arrived.includes(view.id)}
            leaving={leaving}
            lit={attended === view.id}
            actions={actions}
            onClose={onClose}
            onLeft={left}
          />
        ))}
      </div>
    </div>
  )
}

interface BoardCardProps {
  view: ShownView
  board: Board
  /** Whether it comes in: it arrived while the app was open. */
  appear: boolean
  /** It was closed: it fades where it stands, then leaves. */
  leaving: boolean
  /** Whether the core looks at it. */
  lit: boolean
  actions(view: ShownView): ViewActions
  onClose(view: ShownView): void
  onLeft(id: string): void
}

/**
 * One card of the board. Drawn again only when its own view or what it can do changes, not each time the screen
 * around it does (a sentence spoken, a change of mood): a view can be a large tree. The board moves it by its
 * transform alone.
 */
const BoardCard = memo(function BoardCard({ view, board, appear, leaving, lit, actions, onClose, onLeft }: BoardCardProps) {
  const element = useRef<HTMLDivElement>(null)
  const [drawn] = useState(() => {
    const entering = appear && !still()
    return { x: motionValue(0), y: motionValue(0), scale: motionValue(entering ? 0.96 : 1), opacity: motionValue(entering ? 0 : 1) }
  })
  const can = useMemo(() => actions(view), [actions, view])
  const id = view.id

  useLayoutEffect(() => {
    const card = element.current
    if (!card) return
    board.add(id, card, drawn)
    return () => board.remove(id)
  }, [board, id, drawn])

  // It comes in a moment after the others start to make room for it; closed, it fades where it stands, then leaves.
  useEffect(() => {
    if (leaving) {
      if (still()) return onLeft(id)
      const fading = animate(drawn.opacity, 0, { duration: DURATION.quick * 1.4, ease: EASE, onComplete: () => onLeft(id) })
      return () => fading.stop()
    }
    if (drawn.opacity.get() === 1) return
    const coming = { duration: DURATION.slow, ease: EASE, delay: 0.06 }
    const fading = animate(drawn.opacity, 1, coming)
    const growing = animate(drawn.scale, 1, coming)
    return () => {
      fading.stop()
      growing.stop()
    }
  }, [leaving, id, drawn, onLeft])

  // The core finds the card by its view, to look at it.
  return (
    <motion.div
      ref={element}
      data-view={id}
      inert={leaving}
      style={drawn}
      className={cn('group/card absolute top-0 left-0 will-change-transform', leaving && 'pointer-events-none')}
    >
      <ViewCard view={view} actions={can} onClose={() => onClose(view)} />
      {/* The core's light on the card it looks at: its edge in the accent, and a little of the light falling on it
          from above, where the core is. Faintly the same under the pointer, as a card shows it is there to use. Only
          its opacity moves. */}
      <span
        aria-hidden="true"
        style={CORE_LIGHT}
        className={cn(
          'pointer-events-none absolute inset-0 rounded-lg transition-opacity duration-(--duration-slow) ease-soft',
          lit ? 'opacity-100' : 'opacity-0 group-hover/card:opacity-40'
        )}
      />
    </motion.div>
  )
})

/**
 * The light the core casts on a card it looks at: a ring of the accent where the card's hairline is, brightest
 * along its top edge, which faces the core, and a faint wash of the accent falling from the top, gone before the
 * middle of the card, so what is in it reads as it always does.
 */
const CORE_LIGHT: CSSProperties = {
  // The brighter top edge is drawn inside the ring, so it follows the card's rounded corners: a shadow shifted up
  // showed only as two arcs at the top corners.
  boxShadow:
    '0 0 0 1px color-mix(in oklab, var(--accent) 46%, transparent), inset 0 1px 0 0 color-mix(in oklab, var(--accent) 60%, transparent), 0 0 0 2px color-mix(in oklab, var(--accent) 12%, transparent)',
  background: 'radial-gradient(90% 55% at 50% 0%, color-mix(in oklab, var(--accent) 8%, transparent), transparent 75%)'
}

/** Where a card is drawn: the board writes its place, the card its coming and going. */
interface Motion {
  x: MotionValue<number>
  y: MotionValue<number>
  scale: MotionValue<number>
  opacity: MotionValue<number>
}

/** What the board knows of a card. */
interface Slot {
  element: HTMLElement
  motion: Motion
  /** Its height, as last measured. */
  height: number
  /** It has a place already: it glides from there to a new one, where a card just drawn is simply put. */
  placed: boolean
}

type Board = ReturnType<typeof createBoard>

/**
 * The board's layout, outside React: it reads the cards' heights only when they change, and writes each card's width
 * and place, the place as a transform, so a card moves without the page being laid out again. A card glides to a new
 * place when the list changes or the board's columns do; when only a width or a height changes, as while the window
 * or the side sheet is resized, everything follows at once.
 */
function createBoard() {
  const slots = new Map<string, Slot>()
  const ids = new Map<Element, string>()
  let order: readonly string[] = []
  let scroller: HTMLElement | null = null
  let box: HTMLElement | null = null
  let width = 0
  let columns: Columns = { count: 0, width: -1 }

  const move = (value: MotionValue<number>, to: number, gliding: boolean) => {
    if (value.get() === to && !value.isAnimating()) return
    if (gliding) animate(value, to, glide)
    else value.jump(to)
  }

  /** Lays every card out for the board's width; `gliding` when the list changed, so cards travel to their places. */
  const place = (gliding: boolean) => {
    if (!box) return
    const next = columnsOf(width)
    // A new column width changes the cards' heights: they are written, then read again, once, before anything moves.
    if (next.width !== columns.width) {
      for (const slot of slots.values()) slot.element.style.width = `${next.width}px`
      for (const slot of slots.values()) slot.height = slot.element.offsetHeight
    }
    const reflowed = next.count !== columns.count
    columns = next
    const layout = boardOf(
      order.map((id) => slots.get(id)?.height ?? 0),
      columns
    )
    box.style.height = `${layout.height}px`
    for (const [index, id] of order.entries()) {
      const slot = slots.get(id)
      const to = layout.places[index]
      if (!slot || !to) continue
      // A card on its way somewhere goes on gliding to wherever it now belongs.
      const travelling = slot.motion.x.isAnimating() || slot.motion.y.isAnimating()
      const glides = (gliding || reflowed || travelling) && slot.placed && !still()
      // Newer cards are drawn in front of older ones, which they cross on their way.
      slot.element.style.zIndex = String(order.length - index)
      move(slot.motion.x, to.x, glides)
      move(slot.motion.y, to.y, glides)
      slot.placed = true
    }
  }

  const resized = new ResizeObserver((entries) => {
    let changed = false
    for (const entry of entries) {
      if (entry.target === box) {
        const now = Math.round(entry.contentRect.width)
        changed ||= now !== width
        width = now
        continue
      }
      const slot = slots.get(ids.get(entry.target) ?? '')
      if (!slot) continue
      const height = slot.element.offsetHeight
      changed ||= height !== slot.height
      slot.height = height
    }
    if (changed) place(false)
  })

  return {
    attachScroller(element: HTMLDivElement | null) {
      scroller = element
    },
    attachBoard(element: HTMLDivElement | null) {
      if (box) resized.unobserve(box)
      box = element
      if (!element) return
      width = Math.round(element.clientWidth)
      resized.observe(element)
    },
    /** The cards in order, newest first, whenever they may have changed: they glide only when the order did. */
    arrange(next: readonly string[]) {
      const changed = next.length !== order.length || next.some((id, index) => id !== order[index])
      order = next
      place(changed)
    },
    /** A card is drawn: it takes the board's column width, and is measured. */
    add(id: string, element: HTMLElement, motion: Motion) {
      if (columns.width >= 0) element.style.width = `${columns.width}px`
      slots.set(id, { element, motion, height: element.offsetHeight, placed: false })
      ids.set(element, id)
      resized.observe(element)
    },
    remove(id: string) {
      const slot = slots.get(id)
      if (!slot) return
      slot.motion.x.stop()
      slot.motion.y.stop()
      resized.unobserve(slot.element)
      ids.delete(slot.element)
      slots.delete(id)
    },
    toTop() {
      scroller?.scrollTo({ top: 0, behavior: still() ? 'auto' : 'smooth' })
    },
    dispose() {
      resized.disconnect()
    }
  }
}
