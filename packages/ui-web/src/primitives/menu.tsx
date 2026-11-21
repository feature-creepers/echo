import {
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  Menu as MenuRoot,
  MenuSeparator,
  MenuTrigger,
  type MenuTriggerState
} from '@ui-sdk/react/menu'
import { Fragment, type MouseEvent, type ReactElement, type ReactNode } from 'react'
import { cn } from './cn.ts'
import { CheckGlyph } from './icons.tsx'

/**
 * A list floating over everything, against what opened it: the panel of a menu, the options of a select. Shown in
 * the top layer, so no panel or scroll area around its opener cuts it, and in place, so it carries the accent of
 * where it was opened. It rises 3 px towards its opener and grows from 97 % as it fades in; its shadow and its plane
 * fade with it.
 */
export const FLOATING = cn(
  'no-drag group/floating outline-none max-w-[calc(100vw-1rem)] origin-(--transform-origin) [--list-height:var(--available-height)]',
  'transition-transform duration-(--duration-quick) ease-soft data-starting-style:scale-97 data-ending-style:scale-97',
  'data-[side=bottom]:data-starting-style:-translate-y-[3px] data-[side=bottom]:data-ending-style:-translate-y-[3px]',
  'data-[side=top]:data-starting-style:translate-y-[3px] data-[side=top]:data-ending-style:translate-y-[3px]'
)

const FADING =
  'transition-opacity duration-(--duration-quick) ease-soft group-data-starting-style/floating:opacity-0 group-data-ending-style/floating:opacity-0'

/** The shadow under a floating list, a layer of its own so it fades with the plane. */
export const FLOATING_SHADOW = cn('pointer-events-none absolute inset-0 shadow-float', FADING)

/** The plane of a floating list, never taller than the room the window leaves it. */
export const FLOATING_LIST = cn('material scroll-quiet relative grid max-h-(--list-height) min-w-48 overflow-y-auto overscroll-contain p-1', FADING)

/** The space kept between a floating list and what opens it, and between the list and the window's edges. */
export const GAP = 4
export const MARGIN = 8

interface RowLook {
  /** A second line under the label, quieter: what the choice means. */
  detail?: ReactNode | undefined
  /** Something that cannot be undone, in the danger colour. */
  danger?: boolean | undefined
  disabled?: boolean | undefined
}

/** The look of one entry of a floating list, lit while the pointer or the keyboard is on it: one entry at a time. */
export function rowClass({ detail, danger, disabled }: RowLook): string {
  return cn(
    'flex w-full min-w-0 gap-2 px-2 text-left outline-none transition-colors duration-75',
    detail ? 'items-start py-1.5' : 'min-h-6 items-center py-[3px]',
    disabled ? 'cursor-default' : danger ? 'cursor-pointer data-highlighted:bg-danger/12' : 'cursor-pointer data-highlighted:bg-text/[0.08]'
  )
}

interface RowProps extends RowLook {
  label: string
  /** Something at the end of the row: a state, a word on why it cannot be picked. */
  hint?: ReactNode | undefined
  /** A small mark before the label: a dot that says how something stands. */
  mark?: ReactNode | undefined
  /** Ticked: the choice in force. Left out, the row is an action, not a choice. */
  checked?: boolean | undefined
  /** Room is kept for a tick, so the labels of a list line up whether or not each row is a choice. */
  ticks?: boolean
  /** A choice that gives a lot away, with its detail in the warning colour. */
  warn?: boolean | undefined
}

/** What one entry of a floating list shows: a tick for the choice in force, a mark, its label, what it means and a hint. */
export function Row({ label, detail, hint, mark, checked, ticks = false, danger, warn, disabled }: RowProps) {
  return (
    <>
      {ticks && <span className={cn('flex w-3 shrink-0 justify-center text-text', detail && 'pt-[3px]')}>{checked && <CheckGlyph size={12} />}</span>}
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
    </>
  )
}

interface MenuItemEntry {
  label: string
  onSelect(): void
  detail?: ReactNode
  hint?: ReactNode
  mark?: ReactNode
  /** One of a group of choices: ticked when it is the one in force. */
  checked?: boolean
  danger?: boolean
  warn?: boolean
  /** Shown, but cannot be picked: its hint says why. */
  disabled?: boolean
  /** The menu stays open once it is picked: for a choice that changes what the menu shows below it. */
  stay?: boolean
}

/** The name over a group of entries. */
interface MenuHeading {
  heading: string
}

/** A hairline between two groups. */
interface MenuDivider {
  divider: true
}

export type MenuEntry = MenuItemEntry | MenuHeading | MenuDivider

