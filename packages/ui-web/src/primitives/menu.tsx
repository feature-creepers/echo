import { AnimatePresence, motion } from 'motion/react'
import { type AriaRole, type KeyboardEvent, type ReactNode, type RefObject, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { EASE } from '../styles/motion.ts'
import { cn } from './cn.ts'
import { CheckGlyph } from './icons.tsx'

/** Which side of what opens it a floating list appears on. It turns to the other side when it does not fit. */
export type Side = 'top' | 'bottom'
/** Which edge of what opens it a floating list lines up with. */
export type Align = 'start' | 'end'

/** The space kept between a floating list and what opens it, and between the list and the window's edges. */
const GAP = 4
const MARGIN = 8

/** What a floating list's entries are found by, for the keys that move between them. */
const ENTRY = '[data-entry]:not([aria-disabled="true"])'

export interface FloatingProps {
  /** What it opens from: it is placed against this, and pressing it is not pressing outside. */
  anchor: RefObject<HTMLElement | null>
  open: boolean
  /** Asked to close: Escape, Tab, a press outside, the window losing focus. */
  onClose(how: 'key' | 'outside'): void
  side?: Side
  align?: Align
  /** At least as wide as what opens it, as the list of a select is. */
  matchWidth?: boolean
  /** Where the keyboard goes when it opens: the entry in force, else the first; or the list itself, so no entry looks picked. */
  focus?: 'entry' | 'list'
  role: AriaRole
  id?: string | undefined
  label?: string | undefined
  className?: string | undefined
  children: ReactNode
}

/**
 * A list that floats over everything, against what opened it: the panel of a menu, the options of a select.
 * It lives at the end of the page, so no panel or scroll area around its opener can cut it, and it carries the
 * accent of where it was opened. Up and down move between its entries, Home and End go to either end, and
 * typing a few letters goes to the entry that starts with them.
 */
export function Floating({
  anchor,
  open,
  onClose,
  side = 'bottom',
  align = 'start',
  matchWidth = false,
  focus = 'entry',
  role,
  id,
  label,
  className,
  children
}: FloatingProps) {
  const panel = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const closing = useRef(onClose)
  closing.current = onClose
  const focusing = useRef(focus)
  focusing.current = focus
  const [placed, setPlaced] = useState<Side>(side)

  // Placed before it is painted, and again whenever the window or anything around the opener scrolls or resizes.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const opener = anchor.current
      const box = panel.current
      const inner = list.current
      if (!opener || !box || !inner) return
      const at = opener.getBoundingClientRect()
      if (matchWidth) inner.style.minWidth = `${at.width}px`
      const width = box.offsetWidth
      const height = inner.scrollHeight
      const below = window.innerHeight - at.bottom - GAP - MARGIN
      const above = at.top - GAP - MARGIN
      const turned = side === 'bottom' ? height > below && above > below : height > above && below > above
      const on: Side = turned ? (side === 'bottom' ? 'top' : 'bottom') : side
      const room = Math.max(0, on === 'bottom' ? below : above)
      const shown = Math.min(height, room)
      const left = Math.min(Math.max(align === 'start' ? at.left : at.right - width, MARGIN), window.innerWidth - MARGIN - width)
      box.style.left = `${left}px`
      box.style.top = `${on === 'bottom' ? at.bottom + GAP : at.top - GAP - shown}px`
      box.style.transformOrigin = `${align === 'start' ? 'left' : 'right'} ${on === 'bottom' ? 'top' : 'bottom'}`
      inner.style.maxHeight = `${room}px`
      setPlaced(on)
    }
    place()
    // The accent is a property of the page around the opener, not of the end of the page where the list lives.
    const opener = anchor.current
    if (opener && panel.current) {
      const style = getComputedStyle(opener)
      panel.current.style.setProperty('--accent', style.getPropertyValue('--accent'))
      panel.current.style.setProperty('--accent-ink', style.getPropertyValue('--accent-ink'))
    }
    // What it lists may change while it is open, a choice in it showing other entries below: it is placed again.
    const resized = new ResizeObserver(place)
    if (list.current) resized.observe(list.current)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      resized.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, anchor, side, align, matchWidth])

  // The keyboard goes into the list as it opens, onto the entry in force when there is one. Decided once, as it opens.
  useEffect(() => {
    if (!open) return
    const inner = list.current
    if (!inner) return
    const chosen = inner.querySelector<HTMLElement>(`${ENTRY}[aria-checked="true"], ${ENTRY}[aria-selected="true"]`)
    const target = focusing.current === 'entry' ? (chosen ?? inner.querySelector<HTMLElement>(ENTRY)) : undefined
    ;(target ?? inner).focus({ preventScroll: true })
    target?.scrollIntoView({ block: 'nearest' })
  }, [open])

  // Escape is taken before anything else hears it, so it closes the list and not the screen behind it.
  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (!panel.current?.contains(target) && !anchor.current?.contains(target)) closing.current('outside')
    }
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      closing.current('key')
    }
    const onBlur = () => closing.current('outside')
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [open, anchor])

  const typed = useRef({ text: '', at: 0 })
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // While it is open the list has the keyboard: a letter goes to an entry, not to the composer behind it.
    event.stopPropagation()
    const inner = list.current
    if (!inner) return
    if (event.key === 'Tab') {
      event.preventDefault()
      return closing.current('key')
    }
    const entries = [...inner.querySelectorAll<HTMLElement>(ENTRY)]
    if (entries.length === 0) return
    const at = entries.indexOf(document.activeElement as HTMLElement)
    let next: HTMLElement | undefined
    if (event.key === 'ArrowDown') next = entries[at < 0 ? 0 : (at + 1) % entries.length]
    else if (event.key === 'ArrowUp') next = entries[at < 0 ? entries.length - 1 : (at - 1 + entries.length) % entries.length]
    else if (event.key === 'Home' || event.key === 'PageUp') next = entries[0]
    else if (event.key === 'End' || event.key === 'PageDown') next = entries.at(-1)
    else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // Letters typed close together make one word to look for; the same letter again goes to the next entry it starts.
      const now = performance.now()
      const text = now - typed.current.at < 700 ? typed.current.text + event.key.toLowerCase() : event.key.toLowerCase()
      typed.current = { text, at: now }
      const again = [...text].every((letter) => letter === text.charAt(0))
      const word = again ? text.charAt(0) : text
      const from = again ? at + 1 : Math.max(at, 0)
      next = [...entries.slice(from), ...entries.slice(0, from)].find((entry) => (entry.dataset.entry ?? '').toLowerCase().startsWith(word))
    } else return
    event.preventDefault()
    if (!next) return
    next.focus({ preventScroll: true })
    next.scrollIntoView({ block: 'nearest' })
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        // The panel moves and its layers fade: an ancestor that fades would keep the material from blurring what is behind it.
        <motion.div
          ref={panel}
          initial="closed"
          animate="open"
          exit="closed"
          variants={{
            closed: { y: placed === 'bottom' ? -3 : 3, scale: 0.97, transition: { duration: 0.1, ease: EASE } },
            open: { y: 0, scale: 1, transition: { duration: 0.16, ease: EASE } }
          }}
          className="no-drag fixed top-0 left-0 z-[60] max-w-[calc(100vw-1rem)]"
        >
          <motion.span
            aria-hidden="true"
            variants={{ closed: { opacity: 0, transition: { duration: 0.1 } }, open: { opacity: 1, transition: { duration: 0.14 } } }}
            className="pointer-events-none absolute inset-0 rounded-lg shadow-float"
          />
          <motion.div
            ref={list}
            id={id}
            role={role}
            aria-label={label}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            // Moving off the entries leaves none of them looking picked.
            onPointerLeave={() => list.current?.focus({ preventScroll: true })}
            variants={{ closed: { opacity: 0, transition: { duration: 0.1 } }, open: { opacity: 1, transition: { duration: 0.14 } } }}
            className={cn('material scroll-quiet relative grid min-w-48 overflow-y-auto overscroll-contain rounded-lg p-1 outline-none', className)}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

