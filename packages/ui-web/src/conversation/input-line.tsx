import { describeShortcut } from '@repo/client'
import type { Look } from '@repo/protocol'
import { type ClipboardEvent, type FormEvent, type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AttachmentChips } from '../attachments/attachment-chips.tsx'
import type { Attachments } from '../attachments/use-attachments.ts'
import { lastPart } from '../changes/words.ts'
import { useDevice } from '../device/device.tsx'
import { PaperclipGlyph } from '../files/glyphs.tsx'
import { Eye } from '../presence/eye.tsx'
import type { Mood } from '../presence/painter.ts'
import { cn } from '../primitives/cn.ts'
import { MicGlyph, PauseGlyph, PlayGlyph, SendGlyph } from '../primitives/icons.tsx'
import { Menu } from '../primitives/menu.tsx'
import { StopAllButton } from './stop-all-button.tsx'

export interface InputLineProps {
  /** The name of the persona that will answer, for the hint in the empty line. */
  name: string
  /**
   * Work under way, threads at work or an answer being given: the line then offers, beside sending, to stop it all,
   * held for two seconds. `working` is how many pieces of work that stops.
   */
  stopAll?: { working: number; onStop(): void } | undefined
  /** Say it. Resolving to false when it could not go, such as a file handed over that did not arrive: the words come back to the line. */
  onSay(text: string): void | Promise<boolean>
  /** Escape: quiet what is being said and stop the answer on the stage. Work in a project goes on. */
  onStop(): void
  /** Pausing what is being said, while something is. */
  pause?: { paused: boolean; onToggle(): void } | undefined
  /** Talking instead of typing, when the device can hear. */
  talk?: { listening: boolean; onPress(): void } | undefined
  /** The persona that answers, its look, what it is doing, and the one a press of the toggle hands over to. */
  persona?: { name: string; look: Look; mood: Mood; next: { name: string } | undefined; onToggle(): void } | undefined
  /** Files and folders to hand over with what is said: pasted, picked, or dropped on the window. Left out, there are none. */
  attachments?: Attachments | undefined
}

/** The most the line grows to, in pixels, before it scrolls: about eight lines. */
const TALLEST = 192

/**
 * The line the user types on, growing with what is written. It keeps the keyboard: typing anywhere in the window
 * lands here. Enter sends and Shift+Enter starts a new line; Escape stops the answer under way. Sending is always
 * there, even while the assistant works: what is said next runs beside what is under way. Files pasted or picked wait above the line, and go with what
 * is sent; Backspace on an empty line takes the last one back.
 */
