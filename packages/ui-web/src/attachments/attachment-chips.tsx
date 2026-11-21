import { AnimatePresence, motion } from 'motion/react'
import { FolderGlyph } from '../files/glyphs.tsx'
import { badgeOf, kindOf } from '../files/kinds.ts'
import { sizeWords } from '../files/words.ts'
import { cn } from '../primitives/cn.ts'
import { CloseGlyph } from '../primitives/icons.tsx'
import { DURATION, EASE } from '../styles/motion.ts'
import type { Pending } from './use-attachments.ts'

/** What a waiting file says under its name: how far it is on its way, or what it is. */
function detailOf(pending: Pending): string {
  if (pending.state === 'failed') return 'Could not be sent'
  if (pending.kind === 'folder') return 'Folder · read only'
  const kind = pending.kind === 'image' ? 'Image' : kindOf(pending.name).label
  return pending.size === undefined ? kind : `${kind} · ${sizeWords(pending.size)}`
}

/**
 * The files and folders waiting to go with the next message, in a row along the top of the composer: a picture's
 * own look or the mark of its kind, its name, what it is and its size, and a cross to take it back. A thin line in
 * the accent runs along the bottom of each while it is on its way.
 */
export function AttachmentChips({ pending, onRemove }: { pending: readonly Pending[]; onRemove(key: string): void }) {
  return (
    // A row too long for the composer scrolls sideways, and fades where it is cut.
    <ul
      aria-label="Files to send"
      className="scroll-none flex gap-1.5 overflow-x-auto px-1.5 pt-1.5 [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)]"
    >
      <AnimatePresence initial={false}>
        {pending.map((one) => (
          <motion.li
            key={one.key}
            layout="position"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96, transition: { duration: DURATION.quick, ease: EASE } }}
            transition={{ duration: DURATION.calm, ease: EASE }}
            className="group relative flex h-11 w-[12.5rem] max-w-[12.5rem] shrink-0 items-center gap-2.5 overflow-hidden bg-text/[0.045] pr-1.5 pl-1.5 shadow-[inset_0_0_0_1px_rgb(235_230_218/0.07)]"
          >
            <Thumbnail pending={one} />
            <span className="grid min-w-0 flex-1 leading-tight">
              <span className={cn('truncate text-[0.75rem]', one.state === 'failed' ? 'text-danger' : 'text-text')} title={one.name}>
                {one.name}
              </span>
              <span className="truncate text-[0.6875rem] text-text-faint">{detailOf(one)}</span>
            </span>
            <button
              type="button"
              aria-label={`Remove ${one.name}`}
              title="Remove"
              onClick={() => onRemove(one.key)}
              className={cn(
                'flex size-5 shrink-0 items-center justify-center text-text-faint transition duration-(--duration-quick) ease-soft hover:bg-text/[0.08] hover:text-text focus-visible:opacity-100 group-hover:opacity-100 [&_svg]:size-3',
                one.state === 'failed' ? 'opacity-100' : 'opacity-0'
              )}
            >
              <CloseGlyph />
            </button>
            {one.state === 'sending' && (
              <span
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-[2px] origin-left bg-accent/70 transition-transform duration-(--duration-calm) ease-soft"
                style={{ transform: `scaleX(${Math.max(0.04, one.progress)})` }}
              />
            )}
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  )
}

function Thumbnail({ pending }: { pending: Pending }) {
  if (pending.thumbnail) return <img src={pending.thumbnail} alt="" className="size-8 shrink-0 object-cover shadow-[0_0_0_1px_rgb(235_230_218/0.08)]" />
  if (pending.kind === 'folder')
    return (
      <span className="flex size-8 shrink-0 items-center justify-center bg-text/[0.04] text-text-soft [&_svg]:size-4">
        <FolderGlyph />
      </span>
    )
  return (
    <span className="flex size-8 shrink-0 items-center justify-center bg-text/[0.04] font-mono text-[0.5625rem] text-text-soft uppercase shadow-[inset_0_0_0_1px_rgb(235_230_218/0.08)]">
      {badgeOf(pending.name)}
    </span>
  )
}