export interface RowProps {
  role: AriaRole
  label: string
  onSelect(): void
  /** A second line under the label, quieter: what the choice means. */
  detail?: ReactNode | undefined
  /** Something at the end of the row: a state, a word on why it cannot be picked. */
  hint?: ReactNode | undefined
  /** A small mark before the label: a dot that says how something stands. */
  mark?: ReactNode | undefined
  /** Ticked: the choice in force. Left out, the row is an action, not a choice. */
  checked?: boolean | undefined
  /** Room is kept for a tick, so the labels of a list line up whether or not each row is a choice. */
  ticks?: boolean
  /** Something that cannot be undone, in the danger colour. */
  danger?: boolean | undefined
  /** A choice that gives a lot away, with its detail in the warning colour. */
  warn?: boolean | undefined
  disabled?: boolean | undefined
}

/**
 * One entry of a floating list. The pointer and the keyboard pick out the same row: moving over a row gives it
 * the keyboard, so there is only ever one row lit.
 */
export function Row({ role, label, onSelect, detail, hint, mark, checked, ticks = false, danger, warn, disabled }: RowProps) {
  const selection = role === 'option' ? { 'aria-selected': checked === true } : checked === undefined ? {} : { 'aria-checked': checked }
  return (
    <button
      type="button"
      role={role}
      tabIndex={-1}
      data-entry={label}
      aria-disabled={disabled === true ? true : undefined}
      {...selection}
      onClick={() => {
        if (!disabled) onSelect()
      }}
      onPointerMove={(event) => {
        if (!disabled && document.activeElement !== event.currentTarget) event.currentTarget.focus({ preventScroll: true })
      }}
      className={cn(
        'flex w-full min-w-0 gap-2 rounded-[5px] px-2 text-left outline-none transition-colors duration-75',
        detail ? 'items-start py-1.5' : 'min-h-6 items-center py-[3px]',
        disabled ? 'cursor-default' : danger ? 'focus:bg-danger/12' : 'focus:bg-white/[0.08]'
      )}
    >
      {ticks && <span className={cn('flex w-3 shrink-0 justify-center text-accent', detail && 'pt-[3px]')}>{checked && <CheckGlyph size={12} />}</span>}
      {mark && <span className={cn('flex shrink-0 items-center', detail ? 'h-[1.125rem]' : 'h-4')}>{mark}</span>}
      <span className="grid min-w-0 flex-1 gap-px">
        <span
          className={cn(
            'truncate text-[0.8125rem] leading-[1.125rem]',
            disabled ? 'text-text-faint' : danger ? 'text-danger' : 'text-text',
            checked && !disabled && 'font-medium'
          )}
        >
          {label}
        </span>
        {detail && <span className={cn('text-pretty text-[0.6875rem] leading-snug', warn ? 'text-warn/90' : 'text-text-faint')}>{detail}</span>}
      </span>
      {hint && <span className={cn('max-w-40 shrink-0 truncate pl-3 text-[0.6875rem] text-text-faint', detail && 'pt-px')}>{hint}</span>}
    </button>
  )
}