export function InputLine({ name, stopAll, onSay, onStop, talk, persona, pause, attachments }: InputLineProps) {
  const [text, setText] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const waiting = attachments?.pending.length ?? 0
  // The keys shown in the hints are the ones set for this device.
  const { settings, mac, host } = useDevice()
  const talkKey = settings.shortcuts.talkInWindow && describeShortcut(settings.shortcuts.talkInWindow, mac)
  const anywhereKey = settings.shortcuts.talk && describeShortcut(settings.shortcuts.talk, mac)
  const pauses = settings.listening.pause !== 'never'

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      // Escape taken by something over the screen, a preview, is not a stop.
      if (event.key === 'Escape') return event.defaultPrevented ? undefined : onStop()
      const elsewhere = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement
      if (!elsewhere && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) input.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onStop])

  // The line grows with its text, up to about eight lines, then scrolls.
  useLayoutEffect(() => {
    const line = input.current
    if (!line) return
    line.style.height = 'auto'
    line.style.height = `${Math.min(line.scrollHeight, TALLEST)}px`
  }, [text])

  const send = (event: FormEvent) => {
    event.preventDefault()
    const said = text.trim()
    if (said === '' && waiting === 0) return
    const sent = onSay(said)
    setText('')
    void sent?.then((went) => {
      if (!went) setText((now) => (now === '' ? said : now))
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') event.currentTarget.blur()
    // Enter sends; Shift+Enter, or Enter while a character is being composed, stays in the text.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
      return
    }
    const { selectionStart, selectionEnd } = event.currentTarget
    if (event.key === 'Backspace' && waiting > 0 && selectionStart === 0 && selectionEnd === 0) {
      event.preventDefault()
      attachments?.removeLast()
    }
  }

  /** Files from the window's own picker. */
  const pickFiles = () => picker.current?.click()
  /**
   * A folder from the system's own picker, where the device knows where folders are: given read only, as a folder
   * dropped on the window is.
   */
  const pickFolder = host?.files
    ? async () => {
        const [path] = (await host.files?.pick('folder', 'attach').catch(() => [])) ?? []
        if (path !== undefined) attachments?.add([], [{ name: lastPart(path), path }])
        input.current?.focus()
      }
    : undefined
  const clipClass =
    'mb-0.5 flex size-8 items-center justify-center rounded-md text-text-faint transition-colors duration-(--duration-quick) ease-soft hover:bg-white/[0.05] hover:text-text'

  // Pictures and files pasted go with the message; text pasted is text, as always.
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...event.clipboardData.files]
    if (!attachments || files.length === 0) return
    event.preventDefault()
    attachments.add(files)
  }

  return (
    <form onSubmit={send} className="material shadow-float group grid rounded-lg transition-shadow duration-(--duration-calm) ease-soft">
      {attachments && waiting > 0 && <AttachmentChips pending={attachments.pending} onRemove={attachments.remove} />}
      <div className="flex min-h-12 items-end gap-1 px-1.5 py-1.5">
        {persona ? (
          // The eye says which persona answers and what it is doing; pressing it hands over to the other one.
          <button
            type="button"
            onClick={persona.onToggle}
            disabled={!persona.next}
            aria-label={persona.next ? `Talking to ${persona.name}. Switch to ${persona.next.name}` : `Talking to ${persona.name}`}
            title={persona.next ? `${persona.name} · click for ${persona.next.name}` : persona.name}
            className="flex size-9 shrink-0 items-center justify-center rounded-md transition-colors duration-(--duration-quick) ease-soft hover:not-disabled:bg-white/[0.05]"
          >
            <Eye mood={persona.mood} look={persona.look} />
          </button>
        ) : (
          <span className="w-2" />
        )}
        <textarea
          ref={input}
          rows={1}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          // biome-ignore lint/a11y/noAutofocus: the one line of a screen that exists to be typed in
          autoFocus
          autoComplete="off"
          spellCheck={false}
          aria-label={`Say something to ${name}`}
          placeholder={
            waiting > 0 && !talk?.listening
              ? `Say something about ${waiting === 1 ? 'it' : 'them'}, or just send`
              : talk?.listening
                ? pauses
                  ? 'Listening… speak, then pause'
                  : 'Listening… press again to send'
                : talk && talkKey
                  ? `Ask ${name} anything, or press ${talkKey} to talk`
                  : `Ask ${name} anything`
          }
          className="scroll-quiet min-h-9 min-w-0 flex-1 resize-none bg-transparent py-[0.4375rem] pl-1 text-[0.9375rem] text-text leading-[1.375rem] outline-none placeholder:text-text-faint focus-visible:outline-none"
        />
        {attachments && (
          <>
            <input
              ref={picker}
              type="file"
              multiple
              hidden
              tabIndex={-1}
              onChange={(event) => {
                attachments.add([...(event.target.files ?? [])])
                event.target.value = ''
                input.current?.focus()
              }}
            />
            {pickFolder ? (
              <Menu
                side="top"
                label="Attach"
                items={[
                  { label: 'Files…', onSelect: pickFiles },
                  { label: 'A folder…', detail: 'Read only', onSelect: () => void pickFolder() }
                ]}
                trigger={(_open, toggle, trigger) => (
                  <button type="button" onClick={toggle} {...trigger.props} aria-label="Attach files or a folder" title="Attach" className={clipClass}>
                    <PaperclipGlyph />
                  </button>
                )}
              />
            ) : (
              <button type="button" onClick={pickFiles} aria-label="Attach files" title="Attach files" className={clipClass}>
                <PaperclipGlyph />
              </button>
            )}
          </>
        )}
        {talk && (
          <button
            type="button"
            onClick={talk.onPress}
            aria-label={talk.listening ? 'Send what was said' : 'Talk'}
            aria-pressed={talk.listening}
            title={
              talk.listening
                ? `Send${talkKey ? ` (${talkKey})` : ''}`
                : `Talk${talkKey ? ` (${talkKey}${anywhereKey ? `, or ${anywhereKey} from any app` : ''})` : ''}`
            }
            className={cn(
              'mb-0.5 flex size-8 items-center justify-center rounded-md transition-colors duration-(--duration-quick) ease-soft',
              talk.listening ? 'bg-accent text-accent-ink' : 'text-text-faint hover:bg-white/[0.05] hover:text-text'
            )}
          >
            <MicGlyph />
          </button>
        )}
        {pause && (
          <button
            type="button"
            onClick={pause.onToggle}
            aria-label={pause.paused ? 'Continue' : 'Pause'}
            title={pause.paused ? 'Continue' : 'Pause'}
            className="mb-0.5 flex size-8 items-center justify-center rounded-md text-text-faint transition-colors duration-(--duration-quick) ease-soft hover:bg-white/[0.05] hover:text-text"
          >
            {pause.paused ? <PlayGlyph /> : <PauseGlyph />}
          </button>
        )}
        {stopAll && <StopAllButton working={stopAll.working} onStop={stopAll.onStop} />}
        {(!stopAll || text.trim() !== '' || waiting > 0) && (
          <button
            type="submit"
            aria-label="Send"
            disabled={text.trim() === '' && waiting === 0}
            className={cn(
              'mb-0.5 ml-0.5 flex size-8 items-center justify-center rounded-md transition-colors duration-(--duration-quick) ease-soft',
              text.trim() === '' && waiting === 0 ? 'text-text-faint/60' : 'bg-accent text-accent-ink hover:brightness-110'
            )}
          >
            <SendGlyph />
          </button>
        )}
      </div>
    </form>
  )
}
