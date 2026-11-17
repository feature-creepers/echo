import { useId } from 'react'
import styles from './text-field.module.css'

export interface TextFieldProps {
  label: string
  value: string
  onChange(value: string): void
  /** What is wrong with the value, in words for the user. Left out when nothing is. */
  problem?: string | undefined
  maxLength?: number
  autoFocus?: boolean
}

/** One line of text with its label. A problem is announced to a screen reader as soon as it appears. */
export function TextField({ label, value, onChange, problem, maxLength, autoFocus }: TextFieldProps) {
  const id = useId()
  const problemId = `${id}-problem`
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={styles.input}
        type="text"
        value={value}
        maxLength={maxLength}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={problem !== undefined}
        aria-describedby={problemId}
        onChange={(event) => onChange(event.target.value)}
      />
      <p id={problemId} className={styles.problem} role="alert">
        {problem}
      </p>
    </div>
  )
}
