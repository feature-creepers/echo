import type { CommandInput, PersonaId, Settings } from '@repo/protocol'
import { PersonasForm } from '../personas/personas-form.tsx'
import styles from './onboarding.module.css'

export interface OnboardingProps {
  productName: string
  personas: Settings['personas']
  onSubmit(choice: CommandInput<'personas.set'>): Promise<void>
  onPick(persona: PersonaId): void
}

/**
 * First launch: the user meets the personas, keeps their names or types their own, and picks the one that answers.
 * It is shown until the core says the personas are confirmed, on whichever device the user does it.
 */
export function Onboarding({ productName, personas, onSubmit, onPick }: OnboardingProps) {
  return (
    <section className={styles.onboarding} aria-labelledby="onboarding-title">
      <div className={styles.intro}>
        <p className={styles.eyebrow}>Welcome to {productName}</p>
        <h1 id="onboarding-title" className={styles.title}>
          Meet your assistant.
        </h1>
        <p className={styles.lead}>
          It has more than one personality, and you call it by the name of the one in use. Keep these names or type your own. You can change them later in
          settings.
        </p>
      </div>
      <PersonasForm personas={personas.available} active={personas.active} submitLabel="Start" busyLabel="Starting…" onSubmit={onSubmit} onPick={onPick} />
    </section>
  )
}
