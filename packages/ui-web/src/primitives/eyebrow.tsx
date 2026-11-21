import type { ReactNode } from 'react'
import { cn } from './cn.ts'

/** The small label of the interface, in capitals in the pixel face: a group's name, a field's label, a state. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return <span className={cn('caps text-text-soft', className)}>{children}</span>
}
