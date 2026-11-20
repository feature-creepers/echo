import { cn } from '../primitives/cn.ts'

/** A path shown in full when it fits, and by its end when it does not: the end says which file or folder it is. */
export function PathText({ path, className }: { path: string; className?: string }) {
  return (
    <span dir="rtl" title={path} className={cn('block truncate text-left font-mono text-text-soft text-xs', className)}>
      <bdi>{path}</bdi>
    </span>
  )
}
