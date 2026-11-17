import { describeShortcut } from '@repo/client'
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { useDevice } from '../device/device.tsx'
import { Eye } from '../presence/eye.tsx'
import type { Mood } from '../presence/painter.ts'
import { cn } from '../primitives/cn.ts'
import { MicGlyph, PauseGlyph, PlayGlyph, SendGlyph, StopGlyph } from '../primitives/icons.tsx'
import { Kbd } from '../primitives/kbd.tsx'

export interface InputLineProps {
  /** The name of the persona that will answer, for the hint in the empty line. */
  name: string
  /** The assistant is answering or speaking: the line then offers to stop it. */
  busy: boolean
  onSay(text: string): void
  onStop(): void
  /** Pausing what is being said, while something is. */
  pause?: { paused: boolean; onToggle(): void } | undefined
  /** Talking instead of typing, when the device can hear. */
  talk?: { listening: boolean; onPress(): void } | undefined
  /** The persona that answers, what it is doing, and the one a press of the toggle hands over to. */
  persona?: { name: string; mood: Mood; next: { name: string } | undefined; onToggle(): void } | undefined
}

/**
 * The line the user types on. It keeps the keyboard: typing anywhere in the window lands here.
 * Enter sends; Escape stops the answer under way.
 */
export function InputLine({ name, busy, onSay, onStop, talk, persona, pause }: InputLineProps) {
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)
  // The keys shown in the hints are the ones set for this device.
  const { settings, mac } = useDevice()
  const talkKey = settings.shortcuts.talkInWindow && describeShortcut(settings.shortcuts.talkInWindow, mac)
  const anywhereKey = settings.shortcuts.talk && describeShortcut(settings.shortcuts.talk, mac)
  const pauses = settings.listening.pause !== 'never'

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') return onStop()
      const elsewhere = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement
      if (!elsewhere && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) input.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onStop])

  const send = (event: FormEvent) => {
    event.preventDefault()
    const said = text.trim()
    if (said === '') return
    onSay(said)
    setText('')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') event.currentTarget.blur()
  }

  return (
    <form
      onSubmit={send}
      className="material shadow-float group flex h-12 items-center gap-1 rounded-lg px-1.5 transition-shadow duration-(--duration-calm) ease-soft"
    >
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
          <Eye mood={persona.mood} />
        </button>
      ) : (
        <span className="w-2" />
      )}
      <input
        ref={input}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        // biome-ignore lint/a11y/noAutofocus: the one line of a screen that exists to be typed in
        autoFocus
        autoComplete="off"
        spellCheck={false}
        aria-label={`Say something to ${name}`}
        placeholder={
          talk?.listening
            ? pauses
              ? 'Listening… speak, then pause'
              : 'Listening… press again to send'
            : talk && talkKey
              ? `Ask ${name} anything, or press ${talkKey} to talk`
              : `Ask ${name} anything`
        }
        className="h-full min-w-0 flex-1 bg-transparent pl-1 text-[0.9375rem] text-text outline-none placeholder:text-text-faint focus-visible:outline-none"
      />
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
            'flex size-8 items-center justify-center rounded-md transition-colors duration-(--duration-quick) ease-soft',
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
          className="flex size-8 items-center justify-center rounded-md text-text-faint transition-colors duration-(--duration-quick) ease-soft hover:bg-white/[0.05] hover:text-text"
        >
          {pause.paused ? <PlayGlyph /> : <PauseGlyph />}
        </button>
      )}
      {busy ? (
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop"
          className="ml-0.5 flex h-8 items-center gap-2 rounded-md bg-white/[0.08] pr-1.5 pl-2.5 text-text-soft text-xs shadow-[inset_0_0_0_0.5px_rgb(255_255_255/0.1)] transition-colors duration-(--duration-quick) ease-soft hover:bg-white/[0.12] hover:text-text [&_svg]:size-3.5"
        >
          <StopGlyph />
          Stop
          <Kbd>esc</Kbd>
        </button>
      ) : (
        <button
          type="submit"
          aria-label="Send"
          disabled={text.trim() === ''}
          className={cn(
            'ml-0.5 flex size-8 items-center justify-center rounded-md transition-colors duration-(--duration-quick) ease-soft',
            text.trim() === '' ? 'text-text-faint/60' : 'bg-accent text-accent-ink hover:brightness-110'
          )}
        >
          <SendGlyph />
        </button>
      )}
    </form>
  )
}
