import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from './cn.ts'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** What the button does, for a screen reader and as the tooltip. */
  label: string
  children: ReactNode
  /**
   * Given, the button is a toggle, shown and announced as pressed while what it opens is open. Left out, it is a
   * plain button, so a screen reader does not call every glyph a toggle.
   */
  active?: boolean
}

/** A button that is only a glyph. Its label says what it does. */
export function IconButton({ label, active, className, children, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-text-soft transition duration-(--duration-quick) ease-soft hover:bg-white/[0.07] hover:text-text active:bg-white/[0.1] aria-pressed:bg-white/[0.09] aria-pressed:text-text',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
