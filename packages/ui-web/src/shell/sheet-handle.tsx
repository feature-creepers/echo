import { SHEET_WIDTH } from '@repo/client'
import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react'
import { clampSheetWidth, type SheetBounds, sheetBounds, sheetWidthByKey } from './sheet-width.ts'

export interface SheetHandleProps {
  /** The width the user chose, in pixels. */
  width: number
  /** The room the screen under the sheet keeps for itself beside it, in pixels. */
  keep: number
  /** Show a width while the edge is dragged: written straight to the page, so nothing is drawn again by React. */
  onPreview(width: number): void
  /** Keep a width: the drag ended, a key moved the edge, or a double-click put it back. */
  onCommit(width: number): void
}

/**
 * The sheet's left edge, as a separator that resizes it: dragged with the pointer, moved by the arrow keys, Home
 * and End, and put back to its first width by a double-click. Its hit area is wider than it looks, centred on
 * the edge; under the pointer, after a moment, or while dragged, a hairline of the accent marks it.
 */
export function SheetHandle({ width, keep, onPreview, onCommit }: SheetHandleProps) {
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ from: number; width: number; bounds: SheetBounds; next: number; frame: number } | undefined>(undefined)
  const bounds = useWindowBounds(keep)
  const shown = clampSheetWidth(width, bounds)

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const now = sheetBounds(window.innerWidth, keep)
    drag.current = { from: event.clientX, width: clampSheetWidth(width, now), bounds: now, next: clampSheetWidth(width, now), frame: 0 }
    setDragging(true)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const held = drag.current
    if (!held) return
    // The edge follows the pointer, at most once a frame: moving left widens the sheet.
    held.next = clampSheetWidth(held.width + held.from - event.clientX, held.bounds)
    if (held.frame) return
    held.frame = requestAnimationFrame(() => {
      held.frame = 0
      onPreview(held.next)
    })
  }
  const end = (event: PointerEvent<HTMLDivElement>) => {
    const held = drag.current
    if (!held) return
    drag.current = undefined
    cancelAnimationFrame(held.frame)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setDragging(false)
    onPreview(held.next)
    if (held.next !== shown) onCommit(held.next)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = sheetWidthByKey(event.key, shown, bounds)
    if (next === undefined) return
    event.preventDefault()
    onPreview(next)
    onCommit(next)
  }

  // While dragged, the pointer is the resizing one wherever it goes, and nothing gets selected.
  useEffect(() => {
    if (!dragging) return
    document.documentElement.dataset.resizing = ''
    return () => void delete document.documentElement.dataset.resizing
  }, [dragging])

  return (
    // The separator of the sheet and what is beside it: a focusable one, so it carries its value.
    // biome-ignore lint/a11y/useSemanticElements: an <hr> cannot be focused or dragged; a focusable separator is a widget.
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the side sheet"
      aria-valuenow={shown}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      tabIndex={0}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => {
        const first = clampSheetWidth(SHEET_WIDTH.initial, sheetBounds(window.innerWidth, keep))
        onPreview(first)
        onCommit(first)
      }}
      onKeyDown={onKeyDown}
      className="group -left-[6px] absolute inset-y-0 z-10 w-[10px] cursor-col-resize touch-none outline-none"
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-[5px] w-px bg-accent/50 opacity-0 transition-opacity duration-(--duration-quick) ease-soft group-hover:opacity-100 group-hover:delay-150 group-focus-visible:opacity-100 group-data-dragging:opacity-100 group-data-dragging:delay-0"
      />
    </div>
  )
}

/** The widths the sheet may take in the window as it is now, kept current as the window is resized. */
function useWindowBounds(keep: number): SheetBounds {
  const [bounds, setBounds] = useState(() => sheetBounds(window.innerWidth, keep))
  useEffect(() => {
    const measure = () => {
      const next = sheetBounds(window.innerWidth, keep)
      setBounds((was) => (was.min === next.min && was.max === next.max ? was : next))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [keep])
  return bounds
}
