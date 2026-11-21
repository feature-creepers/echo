import type { DockSide } from '@repo/protocol'
import { motion as tokens } from '@repo/tokens'
import { type Dispatch, type PointerEvent as ReactPointerEvent, type RefObject, type SetStateAction, useCallback, useRef } from 'react'

/** How far the pointer goes, holding a card's bar, before the card is dragged rather than pressed. */
const DRAG_THRESHOLD = 4
/** How close to a dock's top or bottom edge a dragged card scrolls it, and how fast at the edge, per frame. */
const SCROLL_ZONE = 48
const SCROLL_SPEED = 14

export type Docks = Record<DockSide, string[]>

/** A card being dragged: where it was picked up, where it would land now, and how tall its slot is. */
export interface Drag {
  id: string
  from: { side: DockSide; index: number }
  to: { side: DockSide; index: number }
  height: number
}

/** The docks with a card taken from where it was and put where it lands. */
export function moved(docks: Docks, drag: Drag): Docks {
  const next: Docks = { left: docks.left.filter((id) => id !== drag.id), right: docks.right.filter((id) => id !== drag.id) }
  next[drag.to.side].splice(drag.to.index, 0, drag.id)
  return next
}

export const keyOf = (docks: Docks) => `${docks.left.join(' ')}|${docks.right.join(' ')}`

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
  // The copy is not on the page yet, so each stand-in takes its size from the original.
  const playing = card.querySelectorAll<HTMLElement>('video, audio, iframe')
  picture.querySelectorAll('video, audio, iframe').forEach((media, index) => {
    const source = playing[index]
    const stand = document.createElement('div')
    stand.style.cssText = `width:${source?.offsetWidth ?? 0}px;height:${source?.offsetHeight ?? 0}px;background:rgb(0 0 0 / 0.4)`
    media.replaceWith(stand)
  })
  picture.removeAttribute('data-pin')
  picture.inert = true
  picture.setAttribute('aria-hidden', 'true')
  return picture
}

interface DockDragOptions {
  layer: RefObject<HTMLDivElement | null>
  order: Docks
  drag: Drag | undefined
  setDrag: Dispatch<SetStateAction<Drag | undefined>>
  settle(drag: Drag): void
  holding: RefObject<boolean>
}

/**
 * Dragging a card by its bar, within its dock or to the other one. Pressed and moved a few pixels, the card leaves
 * a slot where it would land and a still picture of it follows the pointer; the other cards part around the slot.
 * Released, the picture glides into the slot and the card takes its place. Escape puts it back where it was.
 * The picture is moved straight on the page, frame by frame, so following the pointer lays nothing out again.
 */
export function useDockDrag({ layer, order, drag, setDrag, settle, holding }: DockDragOptions) {
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
          boxShadow: '0 0 0 1px rgb(235 230 218 / 0.1), 0 22px 48px -16px rgb(0 0 0 / 0.85), 0 4px 12px -4px rgb(0 0 0 / 0.5)'
        })
        root.append(picture)
        requestAnimationFrame(() => {
          if (picture) picture.style.scale = '1.03'
        })
        holding.current = true
        document.documentElement.dataset.dragging = ''
        // Known at once, not at the next render: a release that comes first still finds the drag to end.
        const started = { id, from, to: from, height: box.height }
        current.current = started
        setDrag(started)
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
