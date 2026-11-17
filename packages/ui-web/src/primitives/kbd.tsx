import type { ReactNode } from 'react'
import { cn } from './cn.ts'

/** A key of the keyboard, shown as a hint beside what it does. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-xs border border-line-strong bg-raised px-1 text-[0.625rem] text-text-soft leading-none shadow-[inset_0_-1px_0_rgb(255_255_255/0.05)]',
        className
      )}
    >
      {children}
    </kbd>
  )
}
