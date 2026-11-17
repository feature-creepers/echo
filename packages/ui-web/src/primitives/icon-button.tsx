import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from './cn.ts'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** What the button does, for a screen reader and as the tooltip. */
  label: string
  children: ReactNode
  /** Shown as pressed: the thing it opens is open. */
  active?: boolean
}

/** A button that is only a glyph. Its label says what it does. */
export function IconButton({ label, active = false, className, children, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-sm text-text-faint transition duration-150 ease-soft hover:bg-raised hover:text-text aria-pressed:bg-raised aria-pressed:text-accent',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
