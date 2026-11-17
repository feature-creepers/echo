import { CommandFailed } from '@repo/client'
import type { PersonaId, Settings } from '@repo/protocol'
import { useState } from 'react'
import { refusalCopy, stanceCopy } from '../personas/copy.ts'
import { PersonaMark } from '../personas/persona-mark.tsx'
import { accentStyle } from '../styles/theme.ts'
import styles from './presence.module.css'

export interface PresenceProps {
  personas: Settings['personas']
  /** Make another persona the one that answers. Rejects with `CommandFailed` when the core does not keep it. */
  onSwitch(persona: PersonaId): Promise<void>
}

/**
 * The assistant, present: the mark of the persona in use, its name, and a way to hand over to another.
 * Voice and the conversation are not built yet; this is where they will be.
 */
export function Presence({ personas, onSwitch }: PresenceProps) {
  const [failure, setFailure] = useState<string>()
  const active = personas.available.find((persona) => persona.id === personas.active)
  if (!active) return null

  const hand = (persona: PersonaId) => {
    if (persona === personas.active) return
    setFailure(undefined)
    onSwitch(persona).catch((error: unknown) => setFailure(refusalCopy(error instanceof CommandFailed ? error.code : 'failed')))
  }

  return (
    <section className={styles.presence} aria-label="The assistant">
      <PersonaMark size="large" alive />
      <div className={styles.who}>
        <h1 className={styles.name}>{active.name}</h1>
        <p className={styles.stance}>{stanceCopy[active.stance].label}</p>
      </div>
      <div className={styles.switch} role="radiogroup" aria-label="Who answers">
        {personas.available.map((persona) => (
          // biome-ignore lint/a11y/useSemanticElements: a row of names that reads as buttons, with the behaviour of a radio group
          <button
            key={persona.id}
            type="button"
            role="radio"
            aria-checked={persona.id === personas.active}
            className={styles.option}
            style={accentStyle(persona.accent)}
            onClick={() => hand(persona.id)}
          >
            {persona.name}
          </button>
        ))}
      </div>
      <p className={styles.note}>{active.name} cannot hear or speak yet. Voice comes in a later build.</p>
      <p className={styles.failure} role="alert">
        {failure}
      </p>
    </section>
  )
}
