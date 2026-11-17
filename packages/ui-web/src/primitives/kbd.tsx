import type { ReactNode } from 'react'
import { cn } from './cn.ts'

/** A key of the keyboard, shown as a hint beside what it does. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-line-strong bg-raised px-1.5 font-mono text-[0.625rem] text-text-soft leading-none',
        className
      )}
    >
      {children}
    </kbd>
  )
}
