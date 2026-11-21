import { SegmentedControl, SegmentedControlItem } from '@ui-sdk/react/segmented-control'
import { motion } from 'motion/react'
import { useId } from 'react'
import { glide } from '../styles/motion.ts'
import { cn } from './cn.ts'

interface ChoiceProps<Value extends string | number> {
  /** What is being chosen, for a screen reader. */
  label: string
  value: Value
  options: readonly { value: Value; label: string }[]
  onChange(value: Value): void
}

/**
 * One of a few, as a segmented control: every option in sight, side by side inside one line, the chosen one on a
 * plane of the ink that slides to the next choice. The arrow keys move between them.
 */
export function Choice<Value extends string | number>({ label, value, options, onChange }: ChoiceProps<Value>) {
  const group = useId()
  return (
    <SegmentedControl
      aria-label={label}
      // Its items are named by text, so a number is chosen by the words it is written in.
      value={String(value)}
      onValueChange={(chosen) => {
        const option = options.find((one) => String(one.value) === chosen)
        if (option) onChange(option.value)
      }}
      className="inline-flex max-w-full flex-wrap shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
    >
      {options.map((option) => (
        <SegmentedControlItem
          key={option.value}
          value={String(option.value)}
          className={(state) =>
            cn(
              'caps relative h-7 px-3 transition-colors duration-(--duration-quick) ease-soft',
              state.checked ? 'text-ground' : 'text-text-soft hover:text-text'
            )
          }
        >
          {(state) => (
            <>
              {/* The plane follows the choice on a spring, which a CSS transition cannot. */}
              {state.checked && <motion.span layoutId={`${group}-chosen`} transition={glide} className="absolute inset-0 bg-text" />}
              <span className="relative">{option.label}</span>
            </>
          )}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  )
}
