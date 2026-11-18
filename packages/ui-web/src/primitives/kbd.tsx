import type { ReactNode } from 'react'
import { cn } from './cn.ts'

/**
 * A key of the keyboard, as a small quiet keycap in the interface's own face: as a hint beside what it does,
 * and in a shortcut field. The page's default would set it in the monospace face.
 */
export function Kbd({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-xs bg-white/[0.07] px-1 font-sans text-[0.625rem] text-text-soft leading-none shadow-[inset_0_0_0_0.5px_rgb(255_255_255/0.12),0_1px_0_rgb(0_0_0/0.3)]',
        className
      )}
    >
      {children}
    </kbd>
  )
}
