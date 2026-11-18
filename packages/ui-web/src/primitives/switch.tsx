import { cn } from './cn.ts'

export interface SwitchProps {
  /** What it turns on, for a screen reader: the row's title. */
  label: string
  on: boolean
  onChange(on: boolean): void
  disabled?: boolean
}

/** On or off, taking effect at once: the switch of macOS. */
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
        'relative inline-flex h-[1.375rem] w-[2.375rem] shrink-0 items-center rounded-full transition-colors duration-(--duration-calm) ease-soft disabled:opacity-45',
        'shadow-[inset_0_0_0_1px_rgb(0_0_0/0.25),inset_0_1px_2px_rgb(0_0_0/0.25)]',
        on ? 'bg-accent' : 'bg-white/[0.13] hover:not-disabled:bg-white/[0.17]'
      )}
    >
      {/* The knob, as macOS draws it: white, round, lifted by a small shadow. */}
      <span
        className={cn(
          'absolute top-[0.1875rem] left-[0.1875rem] size-4 rounded-full bg-[#f4f6f9] shadow-[0_1px_2px_rgb(0_0_0/0.4),0_0_0_0.5px_rgb(0_0_0/0.2)] transition-transform duration-(--duration-calm) ease-soft',
          on && 'translate-x-4'
        )}
      />
    </button>
  )
}