/** The entries between two dividers or headings: one group, named by its heading, whose choices are one choice. */
interface MenuSection {
  heading: string | undefined
  /** A hairline goes above it. */
  divided: boolean
  /** Each entry with its key, its place in the menu. */
  entries: { key: string; item: MenuItemEntry }[]
}

/** The groups a menu's entries make: a divider or a heading starts the next, and a heading names the one it starts. */
export function sectionsOf(items: readonly MenuEntry[]): MenuSection[] {
  const sections: MenuSection[] = []
  items.forEach((item, index) => {
    const last = sections.at(-1)
    if ('divider' in item) sections.push({ heading: undefined, divided: true, entries: [] })
    else if ('heading' in item) {
      if (last && last.heading === undefined && last.entries.length === 0) last.heading = item.heading
      else sections.push({ heading: item.heading, divided: false, entries: [] })
    } else if (last) last.entries.push({ key: String(index), item })
    else sections.push({ heading: undefined, divided: false, entries: [{ key: String(index), item }] })
  })
  return sections
}

/** What the button that opens a menu is given to spread on it: its role, its state and its handlers. */
type MenuTriggerProps = Record<string, unknown> & {
  /** Opens and closes the menu: a button that does more on a press calls it too. */
  onClick?(event: MouseEvent<HTMLElement>): void
}

interface MenuProps {
  /** The button that opens it, given the props to spread on it and whether the menu is open. */
  trigger(props: MenuTriggerProps, state: MenuTriggerState): ReactElement
  items: readonly MenuEntry[]
  /** Which side of the trigger it lines up with. */
  align?: 'start' | 'end'
  /** Which side of the trigger it opens on: below, or above for a trigger at the bottom of the window. */
  side?: 'top' | 'bottom'
  /** Something above the items: a word on what they apply to. */
  header?: ReactNode
  /** What the menu is, for a screen reader. */
  label?: string
  /** The panel's width, when the entries need more than the least. */
  className?: string
}

/**
 * A few actions or choices under a button, floating over everything. It closes on a choice, on Escape, on a press
 * anywhere else and when the window loses focus, and gives the keyboard back to its button. Up, Down, Home, End and
 * first letters move between its entries.
 */
export function Menu({ trigger, items, align = 'end', side = 'bottom', header, label, className }: MenuProps) {
  const ticks = items.some((item) => 'label' in item && item.checked !== undefined)
  // A choice returns nothing to the menu: a Promise returned would hold the menu open until it settles.
  const choose = (item: MenuItemEntry | undefined) => {
    item?.onSelect()
  }
  const row = (key: string, item: MenuItemEntry) => {
    const look = { className: rowClass(item), label: item.label, disabled: item.disabled === true, closeOnSelect: item.stay !== true }
    const parts = (
      <Row
        label={item.label}
        detail={item.detail}
        hint={item.hint}
        mark={item.mark}
        checked={item.checked}
        ticks={ticks}
        danger={item.danger}
        warn={item.warn}
        disabled={item.disabled}
      />
    )
    return item.checked === undefined ? (
      <MenuItem key={key} {...look} destructive={item.danger === true} onSelect={() => choose(item)}>
        {parts}
      </MenuItem>
    ) : (
      <MenuRadioItem key={key} value={key} {...look}>
        {parts}
      </MenuRadioItem>
    )
  }

  return (
    <MenuRoot>
      <MenuTrigger render={trigger} />
      <MenuContent side={side} align={align} sideOffset={GAP} collisionPadding={MARGIN} aria-label={label} className={FLOATING}>
        <span aria-hidden="true" className={FLOATING_SHADOW} />
        <div className={cn(FLOATING_LIST, className)}>
          {header && <div className="mb-1 border-line border-b px-2 pt-1 pb-2">{header}</div>}
          {sectionsOf(items).map((section, index) => {
            const heading = section.heading && <MenuGroupLabel className="caps px-2 pt-1.5 pb-1 text-text-faint">{section.heading}</MenuGroupLabel>
            const choices = section.entries.some(({ item }) => item.checked !== undefined)
            const chosen = section.entries.find(({ item }) => item.checked === true)
            return (
              <Fragment key={index}>
                {section.divided && <MenuSeparator className="my-1 h-px shrink-0 bg-line" />}
                {choices ? (
                  <MenuRadioGroup
                    className="contents"
                    value={chosen?.key ?? null}
                    onValueChange={(key) => choose(section.entries.find((entry) => entry.key === key)?.item)}
                  >
                    {heading}
                    {section.entries.map(({ key, item }) => row(key, item))}
                  </MenuRadioGroup>
                ) : (
                  <MenuGroup className="contents">
                    {heading}
                    {section.entries.map(({ key, item }) => row(key, item))}
                  </MenuGroup>
                )}
              </Fragment>
            )
          })}
        </div>
      </MenuContent>
    </MenuRoot>
  )
}
