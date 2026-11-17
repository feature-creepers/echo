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
        'relative inline-flex h-5.5 w-9.5 shrink-0 items-center rounded-full border transition duration-200 ease-soft disabled:opacity-45',
        on ? 'border-accent/70 bg-accent/25 shadow-[0_0_16px_-6px_var(--accent)]' : 'border-line-strong bg-raised hover:not-disabled:border-text-faint'
      )}
    >
      <span
        className={cn(
          'absolute top-1/2 size-3.5 -translate-y-1/2 rounded-full transition-[left,background-color,box-shadow] duration-200 ease-soft',
          on ? 'left-[calc(100%-1.125rem)] bg-accent shadow-[0_0_8px_var(--accent)]' : 'left-[0.1875rem] bg-text-faint'
        )}
      />
    </button>
  )
}
