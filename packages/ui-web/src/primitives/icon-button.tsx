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
        'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-text-faint transition duration-(--duration-quick) ease-soft hover:bg-white/[0.05] hover:text-text aria-pressed:bg-white/[0.06] aria-pressed:text-text',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