export interface MenuItem {
  label: string
  onSelect(): void
  detail?: ReactNode
  hint?: ReactNode
  mark?: ReactNode
  /** One of a group of choices: ticked when it is the one in force. */
  checked?: boolean
  /** With `checked`: on or off, a choice of its own, rather than one of a group. */
  toggle?: boolean
  danger?: boolean
  warn?: boolean
  /** Shown, but cannot be picked: its hint says why. */
  disabled?: boolean
  /** The menu stays open once it is picked: for a choice that changes what the menu shows below it. */
  stay?: boolean
}

/** The name over a group of entries. */
export interface MenuHeading {
  heading: string
}

/** A hairline between two groups. */
export interface MenuDivider {
  divider: true
}

export type MenuEntry = MenuItem | MenuHeading | MenuDivider

/** What the button that opens a menu is given: how it says to a screen reader that it opens one. */
export interface MenuTrigger {
  open: boolean
  toggle(): void
  props: { 'aria-haspopup': 'menu'; 'aria-expanded': boolean; 'aria-controls': string | undefined }
}

export interface MenuProps {
  /** The button that opens it, given whether it is open and how to open it. */
  trigger(open: boolean, toggle: () => void, trigger: MenuTrigger): ReactNode
  items: readonly MenuEntry[]
  /** Which side of the trigger it lines up with. */
  align?: Align
  /** Which side of the trigger it opens on: below, or above for a trigger at the bottom of the window. */
  side?: Side
  /** Something above the items: a word on what they apply to. */
  header?: ReactNode
  /** What the menu is, for a screen reader. */
  label?: string
  /** The panel's width, when the entries need more than the least. */
  className?: string
}

