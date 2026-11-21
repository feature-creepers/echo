import { type Client, runsWhenOpened } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import type { WorkspaceEntry } from '@repo/protocol'
import { Dialog, DialogBackdrop, DialogClose, DialogContent } from '@ui-sdk/react/dialog'
import { useEffect, useState } from 'react'
import { lastPart } from '../changes/words.ts'
import { Button } from '../primitives/button.tsx'
import { IconButton } from '../primitives/icon-button.tsx'
import { CloseGlyph } from '../primitives/icons.tsx'
import { peeked, saveCopy, useFileActions } from './file-actions.ts'
import { FileContent, FileMark, NoPreview } from './file-content.tsx'
import { DownloadGlyph, OpenGlyph, RevealGlyph } from './glyphs.tsx'
import { kindOf } from './kinds.ts'
import { sizeWords } from './words.ts'

type Looked = { is: 'reading' } | { is: 'failed' } | { is: 'read'; entry: WorkspaceEntry }

/**
 * A look at a file without leaving the conversation, as macOS's Quick Look gives one: the file over the main
 * screen, with what can be done with it. Escape, a click beside it or the close button puts it away. While it is
 * open the keyboard stays in it, and goes back to what opened it once it is put away.
 */
export function QuickLook({ client }: { client: Client }) {
  const path = useFollowed(peeked)
  if (path === undefined) return null
  return (
    // Open from the start, it is put away once it has faded out.
    <Dialog
      defaultOpen
      onOpenChangeComplete={(open) => {
        if (!open) peeked.set(undefined)
      }}
    >
      <DialogBackdrop className="fixed inset-0 bg-black/45 transition-opacity duration-(--duration-quick) ease-soft data-starting-style:opacity-0 data-ending-style:opacity-0" />
      <DialogContent
        aria-label="Preview"
        initialFocus="content"
        className="material shadow-float fixed inset-0 m-auto grid h-[min(46rem,calc(100%-4rem))] w-[min(58rem,calc(100%-4rem))] grid-rows-[auto_minmax(0,1fr)] overflow-hidden transition-[opacity,translate,scale] ease-soft [transition-duration:var(--duration-quick),var(--duration-calm),var(--duration-calm)] data-starting-style:translate-y-1.5 data-starting-style:scale-98 data-starting-style:opacity-0 data-ending-style:translate-y-1.5 data-ending-style:scale-98 data-ending-style:opacity-0"
      >
        <Look client={client} path={path} />
      </DialogContent>
    </Dialog>
  )
}

function Look({ client, path }: { client: Client; path: string }) {
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
          <span className="caps truncate text-text-soft">{entry ? `${kindOf(name).label} · ${sizeWords(entry.size)}` : kindOf(name).label}</span>
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
          <DialogClose
            render={
              <IconButton label="Close">
                <CloseGlyph />
              </IconButton>
            }
          />
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
