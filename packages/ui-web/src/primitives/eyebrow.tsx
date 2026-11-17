import type { ReactNode } from 'react'
import { cn } from './cn.ts'

/** The small capitals of the interface: a section's name, a field's label, a state. */
export function Eyebrow({ children, className, accent = false }: { children: ReactNode; className?: string | undefined; accent?: boolean }) {
  return <span className={cn('font-mono text-label uppercase', accent ? 'text-accent' : 'text-text-faint', className)}>{children}</span>
}
