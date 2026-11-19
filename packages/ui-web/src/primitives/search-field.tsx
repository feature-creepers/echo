import { SearchGlyph } from './icons.tsx'

export interface SearchFieldProps {
  value: string
  onChange(value: string): void
  /** What it finds, in a few words, shown while it is empty. */
  placeholder: string
  /** What it finds, said in full to a screen reader. */
  label: string
}

/**
 * A field that narrows a list as the person types, at the top of the list it finds in. Escape empties it first, and
 * only then reaches the rest of the window, so the one key does not also close the surface around it.
 */
export function SearchField({ value, onChange, placeholder, label }: SearchFieldProps) {
  return (
    <label className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md bg-white/[0.06] px-2.5 text-text-faint shadow-[inset_0_0_0_0.5px_rgb(255_255_255/0.08)] transition-shadow duration-(--duration-quick) focus-within:text-text-soft focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_55%,transparent)] [&_svg]:size-3.5">
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
