import { recordShortcut, shortcutKeys } from '@repo/client'
import { useEffect, useRef, useState } from 'react'
import { keyPress, useDevice } from '../device/device.tsx'
import { cn } from '../primitives/cn.ts'

export interface ShortcutRecorderProps {
  /** What the shortcut does, for a screen reader. */
  label: string
  value: string
  /** Try the keys recorded. Resolves with why they were refused, or nothing when they were taken. */
  onRecord(accelerator: string): Promise<string | undefined>
  /** Tell the row what went wrong, or that nothing did. */
  onProblem(problem: string | undefined): void
}

/**
 * A shortcut, shown as its keys. Pressed, it listens for the next keys held together and records them; Escape
 * stops listening. While it listens, the app lets go of its own global shortcut, so pressing it records it.
 */
export function ShortcutRecorder({ label, value, onRecord, onProblem }: ShortcutRecorderProps) {
  const { mac, host } = useDevice()
  const [recording, setRecording] = useState(false)
  const [held, setHeld] = useState<string[]>([])
  const button = useRef<HTMLButtonElement>(null)
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
        // Show the modifiers held so far, as the user builds the shortcut.
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

  return (
    <button
      ref={button}
      type="button"
      aria-label={recording ? `${label}: press the new keys, or Escape to cancel` : `${label}: ${keys.join(' ') || 'none'}. Press to change.`}
      aria-pressed={recording}
      onClick={() => {
        latest.current.onProblem(undefined)
        setRecording((on) => !on)
      }}
      onBlur={() => setRecording(false)}
      className={cn(
        'group flex h-10 min-w-48 items-center justify-between gap-4 rounded-md border px-2.5 transition duration-150 ease-soft',
        recording ? 'border-accent/70 bg-accent/8' : 'border-line-strong bg-ground hover:border-text-faint'
      )}
    >
      <span className="flex items-center gap-1">
        {keys.length > 0 ? (
          keys.map((key) => (
            <kbd
              key={key}
              className="inline-flex h-6 min-w-6 items-center justify-center rounded-[5px] border border-line-strong border-b-2 bg-raised px-1.5 text-[0.6875rem] text-text"
            >
              {key}
            </kbd>
          ))
        ) : (
          <span className={cn('px-1 text-xs', recording ? 'animate-pulse text-accent' : 'text-text-faint')}>{recording ? 'Press the keys…' : 'None'}</span>
        )}
      </span>
      <span className={cn('text-label', recording ? 'text-accent' : 'text-text-faint group-hover:text-text-soft')}>{recording ? 'Esc' : 'Change'}</span>
    </button>
  )
}
