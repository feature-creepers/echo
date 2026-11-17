import { cn } from './cn.ts'

export interface SelectProps {
  label: string
  value: string
  options: readonly { value: string; label: string }[]
  onChange(value: string): void
  className?: string
}

/** One of many, from a list that opens: for choices too long to show at once, such as devices. */
export function Select({ label, value, options, onChange, className }: SelectProps) {
  return (
    <div className={cn('relative min-w-0', className)}>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-7 w-full min-w-0 cursor-pointer appearance-none truncate rounded-md bg-white/[0.08] pr-8 pl-2.5 text-[0.8125rem] text-text shadow-[0_1px_1px_rgb(0_0_0/0.3),inset_0_0_0_0.5px_rgb(255_255_255/0.1),inset_0_1px_0_rgb(255_255_255/0.06)] transition-colors duration-(--duration-quick) ease-soft hover:bg-white/[0.11]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-text-soft"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m5.5 6 2.5-2.5L10.5 6M5.5 10l2.5 2.5 2.5-2.5" />
      </svg>
    </div>
  )
}
