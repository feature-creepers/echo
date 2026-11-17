import { cn } from './cn.ts'

export interface ChoiceProps<Value extends string | number> {
  /** What is being chosen, for a screen reader. */
  label: string
  value: Value
  options: readonly { value: Value; label: string }[]
  onChange(value: Value): void
}

/** One of a few, as a row of pills: every option in sight, the chosen one lit. */
export function Choice<Value extends string | number>({ label, value, options, onChange }: ChoiceProps<Value>) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => (
        // biome-ignore lint/a11y/useSemanticElements: a row of pills reads better than radio buttons, and says the same to a screen reader
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'h-8 rounded-full border px-3.5 text-xs transition duration-150 ease-soft',
            value === option.value
              ? 'border-accent/60 bg-accent/10 text-text shadow-[0_0_18px_-8px_var(--accent)]'
              : 'border-line-strong text-text-soft hover:border-text-faint hover:text-text'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
