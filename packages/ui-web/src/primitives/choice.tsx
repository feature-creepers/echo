import { motion } from 'motion/react'
import { useId } from 'react'
import { glide } from '../styles/motion.ts'
import { cn } from './cn.ts'

export interface ChoiceProps<Value extends string | number> {
  /** What is being chosen, for a screen reader. */
  label: string
  value: Value
  options: readonly { value: Value; label: string }[]
  onChange(value: Value): void
}

/**
 * One of a few, as a segmented control: every option in sight, side by side in one trough, the chosen one on a
 * raised segment that slides to the next choice.
 */
export function Choice<Value extends string | number>({ label, value, options, onChange }: ChoiceProps<Value>) {
  const group = useId()
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex max-w-full flex-wrap rounded-md bg-white/[0.06] p-0.5 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.04)]"
    >
      {options.map((option) => (
        // biome-ignore lint/a11y/useSemanticElements: a segmented control reads better than radio buttons, and says the same to a screen reader
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'relative h-6 rounded-sm px-3 text-xs transition-colors duration-(--duration-quick) ease-soft',
            value === option.value ? 'text-text' : 'text-text-soft hover:text-text'
          )}
        >
          {value === option.value && (
            <motion.span
              layoutId={`${group}-chosen`}
              transition={glide}
              className="absolute inset-0 rounded-sm bg-white/[0.13] shadow-[0_1px_2px_rgb(0_0_0/0.35),inset_0_1px_0_rgb(255_255_255/0.06)]"
            />
          )}
          <span className="relative">{option.label}</span>
        </button>
      ))}
    </div>
  )
}
