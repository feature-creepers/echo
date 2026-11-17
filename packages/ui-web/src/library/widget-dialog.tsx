import type { ViewSpec } from '@repo/catalog'
import { COLLECTION_MAX_LENGTH, type SavedWidget, WIDGET_TITLE_MAX_LENGTH } from '@repo/protocol'
import { motion } from 'motion/react'
import { type FormEvent, useEffect, useId, useState } from 'react'
import { Button } from '../primitives/button.tsx'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { IconButton } from '../primitives/icon-button.tsx'
import { CloseGlyph, PinGlyph, SendGlyph } from '../primitives/icons.tsx'
import type { ViewActions } from '../view/context.ts'
import { ViewRenderer } from '../view/view-renderer.tsx'
import type { LibraryControls } from './library-context.ts'

export interface WidgetDialogProps {
  widget: SavedWidget
  /** The collections there are, to pick one by its first letters. */
  collections: readonly string[]
  controls: LibraryControls
  actions: ViewActions
  /** Ask the assistant to change the widget, in these words. */
  onAsk(text: string): void
  /** It was put on the stage: the library closes to show it. */
  onShown(): void
  onClose(): void
}

const when = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' })

/**
 * One saved widget, open: drawn at full size and usable, beside what can be done with it. Its name and
 * collection are the user's to change here; its content is the assistant's, so changing it is asked for.
 */
export function WidgetDialog({ widget, collections, controls, actions, onAsk, onShown, onClose }: WidgetDialogProps) {
  const [title, setTitle] = useState(widget.title)
  const [collection, setCollection] = useState(widget.collection ?? '')
  const [change, setChange] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [problem, setProblem] = useState<string>()
  const ids = useId()

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const act = (work: Promise<unknown>) => {
    setProblem(undefined)
    work.catch(() => setProblem('That could not be done. Try again.'))
  }
  const keepTitle = () => {
    const next = title.trim()
    if (next === '' || next === widget.title) return setTitle(widget.title)
    act(controls.library.update({ widget: widget.id, title: next }))
  }
  const keepCollection = () => {
    const next = collection.trim()
    if (next === (widget.collection ?? '')) return
    act(controls.library.update({ widget: widget.id, collection: next === '' ? null : next }))
  }
  const ask = (event: FormEvent) => {
    event.preventDefault()
    const wanted = change.trim()
    if (wanted === '') return
    onAsk(`Change "${widget.title}", the widget saved in my library [${widget.id}]: ${wanted}`)
  }

  return (
    <motion.div
      className="absolute inset-0 z-40 flex items-center justify-center bg-ground/70 p-8 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={widget.title}
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        className="flex max-h-full w-full max-w-5xl overflow-hidden rounded-xl border border-line-strong bg-surface shadow-[0_40px_120px_-40px_rgb(0_0_0/0.95)]"
      >
        <div className="scroll-quiet grid min-w-0 flex-1 content-start gap-5 overflow-y-auto p-7">
          <Eyebrow accent className="truncate">
            {widget.title}
          </Eyebrow>
          <ViewRenderer spec={widget.spec as ViewSpec} actions={actions} />
        </div>

        <aside className="scroll-quiet flex w-80 shrink-0 flex-col gap-6 overflow-y-auto border-line border-l bg-raised/40 p-6">
          <div className="-mt-1 -mr-2 flex items-center justify-between">
            <Eyebrow>Saved {when.format(new Date(widget.since))}</Eyebrow>
            <IconButton label="Close" onClick={onClose}>
              <CloseGlyph />
            </IconButton>
          </div>

          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <label htmlFor={`${ids}-title`}>
                <Eyebrow>Name</Eyebrow>
              </label>
              <input
                id={`${ids}-title`}
                value={title}
                maxLength={WIDGET_TITLE_MAX_LENGTH}
                onChange={(event) => setTitle(event.target.value)}
                onBlur={keepTitle}
                onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
                className="h-10 rounded-md border border-line-strong bg-ground px-3 font-medium text-[0.9375rem] outline-none transition focus-visible:border-accent"
              />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor={`${ids}-collection`}>
                <Eyebrow>Collection</Eyebrow>
              </label>
              <input
                id={`${ids}-collection`}
                value={collection}
                list={`${ids}-collections`}
                maxLength={COLLECTION_MAX_LENGTH}
                placeholder="Unfiled"
                onChange={(event) => setCollection(event.target.value)}
                onBlur={keepCollection}
                onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
                className="h-10 rounded-md border border-line-strong bg-ground px-3 text-[0.9375rem] outline-none transition placeholder:text-text-faint focus-visible:border-accent"
              />
              <datalist id={`${ids}-collections`}>
                {collections.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={widget.pinned}
              onClick={() => act(controls.library.update({ widget: widget.id, pinned: !widget.pinned }))}
              className="flex items-center justify-between gap-3 rounded-md border border-line bg-ground/60 px-3 py-2.5 text-left transition hover:border-line-strong"
            >
              <span className="flex items-center gap-2.5 text-sm [&_svg]:size-4">
                <span className={widget.pinned ? 'text-accent' : 'text-text-faint'}>
                  <PinGlyph filled={widget.pinned} />
                </span>
                Pin to the side
              </span>
              <span className={cn('relative h-5 w-9 rounded-full transition', widget.pinned ? 'bg-accent' : 'bg-line-strong')}>
                <span className={cn('absolute top-0.5 size-4 rounded-full bg-text shadow transition-all', widget.pinned ? 'left-[1.125rem]' : 'left-0.5')} />
              </span>
            </button>
          </div>

          <Button kind="primary" onClick={() => act(controls.library.show(widget.id).then(onShown))}>
            Show on the stage
          </Button>

          <form onSubmit={ask} className="grid gap-1.5">
            <label htmlFor={`${ids}-change`}>
              <Eyebrow>Ask for a change</Eyebrow>
            </label>
            <div className="flex items-end gap-2 rounded-md border border-line-strong bg-ground px-3 py-2 transition focus-within:border-accent">
              <textarea
                id={`${ids}-change`}
                value={change}
                rows={2}
                placeholder="Add the weekend, bigger title…"
                onChange={(event) => setChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) ask(event)
                }}
                className="min-w-0 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-text-faint"
              />
              <IconButton label="Ask the assistant" type="submit" disabled={change.trim() === ''} className="text-accent disabled:opacity-40">
                <SendGlyph />
              </IconButton>
            </div>
            <p className="text-text-faint text-xs leading-relaxed">The assistant changes it and saves the new version.</p>
          </form>

          <div className="mt-auto grid gap-2 border-line border-t pt-5">
            {problem && (
              <p role="alert" className="text-danger text-xs">
                {problem}
              </p>
            )}
            {deleting ? (
              <div className="grid gap-2">
                <p className="text-sm text-text-soft">Delete “{widget.title}” for good?</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1 border-danger/50 text-danger hover:not-disabled:border-danger"
                    onClick={() => act(controls.library.remove(widget.id))}
                  >
                    Delete
                  </Button>
                  <Button size="sm" kind="quiet" className="flex-1" onClick={() => setDeleting(false)}>
                    Keep it
                  </Button>
                </div>
              </div>
            ) : (
              <Button size="sm" kind="quiet" className="justify-start text-text-faint hover:not-disabled:text-danger" onClick={() => setDeleting(true)}>
                Delete from the library
              </Button>
            )}
          </div>
        </aside>
      </motion.div>
    </motion.div>
  )
}
