import { Switch as SwitchRoot, SwitchThumb } from '@ui-sdk/react/switch'
import { cn } from './cn.ts'

interface SwitchProps {
  /** What it turns on, for a screen reader: the row's title. */
  label: string
  on: boolean
  onChange(on: boolean): void
  disabled?: boolean
}

/**
 * On or off, taking effect at once: a square knob in a track drawn as a line. On, the track is a plane of the ink
 * and the knob is cut out of it.
 */
export function Switch({ label, on, onChange, disabled = false }: SwitchProps) {
  return (
    <SwitchRoot
      checked={on}
      onCheckedChange={onChange}
      aria-label={label}
      disabled={disabled}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center transition-colors duration-(--duration-calm) ease-soft disabled:opacity-45',
        on ? 'bg-text' : 'shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:not-disabled:bg-text/[0.08]'
      )}
    >
      <SwitchThumb
        className={cn(
          'absolute top-1 left-1 size-3 transition-[transform,background-color] duration-(--duration-calm) ease-soft',
          on ? 'translate-x-4 bg-ground' : 'bg-text-soft'
        )}
      />
    </SwitchRoot>
  )
}
