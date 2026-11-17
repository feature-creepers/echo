import type { CommandInput, PersonaId, Settings } from '@repo/protocol'
import { useEffect } from 'react'
import { PersonasForm } from '../personas/personas-form.tsx'
import { Button } from '../primitives/button.tsx'
import styles from './settings-screen.module.css'

export interface SettingsScreenProps {
  personas: Settings['personas']
  onSubmit(choice: CommandInput<'personas.set'>): Promise<void>
  onPick(persona: PersonaId): void
  onClose(): void
}

/** The user's settings. For now: what the personas are called, and which one answers. Escape goes back. */
export function SettingsScreen({ personas, onSubmit, onPick, onClose }: SettingsScreenProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <section className={styles.settings} aria-labelledby="settings-title">
      <div className={styles.top}>
        <h1 id="settings-title" className={styles.title}>
          Settings
        </h1>
        <Button onClick={onClose}>Back</Button>
      </div>
      <div className={styles.section}>
        <h2 className={styles.label}>Personalities</h2>
        <p className={styles.about}>What you call each personality, and which one answers. A name is what you say to talk to it.</p>
        <PersonasForm
          personas={personas.available}
          active={personas.active}
          submitLabel="Save"
          busyLabel="Saving…"
          doneLabel="Saved."
          onSubmit={onSubmit}
          onPick={onPick}
        />
      </div>
    </section>
  )
}
