import { useId } from 'react'
import { cn } from './cn.ts'
import { Eyebrow } from './eyebrow.tsx'

interface TextFieldProps {
  label: string
  value: string
  onChange(value: string): void
  /** What is wrong with the value, in words for the user. Left out when nothing is. */
  problem?: string | undefined
  maxLength?: number
  /** Take the keyboard when the screen opens: for the first field of a screen that exists to be typed in. */
  first?: boolean
  /**
   * Put what is typed in the form the value takes (capitals, for instance), as it is typed. It must keep the
   * length of what it is given, so the caret stays where the user is typing.
   */
  transform?: (typed: string) => string
  className?: string
}

/** One line of text with its label. A problem is announced to a screen reader as soon as it appears. */
export function TextField({ label, value, onChange, problem, maxLength, first = false, transform, className }: TextFieldProps) {
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
        onChange={(event) => {
          const field = event.target
          const typed = transform ? transform(field.value) : field.value
          if (typed !== field.value && typed.length === field.value.length) {
            // Written back with the caret where it was, so the field already shows what the state will hold.
            const [start, end] = [field.selectionStart, field.selectionEnd]
            field.value = typed
            field.setSelectionRange(start, end)
          }
          onChange(typed)
        }}
        className="h-9 w-full border border-line-strong bg-surface px-3 text-sm text-text transition-colors duration-(--duration-quick) ease-soft placeholder:text-text-faint focus-visible:border-text focus-visible:outline-none aria-invalid:border-danger"
      />
      <p id={problemId} role="alert" className="min-h-5 text-danger text-xs">
        {problem}
      </p>
    </div>
  )
}
