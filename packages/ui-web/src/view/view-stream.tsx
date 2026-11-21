import type { ShownView } from '@repo/protocol'
import { AnimatePresence, animate, type MotionValue, motionValue, usePresence } from 'motion/react'
import { type CSSProperties, memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { cn } from '../primitives/cn.ts'
import { DURATION, EASE } from '../styles/motion.ts'
import type { ViewActions } from './context.ts'
import { type Band, dialOf, maskOf, roomOf, sinkOf } from './dial.ts'
import { createPush, scrollsUnder, wheelTravel } from './push.ts'
import { ViewCard } from './view-card.tsx'

interface ViewStreamProps {
  /** The views to show, newest first. */
  views: readonly ShownView[]
  /** The views that arrived while the app was open: they come in, where the ones read on opening are simply there. */
  arrived: readonly string[]
  /** The view the core looks at, the one it is talking about: it is lit, as by the core's own light. */
  attended?: string | undefined
  /** What the blocks of a view can do. Kept the same between renders, so a card is drawn again only when it changes. */
  actions(view: ShownView): ViewActions
  onClose(view: ShownView): void
  /** How far up from the bottom of the stream's box the composer reaches, in pixels: cards fade out above it. */
  under: number
  /**
   * How far the stage has gone home, from 0 in the stream to 1 at home. At home the stream sinks under the core, so
   * that only the top `HOME_PEEK` pixels of its newest view show above the composer, fading out into it.
   */
  home?: MotionValue<number> | undefined
  /** The person scrolled on up past the newest view, by wheel or key: the stage goes back to its large core. */
  onPastTop?: (() => void) | undefined
  className?: string | undefined
}

/** The room under the header where what rises fades out, before the band a card is read in starts. */
const INSET = 48

/**
 * The room above the composer where what sinks fades out, after the band a card is read in ends: nothing of a card
 * is seen behind the composer.
 */
const OUTSET = 40

/**
 * How much of the newest view shows at home, in pixels above the composer: its bar and the start of what it holds,
 * fading out into the composer, as a hint of what waits rather than a second thing to read.
 */
export const HOME_PEEK = 96

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
 * towards the composer, above which it is gone. A new view comes in at the middle and pushes the others down.
 */
export function ViewStream({ views, arrived, attended, actions, onClose, under, home, onPastTop, className }: ViewStreamProps) {
  const [dial] = useState(createDial)
  const shown = useRef(views)
  const pastTop = useRef(onPastTop)
  pastTop.current = onPastTop
  useLayoutEffect(() => dial.onPastTop(() => pastTop.current?.()), [dial])

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
  useLayoutEffect(() => dial.setHome(home), [home, dial])
  useLayoutEffect(() => dial.dispose, [dial])

  return (
    <div
      ref={dial.attachScroller}
      // Each card fades by itself, above the composer and under the header, so nothing is cut where it is seen.
      data-stream=""
      className={cn('scroll-none overflow-y-auto overscroll-contain px-8 [overflow-anchor:none]', className)}
    >
      <div ref={dial.attachColumn} className="relative mx-auto flex w-full max-w-[45rem] flex-col gap-6">
        <AnimatePresence initial={false}>
          {views.map((view) => (
            <StreamCard
              key={view.id}
              view={view}
              dial={dial}
              appear={arrived.includes(view.id)}
              lit={attended === view.id}
              actions={actions}
              onClose={onClose}
            />
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
  /** Whether the core looks at it. */
  lit: boolean
  actions(view: ShownView): ViewActions
  onClose(view: ShownView): void
}

/**
 * One card of the stream. Drawn again only when its own view or what it can do changes, not each time the screen
 * around it does (a sentence spoken, a change of mood): a view can be a large tree.
 */
const StreamCard = memo(function StreamCard({ view, dial, appear, lit, actions, onClose }: StreamCardProps) {
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

  // The dial draws the card's transform and opacity itself, on every frame it moves: React never sets them. The
  // core finds the card by its view, to look at it.
  return (
    <div ref={element} data-view={view.id} className="group/card relative shrink-0 origin-center will-change-[transform,opacity]">
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
    </div>
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

/**
 * How firmly the person must scroll on up past the newest view to go home: this many pixels of wheel within this
 * many milliseconds, so the overshoot of a quick scroll to the top stays at the top.
 */
const PUSH = { far: 90, within: 450 } as const

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
  // Where the composer's top is, from the top of the box; and how far the stream sinks at home.
  let floor = INSET + 1
  let depth = 0
  let home: MotionValue<number> | undefined
  let leaveHome: () => void = () => undefined
  let sunk = ''
  let band: Band = { top: INSET, bottom: INSET + 1 }
  let settling: { stop(): void } | undefined
  let pending: ReturnType<typeof setTimeout> | undefined
  // Past the top: a firm push of the wheel on up from the newest view goes home, and a wheel that only overshot
  // does not.
  let pastTop: () => void = () => undefined
  const push = createPush(PUSH.far, PUSH.within)
  const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

  /** How far the stage has gone home, from 0 to 1. */
  const homeward = () => Math.min(1, Math.max(0, home?.get() ?? 0))

  const paint = (slot: Slot) => {
    const offset = slot.offset.get()
    const presence = slot.presence.get()
    const middle = slot.top + offset + slot.height / 2 - scroll
    const look = dialOf(middle, slot.height, band)
    // A card coming in grows from a little smaller, as it fades in.
    const scale = look.scale * (0.96 + 0.04 * presence)
    const transform = `translate3d(0,${offset.toFixed(2)}px,0) scale(${scale.toFixed(4)})`
    const opacity = (look.opacity * presence).toFixed(3)
    // Where the box cuts a card rising past its top, the card fades out over the room above the band instead; and
    // towards the composer it fades out above the composer's top, over all that shows of it at home. The stream sunk
    // at home moves the composer's top up the card by as much.
    const going = homeward()
    const mask = maskOf(middle, slot.height, scale, { inset: INSET, floor: floor - going * depth, fade: OUTSET + (HOME_PEEK - OUTSET) * going })
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
   * Sinks the stream as far as the stage has gone home, and draws every card for it. The whole scroller moves, a
   * transform only, so the scroll and every card's place in it stay as they are.
   */
  const sink = () => {
    if (scroller) {
      const by = homeward() * depth
      const transform = by > 0.01 ? `translate3d(0,${by.toFixed(2)}px,0)` : ''
      if (transform !== sunk) {
        sunk = transform
        scroller.style.transform = transform
      }
    }
    paintAll()
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
    floor = Math.max(INSET + 1, height - under)
    band = { top: INSET, bottom: Math.max(INSET + 1, floor - OUTSET) }
    const first = ordered[0]
    const last = ordered.at(-1)
    if (first && last) {
      const room = roomOf(first.element.offsetHeight, last.element.offsetHeight, band, height)
      column.style.paddingTop = `${room.top}px`
      column.style.paddingBottom = `${room.bottom}px`
      // At home the stream is at its top, where the newest card's top rests where the room above it ends.
      depth = sinkOf(room.top, floor, HOME_PEEK)
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
    sink()
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

  /**
   * A wheel going on up at the top, a firm push of it, anywhere on the stage, or a key that would go further up, goes
   * home. The stage listens, as the wheel may be over the core or the header rather than over the stream.
   */
  let stage: HTMLElement | null = null
  const onStageWheel = (event: WheelEvent) => {
    if (!scroller || !stage) return
    // The wheel is free once the stream is at its top and nothing under the pointer would scroll up with it.
    const free = scroller.scrollTop <= 0 && !scrollsUnder(event.target, stage, 'up', scroller)
    if (push.wheel(-wheelTravel(event), performance.now(), free)) pastTop()
  }
  const onKey = (event: KeyboardEvent) => {
    if (!scroller || scroller.scrollTop > 0 || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
    if (event.key === 'Home' || event.key === 'PageUp' || event.key === 'ArrowUp') pastTop()
  }

  return {
    attachScroller(element: HTMLDivElement | null) {
      if (scroller) {
        scroller.removeEventListener('scroll', onScroll)
        scroller.removeEventListener('scrollend', ended)
        stage?.removeEventListener('wheel', onStageWheel)
        scroller.removeEventListener('keydown', onKey)
        for (const input of INPUTS) scroller.removeEventListener(input, release)
        resized.unobserve(scroller)
      }
      scroller = element
      if (!element) return
      element.addEventListener('scroll', onScroll, { passive: true })
      element.addEventListener('scrollend', ended)
      stage = element.closest('[data-stage]') ?? element
      stage.addEventListener('wheel', onStageWheel, { passive: true })
      element.addEventListener('keydown', onKey)
      for (const input of INPUTS) element.addEventListener(input, release, { passive: true })
      resized.observe(element)
    },
    attachColumn(element: HTMLDivElement | null) {
      if (column) resized.unobserve(column)
      column = element
      if (element) resized.observe(element)
    },
    measure,
    onPastTop(listener: () => void) {
      pastTop = listener
    },
    setUnder(px: number) {
      if (px === under) return
      under = px
      measure()
    },
    setHome(value: MotionValue<number> | undefined) {
      if (value === home) return
      leaveHome()
      home = value
      leaveHome = value?.on('change', sink) ?? (() => undefined)
      sink()
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
      leaveHome()
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
