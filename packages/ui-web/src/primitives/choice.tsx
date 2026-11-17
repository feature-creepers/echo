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
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        // biome-ignore lint/a11y/useSemanticElements: a row of pills reads better than radio buttons, and says the same to a screen reader
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'h-7 rounded-md border px-3 text-xs transition duration-(--duration-quick) ease-soft',
            value === option.value ? 'border-accent/50 bg-accent/10 text-text' : 'border-line-strong text-text-soft hover:border-text-faint hover:text-text'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
