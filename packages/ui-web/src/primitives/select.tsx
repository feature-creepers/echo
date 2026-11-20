import { SelectContent, SelectItem, SelectList, Select as SelectRoot, SelectTrigger, SelectValue } from '@ui-sdk/react/select'
import { cn } from './cn.ts'
import { FLOATING, FLOATING_LIST, FLOATING_SHADOW, GAP, MARGIN, Row, rowClass } from './menu.tsx'

interface SelectOption<Value extends string> {
  value: Value
  label: string
  /** What the choice means, in a few words, shown under it in the list. */
  description?: string | undefined
  /** A word at the end of its row in the list: "Default". */
  hint?: string | undefined
  disabled?: boolean | undefined
}

interface SelectProps<Value extends string> {
  label: string
  value: Value
  options: readonly SelectOption<Value>[]
  onChange(value: Value): void
  className?: string | undefined
  disabled?: boolean | undefined
}

/**
 * The look of a control that opens or records something: a raised field with a hairline, as macOS draws a
 * pop-up button. The select and the shortcut field share it, so the controls of a settings row line up.
 */
export const FIELD =
  'h-7 rounded-md bg-white/[0.08] text-[0.8125rem] text-text shadow-[0_1px_1px_rgb(0_0_0/0.3),inset_0_0_0_0.5px_rgb(255_255_255/0.1),inset_0_1px_0_rgb(255_255_255/0.06)] transition-colors duration-(--duration-quick) ease-soft'

/**
 * One of many, from a list that opens under the field: for choices too many or too long to show at once, such as
 * devices or models. The field shows the choice in force; the list ticks it, and can say what each choice means.
 * Up, down, Enter and Space open it from the keyboard; in it, up and down move, typing goes to a choice by its
 * first letters, Enter picks and Escape closes.
 */
export function Select<Value extends string>({ label, value, options, onChange, className, disabled = false }: SelectProps<Value>) {
  return (
    <SelectRoot<Value>
      value={value}
      onValueChange={(next) => {
        if (next !== null && next !== value) onChange(next)
      }}
      // The field names the choice in force before its list has ever been drawn.
      itemToLabel={(one) => options.find((option) => option.value === one)?.label ?? one}
      placeholder="Choose…"
      disabled={disabled}
    >
      <div className={cn('relative min-w-0', className)}>
        <SelectTrigger
          aria-label={label}
          className={(state) =>
            cn(
              FIELD,
              'flex w-full min-w-0 items-center gap-2 pr-2 pl-2.5 text-left hover:not-disabled:bg-white/[0.11] disabled:opacity-45',
              state.open && 'bg-white/[0.11]'
            )
          }
        >
          <SelectValue className={(state) => cn('min-w-0 flex-1 truncate', state.placeholder && 'text-text-faint')} />
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="size-3.5 shrink-0 text-text-soft"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m5.5 6 2.5-2.5L10.5 6M5.5 10l2.5 2.5 2.5-2.5" />
          </svg>
        </SelectTrigger>
        {/* The list grows leftwards from the field's right edge, so it stays over the row the field sits at the end of. */}
        <SelectContent side="bottom" align="end" sideOffset={GAP} collisionPadding={MARGIN} aria-label={label} className={FLOATING}>
          <span aria-hidden="true" className={FLOATING_SHADOW} />
          <SelectList className={cn(FLOATING_LIST, 'min-w-(--anchor-width) max-w-[19rem]')}>
            {options.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                label={option.label}
                disabled={option.disabled === true}
                className={rowClass({ detail: option.description, disabled: option.disabled })}
              >
                <Row label={option.label} detail={option.description} hint={option.hint} checked={option.value === value} ticks disabled={option.disabled} />
              </SelectItem>
            ))}
          </SelectList>
        </SelectContent>
      </div>
    </SelectRoot>
  )
}
