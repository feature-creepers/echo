import type { ViewSpec } from '@repo/catalog'
import { pinnedOf } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import { AnimatePresence, motion } from 'motion/react'
import { Button } from '../primitives/button.tsx'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { IconButton } from '../primitives/icon-button.tsx'
import { MoreGlyph, PinGlyph } from '../primitives/icons.tsx'
import { Menu } from '../primitives/menu.tsx'
import type { ViewActions } from '../view/context.ts'
import { ViewRenderer } from '../view/view-renderer.tsx'
import type { LibraryControls } from './library-context.ts'

/**
 * The widgets the user pinned, live, in the order they pinned them: drawn again from what was saved, so a
 * pinned radio plays and a pinned chart is as it was. Nothing pinned starts by itself.
 */
export function PinnedList({ controls, actions }: { controls: LibraryControls; actions: ViewActions }) {
  const library = useFollowed(controls.library)
  const pinned = pinnedOf(library)

  if (pinned.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
        <span className="flex size-12 items-center justify-center rounded-full border border-line-strong bg-raised text-accent [&_svg]:size-5">
          <PinGlyph />
        </span>
        <div className="grid gap-1.5">
          <p className="font-medium">Nothing pinned yet</p>
          <p className="text-balance text-sm text-text-soft leading-relaxed">
            Save a view with its bookmark, then pin it: it stays here, live, beside the conversation.
          </p>
        </div>
        <Button size="sm" onClick={() => controls.open()}>
          Open the library
        </Button>
      </div>
    )
  }

  return (
    <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <ol className="grid gap-4">
        <AnimatePresence initial={false}>
          {pinned.map((widget) => (
            <motion.li
              key={widget.id}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: 24, transition: { duration: 0.2 } }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="grid min-w-0 gap-3"
            >
              <header className="-mr-1.5 flex items-center justify-between gap-2 pl-1">
                <Eyebrow accent className="min-w-0 truncate">
                  {widget.title}
                </Eyebrow>
                <Menu
                  trigger={(open, toggle) => (
                    <IconButton label={`More for ${widget.title}`} active={open} onClick={toggle}>
                      <MoreGlyph />
                    </IconButton>
                  )}
                  items={[
                    { label: 'Show on the stage', onSelect: () => void controls.library.show(widget.id).catch(() => undefined) },
                    { label: 'Open in the library', onSelect: () => controls.open(widget.id) },
                    { label: 'Unpin', onSelect: () => void controls.library.update({ widget: widget.id, pinned: false }).catch(() => undefined) }
                  ]}
                />
              </header>
              <div className="min-w-0 rounded-lg border border-line/70 bg-raised/25 p-3.5 text-[0.9375rem] [&_h2]:text-2xl">
                <ViewRenderer spec={widget.spec as ViewSpec} actions={actions} />
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </div>
  )
}
