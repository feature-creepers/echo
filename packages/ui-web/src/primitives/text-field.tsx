import { useId } from 'react'
import { cn } from './cn.ts'
import { Eyebrow } from './eyebrow.tsx'

export interface TextFieldProps {
  label: string
  value: string
  onChange(value: string): void
  /** What is wrong with the value, in words for the user. Left out when nothing is. */
  problem?: string | undefined
  maxLength?: number
  /** Take the keyboard when the screen opens: for the first field of a screen that exists to be typed in. */
  first?: boolean
  className?: string
}

/** One line of text with its label. A problem is announced to a screen reader as soon as it appears. */
export function TextField({ label, value, onChange, problem, maxLength, first = false, className }: TextFieldProps) {
  const id = useId()
  const problemId = `${id}-problem`
  return (
    <div className={cn('grid gap-1.5', className)}>
      <label htmlFor={id}>
        <Eyebrow>{label}</Eyebrow>
      </label>
      <input
        id={id}
        type="text"
        value={value}
        maxLength={maxLength}
        // biome-ignore lint/a11y/noAutofocus: only ever the first field of a screen that exists to be typed in
        autoFocus={first}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={problem !== undefined}
        aria-describedby={problemId}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-line-strong bg-ground px-3 text-base text-text outline-none transition duration-(--duration-quick) ease-soft placeholder:text-text-faint focus-visible:border-accent/70 focus-visible:outline-none aria-invalid:border-danger"
      />
      <p id={problemId} role="alert" className="min-h-5 text-danger text-xs">
        {problem}
      </p>
    </div>
  )
}
