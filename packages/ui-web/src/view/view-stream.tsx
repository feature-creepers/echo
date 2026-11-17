import type { ShownView } from '@repo/protocol'
import { AnimatePresence, animate, type MotionValue, motionValue, usePresence } from 'motion/react'
import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { cn } from '../primitives/cn.ts'
import { DURATION, EASE } from '../styles/motion.ts'
import type { ViewActions } from './context.ts'
import { type Band, dialOf, roomOf } from './dial.ts'
import { ViewCard } from './view-card.tsx'

export interface ViewStreamProps {
  /** The views to show, newest first. */
  views: readonly ShownView[]
  /** The views that arrived while the app was open: they come in, where the ones read on opening are simply there. */
  arrived: readonly string[]
  /** What the blocks of a view can do. Kept the same between renders, so a card is drawn again only when it changes. */
  actions(view: ShownView): ViewActions
  onClose(view: ShownView): void
  /** How far up from the bottom of the stream's box the composer reaches, in pixels: cards sink under it. */
  under: number
  className?: string | undefined
}

/** The room under the header where what rises fades out, before the band a card is read in starts. */
const INSET = 48

/** How the stream turns to a new place: soft enough to follow with the eye, damped so it never bounces. */
const TURN = { type: 'spring', stiffness: 240, damping: 32, mass: 1 } as const

/**
 * How near the middle a card must stop for the stream to settle it there, as a share of the band, and at most in
 * pixels. Only near: a scroll that stops between two cards stays where it stopped. The browser's own snapping is
 * not used, as it pulls a short scroll back to a tall card, against the person's hand.
 */
const SETTLE = { share: 0.2, most: 120, after: 140 } as const

/**
 * The views of the conversation, newest first, turning like a dial. The newest rests in the middle of the band
 * between the header and the composer and the older ones follow under it; scrolling down brings them up to the
 * middle. Each card shrinks a little and fades the further it is from the middle, up towards the header and down
 * under the composer. A new view comes in at the middle and pushes the others down.
 */
