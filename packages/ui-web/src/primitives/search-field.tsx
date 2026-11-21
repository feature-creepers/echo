import { cn } from './cn.ts'
import { SearchGlyph } from './icons.tsx'

interface SearchFieldProps {
  value: string
  onChange(value: string): void
  /** What it finds, in a few words, shown while it is empty. */
  placeholder: string
  /** What it finds, said in full to a screen reader. */
  label: string
  className?: string | undefined
}

/**
 * A field that narrows a list as the person types, at the top of the list it finds in. Escape empties it first, and
 * only then reaches the rest of the window, so the one key does not also close the surface around it.
 */
export function SearchField({ value, onChange, placeholder, label, className }: SearchFieldProps) {
  return (
    <label
      className={cn(
        'flex h-7 min-w-0 flex-1 items-center gap-2 px-2.5 text-text-faint shadow-[inset_0_0_0_1px_var(--color-line)] transition-shadow duration-(--duration-quick) focus-within:text-text-soft focus-within:shadow-[inset_0_0_0_1px_var(--color-text)] [&_svg]:size-3.5',
        className
      )}
    >
      <SearchGlyph />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || value === '') return
          event.preventDefault()
          event.stopPropagation()
          onChange('')
        }}
        placeholder={placeholder}
        aria-label={label}
        className="min-w-0 flex-1 bg-transparent text-[0.8125rem] text-text outline-none placeholder:text-text-faint focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
    </label>
  )
}
