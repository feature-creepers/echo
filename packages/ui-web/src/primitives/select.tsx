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
        className="h-8 w-full min-w-0 cursor-pointer appearance-none truncate rounded-md border border-line-strong bg-ground pr-8 pl-2.5 text-[0.8125rem] text-text outline-none transition duration-(--duration-quick) ease-soft hover:border-text-faint/60 focus-visible:border-accent/70 focus-visible:outline-none"
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
        className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-text-faint"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
      </svg>
    </div>
  )
}
