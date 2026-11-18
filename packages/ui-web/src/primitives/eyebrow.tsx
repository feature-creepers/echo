import type { ReactNode } from 'react'
import { cn } from './cn.ts'

/** The small label of the interface, in sentence case: a group's name, a field's label, a state. */
export function Eyebrow({ children, className, accent = false }: { children: ReactNode; className?: string | undefined; accent?: boolean }) {
  return <span className={cn('font-medium text-label', accent ? 'text-accent' : 'text-text-faint', className)}>{children}</span>
}
