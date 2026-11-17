import { cn } from './cn.ts'

export interface SwitchProps {
  /** What it turns on, for a screen reader: the row's title. */
  label: string
  on: boolean
  onChange(on: boolean): void
  disabled?: boolean
}

/** On or off, taking effect at once. */
export function Switch({ label, on, onChange, disabled = false }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn(
        'relative inline-flex h-5 w-8.5 shrink-0 items-center rounded-full border transition duration-(--duration-calm) ease-soft disabled:opacity-45',
        on ? 'border-accent/60 bg-accent/20' : 'border-line-strong bg-raised hover:not-disabled:border-text-faint/60'
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 size-3.5 rounded-full transition-[translate,background-color] duration-(--duration-calm) ease-soft',
          on ? 'translate-x-3.5 bg-accent' : 'bg-text-faint'
        )}
      />
    </button>
  )
}
