import { dockedOf } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import { DOCK_SIDES, type DockSide, type SavedWidget } from '@repo/protocol'
import { motion } from 'motion/react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '../primitives/cn.ts'
import { DURATION, EASE } from '../styles/motion.ts'
import type { ViewActions } from '../view/context.ts'
import { type Docks, type Drag, keyOf, moved, useDockDrag } from './dock-drag.ts'
import type { LibraryControls } from './library-context.ts'
import { PinnedCard } from './pinned-card.tsx'

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
const DOCKS_WIDTH = COLUMN + 2 * (GAP + WIDTH + EDGE)

/** Where the pinned widgets stand: in their docks, over the stage, or out of sight. */
interface PinnedDocks {
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
