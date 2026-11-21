import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Join class names, dropping the ones whose condition is false, and let a later utility win over an earlier one. */
export function cn(...classes: ClassValue[]): string {
  return twMerge(clsx(classes))
}
