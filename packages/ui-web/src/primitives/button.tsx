import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from './cn.ts'

const button = cva(
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-medium transition duration-150 ease-soft disabled:opacity-45 active:not-disabled:scale-[0.98]',
  {
    variants: {
      kind: {
        /** The one action a screen is there for. */
        primary: 'bg-accent text-accent-ink shadow-[0_0_24px_-6px_var(--accent)] hover:not-disabled:brightness-110',
        /** A second choice beside the primary one. */
        secondary: 'border border-line-strong bg-raised text-text hover:not-disabled:border-text-faint hover:not-disabled:bg-overlay',
        /** There when wanted, asking for no attention. */
        quiet: 'text-text-soft hover:not-disabled:bg-raised hover:not-disabled:text-text'
      },
      size: {
        sm: 'h-7 rounded-sm px-2.5 text-xs',
        md: 'h-9 rounded-md px-4 text-sm',
        lg: 'h-11 rounded-md px-6 text-[0.9375rem]'
      }
    },
    defaultVariants: { kind: 'secondary', size: 'md' }
  }
)

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {}

export function Button({ kind, size, type = 'button', className, ...rest }: ButtonProps) {
  return <button type={type} className={cn(button({ kind, size }), className)} {...rest} />
}
