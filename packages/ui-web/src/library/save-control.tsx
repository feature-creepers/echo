import { savedAs } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { IconButton } from '../primitives/icon-button.tsx'
import { BookmarkGlyph } from '../primitives/icons.tsx'
import { Menu } from '../primitives/menu.tsx'
import { type LibraryControls, useLibraryControls } from './library-context.ts'

/** A view as the control needs it: which one it is, and the saved widget it shows again, if any. */
interface Saveable {
  id: string
  widget?: string | undefined
  spec?: unknown
}

/** A view that asks the person something (a choice to make, an approval) is a moment, not a widget to keep. */
const asks = (spec: unknown) =>
  Object.values((spec as { elements?: Record<string, { type?: string }> } | undefined)?.elements ?? {}).some((element) => element.type === 'Choice')

/**
 * The bookmark on every view: one press saves it to the library. Once saved, the same place holds what to do
 * with it: pin it to the main screen, open it among the library's widgets, or take it out.
 */
export function SaveControl({ view }: { view: Saveable }) {
  const controls = useLibraryControls()
  return controls && !asks(view.spec) ? <Control view={view} controls={controls} /> : null
}

function Control({ view, controls }: { view: Saveable; controls: LibraryControls }) {
  const library = useFollowed(controls.library)
  const saved = savedAs(library, view)
  const [just, setJust] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!just) return
    const timer = setTimeout(() => setJust(false), 1800)
    return () => clearTimeout(timer)
  }, [just])

  if (!saved) {
    return (
      <IconButton
        label={failed ? 'Could not save. Try again' : 'Save to the library'}
        onClick={() => {
          setFailed(false)
          controls.library.save(view.id).then(
            () => setJust(true),
            () => setFailed(true)
          )
        }}
        className={failed ? 'text-danger' : undefined}
      >
        <BookmarkGlyph />
      </IconButton>
    )
  }

  const act = (work: Promise<unknown>) => void work.catch(() => undefined)
  return (
    <div className="flex items-center">
      <AnimatePresence>
        {just && (
          <motion.span initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="mr-1 text-[0.6875rem] text-text-soft">
            Saved
          </motion.span>
        )}
      </AnimatePresence>
      <Menu
        header={
          <span className="grid gap-0.5">
            <span className="text-label text-text-faint">In your library</span>
            <span className="truncate text-sm">{saved.title}</span>
          </span>
        }
        trigger={(open, toggle, trigger) => (
          <IconButton label="Saved in the library" active={open} onClick={toggle} className="text-text-soft" {...trigger.props}>
            <BookmarkGlyph filled />
          </IconButton>
        )}
        items={[
          saved.pinned
            ? { label: 'Unpin from the main screen', onSelect: () => act(controls.library.update({ widget: saved.id, pinned: false })) }
            : { label: 'Pin to the main screen', onSelect: () => act(controls.library.update({ widget: saved.id, pinned: true })) },
          { label: 'Open in library', onSelect: () => controls.open(saved.id) },
          { label: 'Remove from the library', danger: true, onSelect: () => act(controls.library.remove(saved.id)) }
        ]}
      />
    </div>
  )
}
