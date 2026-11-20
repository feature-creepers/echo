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
 * One of a few, as a segmented control: every option in sight, side by side in one trough, the chosen one on a
 * raised segment that slides to the next choice. The arrow keys move between them.
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
      className="inline-flex max-w-full flex-wrap rounded-md bg-white/[0.06] p-0.5 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.04)]"
    >
      {options.map((option) => (
        <SegmentedControlItem
          key={option.value}
          value={String(option.value)}
          className={(state) =>
            cn(
              'relative h-6 rounded-sm px-3 text-xs transition-colors duration-(--duration-quick) ease-soft',
              state.checked ? 'text-text' : 'text-text-soft hover:text-text'
            )
          }
        >
          {(state) => (
            <>
              {/* The raised segment follows the choice on a spring, which a CSS transition cannot. */}
              {state.checked && (
                <motion.span
                  layoutId={`${group}-chosen`}
                  transition={glide}
                  className="absolute inset-0 rounded-sm bg-white/[0.13] shadow-[0_1px_2px_rgb(0_0_0/0.35),inset_0_1px_0_rgb(255_255_255/0.06)]"
                />
              )}
              <span className="relative">{option.label}</span>
            </>
          )}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  )
}
