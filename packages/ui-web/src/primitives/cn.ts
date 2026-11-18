import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * The merge has to know the sizes the theme adds: without this, `text-label` would be taken for a colour
 * and dropped whenever a text colour follows it.
 */
const merge = extendTailwindMerge({ extend: { classGroups: { 'font-size': [{ text: ['label'] }] } } })

/** Join class names, dropping the ones whose condition is false, and let a later utility win over an earlier one. */
export function cn(...classes: ClassValue[]): string {
  return merge(clsx(classes))
}
