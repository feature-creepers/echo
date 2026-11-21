import type { ReactNode } from 'react'
import { cn } from './cn.ts'

/** A key of the keyboard, as a small square drawn as a line: as a hint beside what it does, and in a shortcut field. */
export function Kbd({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return (
    <kbd
      className={cn(
        'caps inline-flex h-5 min-w-5 items-center justify-center px-1 text-text-soft shadow-[inset_0_0_0_1px_var(--color-line-strong)]',
        className
      )}
    >
      {children}
    </kbd>
  )
}
