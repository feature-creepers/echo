import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { EASE } from '../styles/motion.ts'
import { cn } from './cn.ts'

export interface MenuItem {
  label: string
  onSelect(): void
  /** Something that cannot be undone, shown in the danger colour. */
  danger?: boolean
}

export interface MenuProps {
  /** The button that opens it, given whether it is open and how to open it. */
  trigger(open: boolean, toggle: () => void): ReactNode
  items: readonly MenuItem[]
  /** Which side of the trigger it lines up with. */
  align?: 'start' | 'end'
  /** Something above the items: a word on what they apply to. */
  header?: ReactNode
}

/** A few actions under a button. It closes on a choice, on Escape, and on a press anywhere else. */
export function Menu({ trigger, items, align = 'end', header }: MenuProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div ref={root} className="relative">
      {trigger(open, () => setOpen((was) => !was))}
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -2, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -2, scale: 0.98, transition: { duration: 0.1 } }}
            transition={{ duration: 0.16, ease: EASE }}
            className={cn(
              'absolute top-full z-50 mt-1 grid min-w-48 gap-px rounded-lg border border-line-strong bg-overlay p-1 shadow-[0_16px_40px_-12px_rgb(0_0_0/0.8)]',
              align === 'end' ? 'right-0 origin-top-right' : 'left-0 origin-top-left'
            )}
          >
            {header && <div className="mb-1 border-line border-b px-2 pt-1 pb-2">{header}</div>}
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
                className={cn(
                  'flex h-7 items-center rounded-sm px-2 text-left text-[0.8125rem] transition duration-(--duration-quick) ease-soft',
                  item.danger ? 'text-danger hover:bg-danger/12' : 'text-text-soft hover:bg-raised hover:text-text'
                )}
              >
                {item.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