export function ViewStream({ views, arrived, actions, onClose, under, className }: ViewStreamProps) {
  const [dial] = useState(createDial)
  const shown = useRef(views)

  // After each change of the list, the dial measures where everything now is, so nothing jumps. A view put on top
  // turns the dial back to it, wherever the person had scrolled to.
  useLayoutEffect(() => {
    const before = shown.current
    shown.current = views
    const top = views[0]
    const was = before[0]
    const onTop =
      top !== undefined && was !== undefined && top.id !== was.id && (!before.some((view) => view.id === top.id) || views.some((view) => view.id === was.id))
    dial.measure(onTop)
  }, [views, dial])

  useLayoutEffect(() => dial.setUnder(under), [under, dial])
  useLayoutEffect(() => dial.dispose, [dial])

  return (
    <div
      ref={dial.attachScroller}
      // Each card fades by itself, and the box ends behind the composer, so nothing is cut where it is seen.
      className={cn('scroll-none overflow-y-auto overscroll-contain px-8 [overflow-anchor:none]', className)}
    >
      <div ref={dial.attachColumn} className="relative mx-auto flex w-full max-w-[45rem] flex-col gap-6">
        <AnimatePresence initial={false}>
          {views.map((view) => (
            <StreamCard key={view.id} view={view} dial={dial} appear={arrived.includes(view.id)} actions={actions} onClose={onClose} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

interface StreamCardProps {
  view: ShownView
  dial: Dial
  /** Whether it comes in: it arrived while the app was open. */
  appear: boolean
  actions(view: ShownView): ViewActions
  onClose(view: ShownView): void
}

/**
 * One card of the stream. Drawn again only when its own view or what it can do changes, not each time the screen
 * around it does (a sentence spoken, a change of mood): a view can be a large tree.
 */
const StreamCard = memo(function StreamCard({ view, dial, appear, actions, onClose }: StreamCardProps) {
  const element = useRef<HTMLDivElement>(null)
  const [present, safeToRemove] = usePresence()
  const entering = useRef(appear)
  const can = useMemo(() => actions(view), [actions, view])

  useLayoutEffect(() => {
    const card = element.current
    if (!card) return
    dial.add(card, entering.current)
    return () => dial.remove(card)
  }, [dial])

  useLayoutEffect(() => {
    if (!present && element.current) dial.leave(element.current, safeToRemove)
  }, [present, dial, safeToRemove])

  // The dial draws the card's transform and opacity itself, on every frame it moves: React never sets them.
  return (
    <div ref={element} className="shrink-0 origin-center will-change-[transform,opacity]">
      <ViewCard view={view} actions={can} onClose={() => onClose(view)} />
    </div>
  )
})

/** What the dial knows of a card. */
interface Slot {
  element: HTMLElement
  /** Where its box starts in the stream and how tall it is, as last measured. */
  top: number
  height: number
  measured: boolean
  /** How far it is drawn from its box while it glides to a new place. */
  offset: MotionValue<number>
  /** How far it has come in, from 0 to 1, and gone out again when closed. */
  presence: MotionValue<number>
  /** What was last written on it, so an unchanged frame writes nothing. */
  transform: string
  opacity: string
  mask: string
  stop(): void
}

type Dial = ReturnType<typeof createDial>

/** What the person does to move the stream themselves. */
const INPUTS = ['wheel', 'pointerdown', 'touchstart', 'keydown'] as const

/**
 * The stream's motion, outside React: it reads the layout only when the layout changes, and on every frame of a
 * scroll or a glide it writes a transform and an opacity on each card, nothing else, so the compositor moves them
 * without laying the page out again. Scroll events come once a frame, so a scroll needs no frame loop of its own.
 */
function createDial() {
  const slots = new Map<Element, Slot>()
  let scroller: HTMLElement | null = null
  let column: HTMLElement | null = null
  let scroll = 0
  let under = 0
  let band: Band = { top: INSET, bottom: INSET + 1 }
  let settling: { stop(): void } | undefined
  let pending: ReturnType<typeof setTimeout> | undefined
  const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

  const paint = (slot: Slot) => {
    const offset = slot.offset.get()
    const presence = slot.presence.get()
    const middle = slot.top + offset + slot.height / 2 - scroll
    const look = dialOf(middle, slot.height, band)
    // A card coming in grows from a little smaller, as it fades in.
    const scale = look.scale * (0.96 + 0.04 * presence)
    const transform = `translate3d(0,${offset.toFixed(2)}px,0) scale(${scale.toFixed(4)})`
    const opacity = (look.opacity * presence).toFixed(3)
    // Where the box cuts a card rising past its top, the card fades out over the room above the band instead. Only
    // that card carries a mask, in its own coordinates: one over the whole stream is drawn again on every frame of a
    // scroll, which costs frames.
    const cut = slot.height / 2 - middle / scale
    const mask =
      cut > -INSET / scale && cut < slot.height ? `linear-gradient(to bottom,transparent ${cut.toFixed(1)}px,black ${(cut + INSET / scale).toFixed(1)}px)` : ''
    if (transform !== slot.transform) {
      slot.transform = transform
      slot.element.style.transform = transform
    }
    if (opacity !== slot.opacity) {
      slot.opacity = opacity
      slot.element.style.opacity = opacity
    }
    if (mask !== slot.mask) {
      slot.mask = mask
      slot.element.style.maskImage = mask
    }
  }
  const paintAll = () => {
    for (const slot of slots.values()) paint(slot)
  }

  /**
   * Starts a card gliding from where it is drawn now, `shift` away from its new place, carrying the speed it had.
   */
  const glideFrom = (slot: Slot, shift: number) => {
    if (still()) {
      slot.offset.jump(0)
      return
    }
    const velocity = slot.offset.getVelocity()
    slot.offset.jump(slot.offset.get() + shift)
    animate(slot.offset, 0, { ...TURN, velocity })
  }

  /**
   * Reads where every card now is, after the list or a size changed. A card whose place changed is drawn where it
   * was and glides to its new place, so nothing jumps. Turned to the top, the stream scrolls back to the newest:
   * from the top, the new card comes in at the middle in front of the others, which make way down; from further
   * down, the whole dial turns back, the new card coming down into the middle with the rest, so no card crosses
   * another.
   */
  const measure = (toTop = false) => {
    if (!scroller || !column) return
    const ordered: Slot[] = []
    for (const child of column.children) {
      const slot = slots.get(child)
      if (slot) ordered.push(slot)
    }
    const height = scroller.clientHeight
    band = { top: INSET, bottom: Math.max(INSET + 1, height - under) }
    const first = ordered[0]
    const last = ordered.at(-1)
    if (first && last) {
      const room = roomOf(first.element.offsetHeight, last.element.offsetHeight, band, height)
      column.style.paddingTop = `${room.top}px`
      column.style.paddingBottom = `${room.bottom}px`
    }
    // The scroll this layout was last drawn at: a change of the layout can move it before the scroll event says so.
    const was = scroll
    if (toTop) {
      release()
      scroller.scrollTop = 0
    }
    scroll = scroller.scrollTop
    const arriving: Slot[] = []
    let turn: number | undefined
    for (const [index, slot] of ordered.entries()) {
      // Newer cards are drawn in front of older ones.
      slot.element.style.zIndex = String(ordered.length - index)
      const top = slot.element.offsetTop
      const shift = slot.top - was - (top - scroll)
      const known = slot.measured
      slot.top = top
      slot.height = slot.element.offsetHeight
      slot.measured = true
      if (!known) {
        arriving.push(slot)
        continue
      }
      turn ??= shift
      if (Math.abs(shift) > 0.5) glideFrom(slot, shift)
    }
    if (toTop && was > 1 && turn !== undefined) for (const slot of arriving) glideFrom(slot, turn)
    paintAll()
  }

  const onScroll = () => {
    if (!scroller) return
    scroll = scroller.scrollTop
    paintAll()
  }

  /** When a scroll ends with a card near the middle, it glides the last few pixels there, as a dial clicks into place. */
  const settle = () => {
    pending = undefined
    if (!scroller || settling || still()) return
    const reach = Math.min(SETTLE.most, (band.bottom - band.top) * SETTLE.share)
    const middle = (band.top + band.bottom) / 2
    let nearest: number | undefined
    for (const slot of slots.values()) {
      // Nothing settles while the stream is still turning, and a card taller than the band is read, not placed.
      if (slot.offset.get() !== 0 || slot.presence.get() !== 1) return
      if (slot.height > band.bottom - band.top) continue
      const away = slot.top + slot.height / 2 - scroll - middle
      if (nearest === undefined || Math.abs(away) < Math.abs(nearest)) nearest = away
    }
    if (nearest === undefined || Math.abs(nearest) < 1 || Math.abs(nearest) > reach) return
    const element = scroller
    settling = animate(scroll, scroll + nearest, {
      duration: DURATION.slow,
      ease: EASE,
      onUpdate: (top) => {
        element.scrollTop = top
      },
      onComplete: () => {
        settling = undefined
      }
    })
  }
  // A scroll ends between the notches of a wheel too: the stream waits a moment before it settles anything.
  const ended = () => {
    clearTimeout(pending)
    pending = setTimeout(settle, SETTLE.after)
  }
  // The person's hand always wins over a settling glide.
  const release = () => {
    clearTimeout(pending)
    pending = undefined
    settling?.stop()
    settling = undefined
  }
  const resized = new ResizeObserver(() => measure())

  return {
    attachScroller(element: HTMLDivElement | null) {
      if (scroller) {
        scroller.removeEventListener('scroll', onScroll)
        scroller.removeEventListener('scrollend', ended)
        for (const input of INPUTS) scroller.removeEventListener(input, release)
        resized.unobserve(scroller)
      }
      scroller = element
      if (!element) return
      element.addEventListener('scroll', onScroll, { passive: true })
      element.addEventListener('scrollend', ended)
      for (const input of INPUTS) element.addEventListener(input, release, { passive: true })
      resized.observe(element)
    },
    attachColumn(element: HTMLDivElement | null) {
      if (column) resized.unobserve(column)
      column = element
      if (element) resized.observe(element)
    },
    measure,
    setUnder(px: number) {
      if (px === under) return
      under = px
      measure()
    },
    /** A card is drawn: it is measured with the others, and comes in if it arrived just now. */
    add(element: HTMLElement, appear: boolean) {
      const slot: Slot = {
        element,
        top: 0,
        height: 0,
        measured: false,
        offset: motionValue(0),
        presence: motionValue(appear && !still() ? 0 : 1),
        transform: '',
        opacity: '',
        mask: '',
        stop: () => undefined
      }
      const stopOffset = slot.offset.on('change', () => paint(slot))
      const stopPresence = slot.presence.on('change', () => paint(slot))
      slot.stop = () => {
        stopOffset()
        stopPresence()
        slot.offset.stop()
        slot.presence.stop()
      }
      slots.set(element, slot)
      resized.observe(element)
      // It comes in a moment after the others start to make room for it.
      if (slot.presence.get() < 1) animate(slot.presence, 1, { duration: DURATION.slow, ease: EASE, delay: 0.06 })
    },
    remove(element: HTMLElement) {
      slots.get(element)?.stop()
      slots.delete(element)
      resized.unobserve(element)
    },
    dispose() {
      release()
      resized.disconnect()
      for (const slot of slots.values()) slot.stop()
      slots.clear()
    },
    /** A card is closed: it fades where it is, then leaves, and the others close the gap. */
    leave(element: HTMLElement, done: () => void) {
      const slot = slots.get(element)
      if (!slot || still()) return done()
      element.style.pointerEvents = 'none'
      animate(slot.presence, 0, { duration: DURATION.quick * 1.4, ease: EASE, onComplete: done })
    }
  }
}
