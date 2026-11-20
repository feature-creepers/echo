import { type Client, runsWhenOpened } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import type { WorkspaceEntry } from '@repo/protocol'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { lastPart } from '../changes/words.ts'
import { Button } from '../primitives/button.tsx'
import { IconButton } from '../primitives/icon-button.tsx'
import { CloseGlyph } from '../primitives/icons.tsx'
import { DURATION, EASE } from '../styles/motion.ts'
import { peeked, saveCopy, useFileActions } from './file-actions.ts'
import { FileContent, FileMark, NoPreview } from './file-content.tsx'
import { DownloadGlyph, OpenGlyph, RevealGlyph } from './glyphs.tsx'
import { kindOf } from './kinds.ts'
import { sizeWords } from './words.ts'

type Looked = { is: 'reading' } | { is: 'failed' } | { is: 'read'; entry: WorkspaceEntry }

/**
 * A look at a file without leaving the conversation, as macOS's Quick Look gives one: the file over the main
 * screen, with what can be done with it. Escape, a click beside it or the close button puts it away.
 */
export function QuickLook({ client }: { client: Client }) {
  const path = useFollowed(peeked)
  const open = path !== undefined
  const close = () => peeked.set(undefined)
  const box = useRef<HTMLDivElement>(null)

  // The keyboard moves into the look as it opens, and goes back to what opened it once it is put away.
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    box.current?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // It closes the look and nothing behind it: the answer under way is not stopped.
      event.preventDefault()
      event.stopPropagation()
      peeked.set(undefined)
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true })
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [open])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="quick-look"
          className="fixed inset-0 z-50 flex items-center justify-center p-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DURATION.quick, ease: EASE }}
        >
          <button type="button" aria-label="Close the preview" tabIndex={-1} className="absolute inset-0 cursor-default bg-black/45" onClick={close} />
          <motion.div
            ref={box}
            role="dialog"
            aria-modal="true"
            aria-label="Preview"
            tabIndex={-1}
            initial={{ scale: 0.98, y: 6 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.98, y: 6 }}
            transition={{ duration: DURATION.calm, ease: EASE }}
            className="material shadow-float relative grid h-[min(46rem,100%)] w-[min(58rem,100%)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg outline-none"
          >
            <Look client={client} path={path} onClose={close} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Look({ client, path, onClose }: { client: Client; path: string; onClose(): void }) {
  const actions = useFileActions()
  const [looked, setLooked] = useState<Looked>({ is: 'reading' })

  useEffect(() => {
    let current = true
    setLooked({ is: 'reading' })
    client.session.run('workspace.read', { path, length: 1 }).then(
      ({ entry }) => current && setLooked({ is: 'read', entry }),
      () => current && setLooked({ is: 'failed' })
    )
    return () => {
      current = false
    }
  }, [client, path])

  const name = looked.is === 'read' ? looked.entry.name : lastPart(path)
  const entry = looked.is === 'read' ? looked.entry : undefined
  const opens = actions.open && !runsWhenOpened(name)

  return (
    <>
      <header className="flex h-12 min-w-0 items-center gap-3 border-line border-b pr-2 pl-4">
        <FileMark name={name} />
        <div className="grid min-w-0 flex-1">
          <span className="truncate font-medium text-[0.8125rem]">{name}</span>
          <span className="truncate text-[0.6875rem] text-text-faint">{entry ? `${kindOf(name).label} · ${sizeWords(entry.size)}` : kindOf(name).label}</span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {entry && opens && (
            <Button size="sm" kind="quiet" className="[&_svg]:size-3.5" onClick={() => actions.open?.(entry.location)}>
              <OpenGlyph />
              Open
            </Button>
          )}
          {entry && actions.reveal && (
            <IconButton label="Show in folder" onClick={() => actions.reveal?.(entry.location)}>
              <RevealGlyph />
            </IconButton>
          )}
          {entry && (
            <IconButton label="Save a copy" onClick={() => void saveCopy(client, path, name).catch(() => undefined)}>
              <DownloadGlyph />
            </IconButton>
          )}
          <span className="mx-1 h-4 w-px bg-line" />
          <IconButton label="Close" onClick={onClose}>
            <CloseGlyph />
          </IconButton>
        </div>
      </header>
      {looked.is === 'failed' ? (
        <NoPreview name={name} note="This file is no longer there, or cannot be read from here." />
      ) : entry ? (
        <FileContent client={client} path={path} name={name} size={entry.size} modified={entry.modified} className="h-full" />
      ) : (
        <div />
      )}
    </>
  )
}
