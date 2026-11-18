import type { ViewSpec } from '@repo/catalog'
import { dockedOf } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import { DOCK_SIDES, type DockSide, type SavedWidget } from '@repo/protocol'
import { motion as tokens } from '@repo/tokens'
import { motion } from 'motion/react'
import {
  memo,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { cn } from '../primitives/cn.ts'
import { IconButton } from '../primitives/icon-button.tsx'
import { ChevronGlyph, ExpandGlyph, GripGlyph, PinGlyph } from '../primitives/icons.tsx'
import { DURATION, EASE, glide } from '../styles/motion.ts'
import type { ViewActions } from '../view/context.ts'
import { ViewRenderer } from '../view/view-renderer.tsx'
import type { LibraryControls } from './library-context.ts'

/** A dock's width, and the gap it keeps from the window's edge, in pixels. */
const WIDTH = 280
const EDGE = 12
/** The least room left between a dock and the conversation's column. */
const GAP = 32
/** The conversation's column, as wide as the stage draws it (45rem). */
const COLUMN = 720
/**
 * The narrowest window where the docks sit beside the conversation without covering it. The column is centred,
 * so both docks need the same room: they appear and disappear together. Narrower, the pinned widgets wait behind
 * the title row's toggle and float over the stage in one list.
 */
export const DOCKS_WIDTH = COLUMN + 2 * (GAP + WIDTH + EDGE)
/** How tall a widget is drawn before it is folded, with a way to unfold it. */
const FOLDED_HEIGHT = 288
/** How far the pointer goes, holding a card's bar, before the card is dragged rather than pressed. */
const DRAG_THRESHOLD = 4
/** How close to a dock's top or bottom edge a dragged card scrolls it, and how fast at the edge, per frame. */
const SCROLL_ZONE = 48
const SCROLL_SPEED = 14

/** Where the pinned widgets stand: in their docks, over the stage, or out of sight. */
export interface PinnedDocks {
  /** How many widgets are pinned. */
  count: number
  /** The window is wide enough for the docks to sit beside the conversation. */
  wide: boolean
  /** The pinned widgets are on screen. */
  shown: boolean
  toggle(): void
  show(): void
  hide(): void
}

/**
 * Where the pinned widgets stand, from the window's width and the user's choice. Wide enough, they are docked on
 * both sides of the conversation; narrower, they wait behind a toggle. The user's choice holds until the window
 * crosses that width again.
 */
export function usePinnedDocks(count: number): PinnedDocks {
  const query = `(min-width: ${DOCKS_WIDTH}px)`
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
  return useMemo(
    () => ({ count, wide, shown, toggle: () => setChosen(!shown), show: () => setChosen(true), hide: () => setChosen(false) }),
    [count, wide, shown]
  )
}

type Docks = Record<DockSide, string[]>

/** A card being dragged: where it was picked up, where it would land now, and how tall its slot is. */
interface Drag {
  id: string
  from: { side: DockSide; index: number }
  to: { side: DockSide; index: number }
  height: number
}

/** The docks with a card taken from where it was and put where it lands. */
function moved(docks: Docks, drag: Drag): Docks {
  const next: Docks = { left: docks.left.filter((id) => id !== drag.id), right: docks.right.filter((id) => id !== drag.id) }
  next[drag.to.side].splice(drag.to.index, 0, drag.id)
  return next
}

const keyOf = (docks: Docks) => `${docks.left.join(' ')}|${docks.right.join(' ')}`

/**
 * A still picture of a card, to drag around: its markup copied, with what a canvas drew copied over and what plays
 * left out, so the copy starts nothing and loads nothing.
 */
function pictureOf(card: HTMLElement): HTMLElement {
  const picture = card.cloneNode(true) as HTMLElement
  const drawn = card.querySelectorAll('canvas')
  picture.querySelectorAll('canvas').forEach((canvas, index) => {
    const source = drawn[index]
    if (source && source.width > 0 && source.height > 0) canvas.getContext('2d')?.drawImage(source, 0, 0)
  })
  for (const media of picture.querySelectorAll('video, audio, iframe')) {
    const stand = document.createElement('div')
    stand.style.cssText = `width:${(media as HTMLElement).offsetWidth}px;height:${(media as HTMLElement).offsetHeight}px;background:rgb(0 0 0 / 0.4)`
    media.replaceWith(stand)
  }
  picture.removeAttribute('data-pin')
  picture.inert = true
  picture.setAttribute('aria-hidden', 'true')
  return picture
}

/**
 * The widgets the user pinned, on the main screen: live (a pinned radio plays, a chart is as it was saved), in two
 * docks on either side of the centred conversation, each scrolled with the wheel. The user drags a card by its bar
 * to put it in order in its dock or to move it to the other one. Docks and order are the library's, kept by the core.
 *
 * In a narrow window the docks are hidden, and the title row's toggle slides every pinned widget over the right of
 * the stage in one list, the left dock's first, as a translucent panel that the same toggle or Escape closes.
 * Hidden, the widgets stay drawn and only fade: showing them again costs no new layout, and what they hold (a
 * scroll position, an unfolded card) is kept.
 */
export function PinnedDocksView({ controls, actions, docks }: { controls: LibraryControls; actions: ViewActions; docks: PinnedDocks }) {
  const library = useFollowed(controls.library)
  const docked = useMemo(() => dockedOf(library), [library])
  const byId = useMemo(() => new Map([...docked.left, ...docked.right].map((widget) => [widget.id, widget])), [docked])
  // The library's docks, as one string, so that a new copy of the same lists is not a change.
  const storedKey = keyOf({ left: docked.left.map((widget) => widget.id), right: docked.right.map((widget) => widget.id) })
  const stored = useMemo<Docks>(() => {
    const [left = '', right = ''] = storedKey.split('|')
    return { left: left === '' ? [] : left.split(' '), right: right === '' ? [] : right.split(' ') }
  }, [storedKey])
  const latestStored = useRef(stored)
  latestStored.current = stored

  // The docks on screen: the library's, except while a card is dragged and until the core has its new place.
  const [order, setOrder] = useState(stored)
  const [drag, setDrag] = useState<Drag>()
  const holding = useRef(false)
  useEffect(() => {
    if (!holding.current) setOrder(stored)
  }, [stored])

  // Folded and unfolded cards, by widget: a card moved to the other dock is drawn anew and stays as it was.
  const [shut, setShut] = useState<ReadonlySet<string>>(new Set())
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set())
  const flip = (set: (update: (was: ReadonlySet<string>) => ReadonlySet<string>) => void, id: string) =>
    set((was) => {
      const next = new Set(was)
      if (!next.delete(id)) next.add(id)
      return next
    })
  // A card dropped somewhere new is drawn anew there, so it does not glide in from where it was hidden.
  const [landings, setLandings] = useState<Readonly<Record<string, number>>>({})

  const floating = docks.shown && !docks.wide
  const { hide } = docks
  useEffect(() => {
    if (!floating) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [floating, hide])

  const layer = useRef<HTMLDivElement>(null)
  const settle = useCallback(
    (done: Drag) => {
      setDrag(undefined)
      setLandings((was) => ({ ...was, [done.id]: (was[done.id] ?? 0) + 1 }))
      const next = moved(order, done)
      if (keyOf(next) === keyOf(order)) {
        holding.current = false
        return
      }
      setOrder(next)
      // Until the core answers, the docks stay as dropped; then they follow the library again, whatever it says.
      const release = () => {
        holding.current = false
        setOrder(latestStored.current)
      }
      controls.library.arrange(next).then(release, release)
    },
    [order, controls]
  )
  const press = useDockDrag({ layer, order, drag, setDrag, settle, holding })

  if (byId.size === 0) return null

  const card = (widget: SavedWidget, side: DockSide | undefined) => (
    <PinnedCard
      key={`${widget.id}:${landings[widget.id] ?? 0}`}
      widget={widget}
      landed={(landings[widget.id] ?? 0) > 0}
      controls={controls}
      actions={actions}
      dragged={drag?.id === widget.id}
      shut={shut.has(widget.id)}
      unfolded={unfolded.has(widget.id)}
      onShut={() => flip(setShut, widget.id)}
      onUnfold={() => flip(setUnfolded, widget.id)}
      onPress={side && docks.shown ? (event, element) => press(event, widget.id, side, element) : undefined}
    />
  )

  if (!docks.wide) {
    const all = [...order.left, ...order.right].flatMap((id) => byId.get(id) ?? [])
    return (
      <motion.aside
        aria-label="Pinned widgets"
        aria-hidden={!docks.shown}
        inert={!docks.shown}
        initial={false}
        animate={
          docks.shown
            ? { opacity: 1, x: 0, visibility: 'visible', transition: { duration: DURATION.slow, ease: EASE } }
            : { opacity: 0, x: 24, transitionEnd: { visibility: 'hidden' }, transition: { duration: DURATION.calm, ease: EASE } }
        }
        style={{ width: WIDTH + 2 * EDGE, right: EDGE / 2 }}
        className="material shadow-float absolute top-1.5 bottom-1.5 z-20 flex max-w-[calc(100%-1rem)] flex-col overflow-hidden rounded-lg"
      >
        <motion.div
          layoutScroll
          className="scroll-quiet min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pt-3 pb-3 [mask-image:linear-gradient(to_bottom,black_calc(100%-12px),transparent)]"
        >
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5">{all.map((widget) => card(widget, undefined))}</div>
        </motion.div>
      </motion.aside>
    )
  }

  return (
    <div ref={layer} className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {DOCK_SIDES.map((side) => {
        const target = drag?.to.side === side ? drag : undefined
        // The cards of the dock, the dragged one kept in place but out of sight, and the slot where it would land.
        const items: ReactNode[] = []
        let before = 0
        for (const widget of order[side].flatMap((id) => byId.get(id) ?? [])) {
          if (target && widget.id !== target.id && before === target.to.index) items.push(<DropSlot key="drop" height={target.height} />)
          items.push(card(widget, side))
          if (widget.id !== drag?.id) before++
        }
        if (target && target.to.index >= before) items.push(<DropSlot key="drop" height={target.height} />)
        return (
          <motion.section
            key={side}
            aria-label={side === 'left' ? 'Pinned widgets on the left' : 'Pinned widgets on the right'}
            aria-hidden={!docks.shown}
            inert={!docks.shown}
            initial={false}
            animate={
              docks.shown
                ? { opacity: 1, x: 0, visibility: 'visible', transition: { duration: DURATION.slow, ease: EASE } }
                : { opacity: 0, x: side === 'left' ? -16 : 16, transitionEnd: { visibility: 'hidden' }, transition: { duration: DURATION.calm, ease: EASE } }
            }
            style={{ width: WIDTH, [side]: EDGE }}
            className="absolute top-2 bottom-4 flex flex-col"
          >
            {/* While a card is dragged, each dock shows the room it has, the one it would land in a little more. */}
            <div
              aria-hidden="true"
              className={cn(
                '-inset-x-1.5 pointer-events-none absolute inset-y-0 rounded-lg transition duration-(--duration-calm) ease-soft',
                drag ? 'bg-white/[0.015] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.05)]' : 'opacity-0',
                target && 'bg-white/[0.025] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.09)]'
              )}
            />
            {/* The list scrolls with the wheel, and fades out at its ends instead of being cut. */}
            <motion.div
              layoutScroll
              data-dock-scroll={side}
              className="scroll-quiet -mx-1.5 pointer-events-auto relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1.5 pt-1 pb-3 [mask-image:linear-gradient(to_bottom,transparent,black_6px,black_calc(100%-16px),transparent)]"
            >
              <div data-dock={side} className="relative grid grid-cols-[minmax(0,1fr)] gap-2.5">
                {items}
              </div>
            </motion.div>
          </motion.section>
        )
      })}
    </div>
  )
}

/** Where a dragged card would land: a slot its height, marked in the accent. */
function DropSlot({ height }: { height: number }) {
  return (
    <div
      data-drop=""
      style={{ height }}
      className="rounded-lg bg-[color-mix(in_oklab,var(--accent)_6%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--accent)_42%,transparent)]"
    />
  )
}

interface DockDragOptions {
  layer: RefObject<HTMLDivElement | null>
  order: Docks
  drag: Drag | undefined
  setDrag(drag: Drag | undefined | ((was: Drag | undefined) => Drag | undefined)): void
  settle(drag: Drag): void
  holding: RefObject<boolean>
}

/**
 * Dragging a card by its bar, within its dock or to the other one. Pressed and moved a few pixels, the card leaves
 * a slot where it would land and a still picture of it follows the pointer; the other cards part around the slot.
 * Released, the picture glides into the slot and the card takes its place. Escape puts it back where it was.
 * The picture is moved straight on the page, frame by frame, so following the pointer lays nothing out again.
 */
function useDockDrag({ layer, order, drag, setDrag, settle, holding }: DockDragOptions) {
  const current = useRef(drag)
  current.current = drag
  const latest = useRef({ order, settle })
  latest.current = { order, settle }

  /** Where the card would land with the pointer here: the dock on that half of the window, then between the cards. */
  const targetAt = useCallback(
    (x: number, y: number, id: string): Drag['to'] | undefined => {
      const root = layer.current
      if (!root) return undefined
      const box = root.getBoundingClientRect()
      const side: DockSide = x < box.left + box.width / 2 ? 'left' : 'right'
      const list = root.querySelector<HTMLElement>(`[data-dock="${side}"]`)
      if (!list) return undefined
      // Measured from the layout, not from the screen: the cards that glide aside do not move the boundaries.
      const top = list.getBoundingClientRect().top
      let index = 0
      for (const card of list.querySelectorAll<HTMLElement>('[data-pin]')) {
        if (card.dataset.pin === id) continue
        if (top + card.offsetTop + card.offsetHeight / 2 < y) index++
      }
      return { side, index }
    },
    [layer]
  )

  return useCallback(
    (event: ReactPointerEvent<HTMLElement>, id: string, side: DockSide, card: HTMLElement) => {
      if (event.button !== 0 || current.current) return
      // The bar's own buttons are pressed, not dragged.
      if ((event.target as HTMLElement).closest('button')) return
      event.preventDefault()
      const start = { x: event.clientX, y: event.clientY }
      const pointer = { ...start }
      /** Where the card was on screen when it was picked up: the picture's place before it moves. */
      let box: DOMRect | undefined
      let picture: HTMLElement | undefined
      let frame = 0
      let ending = false

      // Once a frame, however often the pointer reports: the picture follows it, the dock under it scrolls when the
      // pointer nears its top or bottom edge (so a long one can be dropped into anywhere), and the slot moves.
      const tick = () => {
        frame = requestAnimationFrame(tick)
        if (!picture) return
        picture.style.translate = `${pointer.x - start.x}px ${pointer.y - start.y}px`
        const under = current.current?.to.side
        const list = under && layer.current?.querySelector<HTMLElement>(`[data-dock-scroll="${under}"]`)
        if (list) {
          const edges = list.getBoundingClientRect()
          const near =
            pointer.y < edges.top + SCROLL_ZONE
              ? pointer.y - (edges.top + SCROLL_ZONE)
              : pointer.y > edges.bottom - SCROLL_ZONE
                ? pointer.y - (edges.bottom - SCROLL_ZONE)
                : 0
          if (near !== 0) list.scrollTop += Math.max(-1, Math.min(1, near / SCROLL_ZONE)) * SCROLL_SPEED
        }
        const to = targetAt(pointer.x, pointer.y, id)
        if (to) setDrag((was) => (was && (was.to.side !== to.side || was.to.index !== to.index) ? { ...was, to } : was))
      }

      const begin = () => {
        const root = layer.current
        if (!root) return
        const from = { side, index: latest.current.order[side].indexOf(id) }
        box = card.getBoundingClientRect()
        const origin = root.getBoundingClientRect()
        picture = pictureOf(card)
        Object.assign(picture.style, {
          position: 'absolute',
          left: `${box.left - origin.left}px`,
          top: `${box.top - origin.top}px`,
          width: `${box.width}px`,
          height: `${box.height}px`,
          margin: '0',
          zIndex: '10',
          pointerEvents: 'none',
          willChange: 'translate, scale',
          transition: `scale ${tokens.duration.calm}ms ${tokens.ease}, box-shadow ${tokens.duration.calm}ms ${tokens.ease}, opacity ${tokens.duration.quick}ms ${tokens.ease}`,
          boxShadow: '0 0 0 1px rgb(255 255 255 / 0.1), 0 22px 48px -16px rgb(0 0 0 / 0.85), 0 4px 12px -4px rgb(0 0 0 / 0.5)'
        })
        root.append(picture)
        requestAnimationFrame(() => {
          if (picture) picture.style.scale = '1.03'
        })
        holding.current = true
        document.documentElement.dataset.dragging = ''
        setDrag({ id, from, to: from, height: box.height })
        frame = requestAnimationFrame(tick)
      }

      const finish = (cancelled: boolean) => {
        if (ending) return
        ending = true
        stop()
        const dragged = current.current
        const shown = picture
        if (!dragged || !shown) return
        // The frame loop has stopped: the picture and the slot are put where the pointer was last, before it glides.
        shown.style.translate = `${pointer.x - start.x}px ${pointer.y - start.y}px`
        const last = cancelled ? dragged.from : (targetAt(pointer.x, pointer.y, id) ?? dragged.to)
        if (last.side !== dragged.to.side || last.index !== dragged.to.index) setDrag({ ...dragged, to: last })
        // Once the slot is where the card lands, the picture glides into it, then the card takes its place.
        requestAnimationFrame(() => {
          const slot = layer.current?.querySelector<HTMLElement>('[data-drop]')
          const landing = current.current ?? dragged
          if (slot && box) {
            const at = slot.getBoundingClientRect()
            shown.style.transition += `, translate ${tokens.duration.calm}ms ${tokens.ease}`
            shown.style.translate = `${at.left - box.left}px ${at.top - box.top}px`
            shown.style.scale = '1'
          }
          setTimeout(
            () => {
              latest.current.settle(landing)
              // The card is drawn in its new place on the next frame; the picture fades out over it.
              requestAnimationFrame(() => {
                shown.style.opacity = '0'
                setTimeout(() => shown.remove(), tokens.duration.quick)
              })
            },
            slot ? tokens.duration.calm : 0
          )
        })
      }

      const onMove = (moveEvent: PointerEvent) => {
        pointer.x = moveEvent.clientX
        pointer.y = moveEvent.clientY
        if (!picture && Math.hypot(pointer.x - start.x, pointer.y - start.y) >= DRAG_THRESHOLD) begin()
      }
      const onUp = () => (picture ? finish(false) : stop())
      const onCancel = () => (picture ? finish(true) : stop())
      const onKey = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key !== 'Escape' || !picture) return
        keyEvent.preventDefault()
        keyEvent.stopPropagation()
        finish(true)
      }
      const stop = () => {
        cancelAnimationFrame(frame)
        delete document.documentElement.dataset.dragging
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
        window.removeEventListener('keydown', onKey, true)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
      window.addEventListener('keydown', onKey, true)
    },
    [layer, setDrag, targetAt, holding]
  )
}

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
function PinnedCard({ widget, controls, actions, dragged, landed, shut, unfolded, onShut, onUnfold, onPress }: PinnedCardProps) {
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
