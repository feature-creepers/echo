import { recordShortcut, shortcutKeys } from '@repo/client'
import { useEffect, useRef, useState } from 'react'
import { keyPress, useDevice } from '../device/device.tsx'
import { cn } from '../primitives/cn.ts'
import { Kbd } from '../primitives/kbd.tsx'
import { FIELD } from '../primitives/select.tsx'

interface ShortcutRecorderProps {
  /** What the shortcut does, for a screen reader. */
  label: string
  value: string
  /** Try the keys recorded. Resolves with why they were refused, or nothing when they were taken. */
  onRecord(accelerator: string): Promise<string | undefined>
  /** Tell the row what went wrong, or that nothing did. */
  onProblem(problem: string | undefined): void
  /** Take the shortcut away: the action is left without keys. */
  onClear(): void
}

/**
 * A shortcut, shown as its keys in a field like the other controls, with a cross to clear it. Pressed, it listens
 * for the next keys held together and records them; Escape stops listening. While it listens, the app lets go of
 * its own global shortcut, so pressing it records it.
 */
export function ShortcutRecorder({ label, value, onRecord, onProblem, onClear }: ShortcutRecorderProps) {
  const { mac, host } = useDevice()
  const [recording, setRecording] = useState(false)
  const [held, setHeld] = useState<string[]>([])
  const latest = useRef({ onRecord, onProblem })
  latest.current = { onRecord, onProblem }

  useEffect(() => {
    if (!recording) return
    host?.settings.suspendShortcuts(true)
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const press = keyPress(event)
      if (event.key === 'Escape' && !press.ctrl && !press.meta && !press.alt && !press.shift) return setRecording(false)
      const recorded = recordShortcut(press, mac)
      if (recorded.is === 'waiting') {
        // Show the modifiers held so far, as the person builds the shortcut.
        return setHeld(
          [
            press.ctrl && (mac ? '⌃' : 'Ctrl'),
            press.alt && (mac ? '⌥' : 'Alt'),
            press.shift && (mac ? '⇧' : 'Shift'),
            press.meta && (mac ? '⌘' : 'Win')
          ].filter((key): key is string => typeof key === 'string')
        )
      }
      setRecording(false)
      if (recorded.is === 'refused') return latest.current.onProblem(recorded.problem)
      void latest.current.onRecord(recorded.accelerator).then((problem) => latest.current.onProblem(problem))
    }
    const onRelease = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) setHeld([])
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onRelease, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onRelease, true)
      host?.settings.suspendShortcuts(false)
      setHeld([])
    }
  }, [recording, mac, host])

  const keys = recording ? held : shortcutKeys(value, mac)
  const said = keys.join(' ')

  return (
    // The field of a select, holding the keys: the same height, corners, hairline and face as the other controls.
    <div className={cn(FIELD, 'flex w-52 items-center', recording ? 'bg-text/[0.06] shadow-[inset_0_0_0_1px_var(--color-text)]' : 'hover:bg-text/[0.08]')}>
      <button
        type="button"
        aria-label={recording ? `${label}: press the new keys, or Escape to cancel` : `${label}: ${said || 'not set'}. Press to change.`}
        aria-pressed={recording}
        onClick={() => {
          latest.current.onProblem(undefined)
          setRecording((on) => !on)
        }}
        onBlur={() => setRecording(false)}
        className="flex h-full min-w-0 flex-1 items-center gap-1 pr-1 pl-2 text-left"
      >
        {keys.length > 0 ? (
          keys.map((key) => (
            <Kbd key={key} className={cn(recording && 'text-text')}>
              {key}
            </Kbd>
          ))
        ) : recording ? (
          <span className="flex items-center gap-2 text-text">
            <span aria-hidden="true" className="size-2 bg-text" />
            Press the keys…
          </span>
        ) : (
          <span className="text-text-faint">Not set</span>
        )}
      </button>
      {recording ? (
        <Kbd className="mr-1.5 text-text-faint">Esc</Kbd>
      ) : (
        value !== '' && (
          <button
            type="button"
            aria-label={`Clear ${label}`}
            title="Clear"
            onClick={onClear}
            className="mr-1 grid size-5 shrink-0 place-items-center text-text-faint transition-colors duration-(--duration-quick) hover:bg-text/[0.09] hover:text-text-soft"
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        )
      )}
    </div>
  )
}
