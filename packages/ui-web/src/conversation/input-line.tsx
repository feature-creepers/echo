import type { Accent } from '@repo/protocol'
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { cn } from '../primitives/cn.ts'
import { MicGlyph, PauseGlyph, PlayGlyph, SendGlyph, StopGlyph } from '../primitives/icons.tsx'
import { Kbd } from '../primitives/kbd.tsx'
import { accentStyle } from '../styles/accent.ts'

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
  /** The persona that answers, and the one a press of the toggle hands over to. */
  persona?: { name: string; next: { name: string; accent: Accent } | undefined; onToggle(): void } | undefined
}

/**
 * The line the user types on. It keeps the keyboard: typing anywhere in the window lands here.
 * Enter sends; Escape stops the answer under way.
 */
export function InputLine({ name, busy, onSay, onStop, talk, persona, pause }: InputLineProps) {
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)

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
      className="group flex h-14 items-center gap-3 rounded-xl border border-line-strong bg-surface/90 pr-2.5 pl-2.5 shadow-[0_18px_60px_-30px_rgb(0_0_0/0.9)] backdrop-blur-md transition duration-200 ease-soft focus-within:border-accent/60 focus-within:shadow-[0_0_0_4px_color-mix(in_oklab,var(--accent)_14%,transparent),0_18px_60px_-30px_rgb(0_0_0/0.9)]"
    >
      {persona && (
        <button
          type="button"
          onClick={persona.onToggle}
          disabled={!persona.next}
          aria-label={persona.next ? `Talking to ${persona.name}. Switch to ${persona.next.name}` : `Talking to ${persona.name}`}
          title={persona.next ? `${persona.name} · click for ${persona.next.name}` : persona.name}
          className="group/persona relative flex size-9 shrink-0 items-center justify-center rounded-lg transition duration-200 ease-soft hover:bg-raised"
        >
          <span className="absolute inset-[9px] rounded-full border border-accent/70 shadow-[0_0_12px_-2px_var(--accent)] transition duration-300" />
          <span className="size-2 rounded-full bg-accent shadow-[0_0_8px_var(--accent)] transition duration-300" />
          {persona.next && (
            <span
              style={accentStyle(persona.next.accent)}
              className="absolute right-1 bottom-1 size-1.5 rounded-full bg-accent opacity-0 transition group-hover/persona:opacity-100"
            />
          )}
        </button>
      )}
      <span aria-hidden="true" className={cn('font-mono text-accent text-lg leading-none', !persona && 'pl-2.5')}>
        ›
      </span>
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
        placeholder={talk?.listening ? 'Listening… speak, then pause' : talk ? `Ask ${name} anything · Ctrl+Space to talk` : `Ask ${name} anything`}
        className="h-full min-w-0 flex-1 bg-transparent font-mono text-[0.9375rem] text-text outline-none placeholder:text-text-faint"
      />
      {talk && (
        <button
          type="button"
          onClick={talk.onPress}
          aria-label={talk.listening ? 'Send what was said' : 'Talk'}
          aria-pressed={talk.listening}
          title={talk.listening ? 'Send (Ctrl+Space)' : 'Talk (Ctrl+Space, or Ctrl+Shift+Space from any app)'}
          className={cn(
            'relative flex size-9 items-center justify-center rounded-md transition duration-150 ease-soft',
            talk.listening ? 'bg-accent text-accent-ink shadow-[0_0_24px_-4px_var(--accent)]' : 'text-text-soft hover:bg-raised hover:text-text'
          )}
        >
          {talk.listening && <span className="absolute inset-0 animate-ping rounded-md bg-accent/40" />}
          <MicGlyph />
        </button>
      )}
      {pause && (
        <button
          type="button"
          onClick={pause.onToggle}
          aria-label={pause.paused ? 'Continue' : 'Pause'}
          title={pause.paused ? 'Continue' : 'Pause'}
          className="flex size-9 items-center justify-center rounded-md text-text-soft transition duration-150 ease-soft hover:bg-raised hover:text-text"
        >
          {pause.paused ? <PlayGlyph /> : <PauseGlyph />}
        </button>
      )}
      {busy ? (
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop"
          className="flex h-9 items-center gap-2 rounded-md border border-line-strong bg-raised pr-2 pl-3 text-text-soft text-xs transition duration-150 ease-soft hover:border-text-faint hover:text-text"
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
            'flex size-9 items-center justify-center rounded-md transition duration-150 ease-soft',
            text.trim() === '' ? 'text-text-faint' : 'bg-accent text-accent-ink shadow-[0_0_20px_-6px_var(--accent)] hover:brightness-110'
          )}
        >
          <SendGlyph />
        </button>
      )}
    </form>
  )
}
