import type { ViewSpec } from '@repo/catalog'
import { COLLECTION_MAX_LENGTH, type SavedWidget, WIDGET_TITLE_MAX_LENGTH } from '@repo/protocol'
import { Dialog, DialogBackdrop, DialogClose, DialogContent } from '@ui-sdk/react/dialog'
import { type FormEvent, useId, useState } from 'react'
import { Button } from '../primitives/button.tsx'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { IconButton } from '../primitives/icon-button.tsx'
import { CloseGlyph, SendGlyph } from '../primitives/icons.tsx'
import { Switch } from '../primitives/switch.tsx'
import { FIELD } from '../settings/field.ts'
import type { ViewActions } from '../view/context.ts'
import { ViewRenderer } from '../view/view-renderer.tsx'
import type { LibraryControls } from './library-context.ts'

interface WidgetDialogProps {
  widget: SavedWidget
  /** The collections there are, to pick one by its first letters. */
  collections: readonly string[]
  controls: LibraryControls
  actions: ViewActions
  /** Ask the assistant to change the widget, in these words. */
  onAsk(text: string): void
  /** It was put on the stage: the library goes back to the conversation to show it. */
  onShown(): void
  /** It was closed, and has faded out. */
  onClose(): void
}

const when = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' })

/** The dialog's fields: the app's own, compact. */
const SHORT_FIELD = cn(FIELD, 'h-8 px-2.5 text-[0.8125rem]')

/**
 * One saved widget, open: drawn at full size and usable, beside what can be done with it. Its name and
 * collection are the user's to change here; its content is the assistant's, so changing it is asked for. While it
 * is open the keyboard stays in it, and goes back to what opened it once it is closed; Escape closes it and
 * nothing under it.
 */
export function WidgetDialog({ widget, collections, controls, actions, onAsk, onShown, onClose }: WidgetDialogProps) {
  const [title, setTitle] = useState(widget.title)
  const [collection, setCollection] = useState(widget.collection ?? '')
  const [change, setChange] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [problem, setProblem] = useState<string>()
  const ids = useId()

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
    // Open from the start, it tells the library it is closed once it has faded out.
    <Dialog
      defaultOpen
      onOpenChangeComplete={(open) => {
        if (!open) onClose()
      }}
    >
      {/* The dimming covers the whole window, the title row too, so it darkens as one surface with no bar left bright. */}
      <DialogBackdrop className="fixed inset-0 bg-black/55 transition-opacity duration-(--duration-calm) ease-soft data-starting-style:opacity-0 data-ending-style:opacity-0 data-ending-style:duration-(--duration-quick)" />
      <DialogContent
        aria-label={widget.title}
        initialFocus="content"
        className="material shadow-float fixed inset-6 m-auto flex h-fit max-h-[calc(100%-3rem)] w-[calc(100%-3rem)] max-w-4xl overflow-hidden transition-[opacity,translate,scale] duration-(--duration-calm) ease-soft data-starting-style:translate-y-2 data-starting-style:scale-99 data-starting-style:opacity-0 data-ending-style:translate-y-1 data-ending-style:scale-99 data-ending-style:opacity-0 data-ending-style:duration-(--duration-quick)"
      >
        <div className="scroll-quiet grid min-w-0 flex-1 content-start overflow-y-auto">
          <div className="sticky top-0 z-10 flex h-12 items-center border-line border-b bg-surface px-5">
            <span className="display truncate text-[1.75rem] leading-[1.5rem]">{widget.title}</span>
          </div>
          <div className="p-5">
            <ViewRenderer spec={widget.spec as ViewSpec} actions={actions} />
          </div>
        </div>

        <aside className="scroll-quiet flex w-72 shrink-0 flex-col gap-5 overflow-y-auto border-line border-l px-4 pb-4 *:shrink-0">
          <div className="-mx-4 flex h-12 shrink-0 items-center justify-between border-line border-b pr-1.5 pl-4">
            <Eyebrow>Saved {when.format(new Date(widget.since))}</Eyebrow>
            <DialogClose
              render={
                <IconButton label="Close">
                  <CloseGlyph />
                </IconButton>
              }
            />
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
                className={SHORT_FIELD}
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
                className={SHORT_FIELD}
              />
              <datalist id={`${ids}-collections`}>
                {collections.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
            <div className="flex items-center justify-between gap-3 border-line border-y py-2.5">
              <span className="grid gap-px">
                <span className="text-[0.8125rem]">Pin to the main screen</span>
                <span className="text-[0.75rem] text-text-soft">Kept live beside the conversation, in your order</span>
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
            <div className="flex items-end gap-1.5 border border-line-strong bg-surface py-1.5 pr-1 pl-2.5 transition-colors duration-(--duration-quick) ease-soft focus-within:border-text">
              <textarea
                id={`${ids}-change`}
                value={change}
                rows={2}
                placeholder="Add the weekend, bigger title…"
                onChange={(event) => setChange(event.target.value)}
                onKeyDown={(event) => {
                  // Enter that ends a composition (an accent, a word in Japanese) belongs to the composition.
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) ask(event)
                }}
                className="min-w-0 flex-1 resize-none bg-transparent text-[0.8125rem] outline-none placeholder:text-text-faint focus-visible:outline-none"
              />
              <IconButton
                label="Ask the assistant"
                type="submit"
                disabled={change.trim() === ''}
                className="text-text disabled:text-text-faint disabled:opacity-50"
              >
                <SendGlyph />
              </IconButton>
            </div>
            <p className="text-[0.75rem] text-text-soft leading-relaxed">The assistant changes it and saves the new version.</p>
          </form>

          <div className="mt-auto grid gap-2 border-line border-t pt-4">
            {problem && (
              <p role="alert" className="text-[0.8125rem] text-danger">
                {problem}
              </p>
            )}
            {deleting ? (
              <div className="grid gap-2">
                <p className="text-[0.8125rem] text-text-soft">Delete “{widget.title}” for good?</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1 text-danger shadow-[inset_0_0_0_1px_var(--color-danger)]"
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
              <Button size="sm" kind="quiet" className="justify-start hover:not-disabled:text-danger" onClick={() => setDeleting(true)}>
                Delete from the library
              </Button>
            )}
          </div>
        </aside>
      </DialogContent>
    </Dialog>
  )
}
