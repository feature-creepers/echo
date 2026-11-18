import type { ViewSpec } from '@repo/catalog'
import { COLLECTION_MAX_LENGTH, type SavedWidget, WIDGET_TITLE_MAX_LENGTH } from '@repo/protocol'
import { motion } from 'motion/react'
import { type FormEvent, useEffect, useId, useState } from 'react'
import { Button } from '../primitives/button.tsx'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { IconButton } from '../primitives/icon-button.tsx'
import { CloseGlyph, SendGlyph } from '../primitives/icons.tsx'
import { Switch } from '../primitives/switch.tsx'
import { DURATION, EASE } from '../styles/motion.ts'
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
  /** It was put on the stage: the library goes back to the conversation to show it. */
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

  // Escape closes the dialog and nothing under it: heard first, and marked as handled for the library around it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
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
    // The dimming reaches up over the title row too, so the window darkens as one surface with no bar left bright.
    <motion.div
      className="absolute inset-x-0 top-[calc(-1*env(titlebar-area-height,var(--frame-title-bar)))] bottom-0 z-40 flex items-center justify-center bg-black/55 p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: DURATION.calm, ease: EASE } }}
      exit={{ opacity: 0, transition: { duration: DURATION.quick, ease: EASE } }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={widget.title}
        initial={{ opacity: 0, y: 8, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 4, scale: 0.99, transition: { duration: DURATION.quick, ease: EASE } }}
        transition={{ duration: DURATION.calm, ease: EASE }}
        className="shadow-float flex max-h-full w-full max-w-4xl overflow-hidden rounded-lg bg-surface ring-1 ring-white/[0.08]"
      >
        <div className="scroll-quiet grid min-w-0 flex-1 content-start overflow-y-auto">
          <div className="sticky top-0 z-10 flex h-10 items-center border-line border-b bg-surface/90 px-5 text-text-soft text-xs backdrop-blur-xl">
            <span className="truncate font-medium">{widget.title}</span>
          </div>
          <div className="p-5">
            <ViewRenderer spec={widget.spec as ViewSpec} actions={actions} />
          </div>
        </div>

        <aside className="scroll-quiet flex w-72 shrink-0 flex-col gap-5 overflow-y-auto border-black/40 border-l bg-white/[0.025] px-4 pb-4 *:shrink-0">
          <div className="-mx-4 flex h-10 shrink-0 items-center justify-between border-line border-b pr-1.5 pl-4">
            <Eyebrow>Saved {when.format(new Date(widget.since))}</Eyebrow>
            <IconButton label="Close" onClick={onClose}>
              <CloseGlyph />
            </IconButton>
          </div>

          <div className="grid gap-3.5">
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
                className="h-8 rounded-md border border-line-strong bg-black/25 shadow-[inset_0_1px_1px_rgb(0_0_0/0.25)] px-2.5 font-medium text-[0.8125rem] transition-colors"
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
                className="h-8 rounded-md border border-line-strong bg-black/25 shadow-[inset_0_1px_1px_rgb(0_0_0/0.25)] px-2.5 text-[0.8125rem] transition-colors placeholder:text-text-faint"
              />
              <datalist id={`${ids}-collections`}>
                {collections.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md bg-white/[0.04] px-2.5 py-2 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.05)]">
              <span className="grid gap-px">
                <span className="text-[0.8125rem]">Pin to the main screen</span>
                <span className="text-[0.6875rem] text-text-faint">Kept live beside the conversation, in your order</span>
              </span>
              <Switch label="Pin to the main screen" on={widget.pinned} onChange={(pinned) => act(controls.library.update({ widget: widget.id, pinned }))} />
            </div>
          </div>

          <Button kind="primary" size="sm" onClick={() => act(controls.library.show(widget.id).then(onShown))}>
            Show on the stage
          </Button>

          <form onSubmit={ask} className="grid gap-1.5">
            <label htmlFor={`${ids}-change`}>
              <Eyebrow>Ask for a change</Eyebrow>
            </label>
            <div className="flex items-end gap-1.5 rounded-md border border-line-strong bg-black/25 shadow-[inset_0_1px_1px_rgb(0_0_0/0.25)] py-1.5 pr-1 pl-2.5 transition-colors focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_55%,transparent)]">
              <textarea
                id={`${ids}-change`}
                value={change}
                rows={2}
                placeholder="Add the weekend, bigger title…"
                onChange={(event) => setChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) ask(event)
                }}
                className="min-w-0 flex-1 resize-none bg-transparent text-[0.8125rem] outline-none placeholder:text-text-faint focus-visible:outline-none"
              />
              <IconButton
                label="Ask the assistant"
                type="submit"
                disabled={change.trim() === ''}
                className="text-accent disabled:text-text-faint disabled:opacity-50"
              >
                <SendGlyph />
              </IconButton>
            </div>
            <p className="text-text-faint text-xs leading-relaxed">The assistant changes it and saves the new version.</p>
          </form>

          <div className="mt-auto grid gap-2 border-line border-t pt-4">
            {problem && (
              <p role="alert" className="text-danger text-xs">
                {problem}
              </p>
            )}
            {deleting ? (
              <div className="grid gap-2">
                <p className="text-[0.8125rem] text-text-soft">Delete “{widget.title}” for good?</p>
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
