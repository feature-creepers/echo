import type { Exchange } from '@repo/protocol'
import { FolderGlyph, PaperclipGlyph } from '../files/glyphs.tsx'

/** What the person handed over with something said, as the transcript shows it: each name, a folder marked as one. */
export function AttachedLine({ attached }: { attached: Exchange['attached'] }) {
  if (!attached || attached.length === 0) return null
  return (
    <ul aria-label="Handed over" className="flex flex-wrap gap-1">
      {attached.map((one, index) => (
        <li
          key={`${one.name}-${index}`}
          className="flex h-5 max-w-full items-center gap-1 rounded-xs bg-white/[0.05] px-1.5 text-[0.6875rem] text-text-soft [&_svg]:size-3 [&_svg]:shrink-0"
        >
          {one.kind === 'folder' ? <FolderGlyph /> : <PaperclipGlyph />}
          <span className="truncate">{one.name}</span>
        </li>
      ))}
    </ul>
  )
}