/**
 * A few actions or choices under a button, floating over everything. It closes on a choice, on Escape, and on
 * a press anywhere else, and gives the keyboard back to its button when it was used to close it.
 */
export function Menu({ trigger, items, align = 'end', side = 'bottom', header, label, className }: MenuProps) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  const id = useId()
  /** Opened from the keyboard: the first entry takes it. Opened with the pointer, no entry looks picked until one is pointed at. */
  const keyed = useRef(false)

  const close = useCallback((how: 'key' | 'outside') => {
    setOpen(false)
    if (how === 'key') anchor.current?.querySelector<HTMLElement>('button, [tabindex]')?.focus()
  }, [])
  const toggle = useCallback(() => setOpen((was) => !was), [])
  const ticks = items.some((item) => 'label' in item && item.checked !== undefined)

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: it only listens for how its own button was pressed
    <div
      ref={anchor}
      className="relative inline-flex"
      onPointerDown={() => {
        keyed.current = false
      }}
      onKeyDown={(event) => {
        keyed.current = true
        if ((event.key === 'ArrowDown' && side === 'bottom') || (event.key === 'ArrowUp' && side === 'top')) {
          event.preventDefault()
          setOpen(true)
        }
      }}
    >
      {trigger(open, toggle, { open, toggle, props: { 'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-controls': open ? id : undefined } })}
      <Floating
        anchor={anchor}
        open={open}
        onClose={close}
        side={side}
        align={align}
        focus={keyed.current ? 'entry' : 'list'}
        role="menu"
        id={id}
        label={label}
        className={className}
      >
        {header && <div className="mb-1 border-line border-b px-2 pt-1 pb-2">{header}</div>}
        {items.map((item, index) =>
          'divider' in item ? (
            <hr key={`divider-${index}`} className="mx-2 my-1 h-px shrink-0 border-0 bg-white/[0.07]" />
          ) : 'heading' in item ? (
            <div key={`heading-${item.heading}`} role="presentation" className="px-2 pt-1.5 pb-1 font-medium text-[0.6875rem] text-text-faint">
              {item.heading}
            </div>
          ) : (
            <Row
              key={`${index}-${item.label}`}
              role={item.checked === undefined ? 'menuitem' : item.toggle ? 'menuitemcheckbox' : 'menuitemradio'}
              label={item.label}
              detail={item.detail}
              hint={item.hint}
              mark={item.mark}
              checked={item.checked}
              ticks={ticks}
              danger={item.danger}
              warn={item.warn}
              disabled={item.disabled}
              onSelect={() => {
                if (!item.stay) close('key')
                item.onSelect()
              }}
            />
          )
        )}
      </Floating>
    </div>
  )
}
