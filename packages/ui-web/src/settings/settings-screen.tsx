import type { Client, MemoryState } from '@repo/client'
import type { CommandInput, PersonaId, Settings } from '@repo/protocol'
import { type ReactNode, useEffect, useState } from 'react'
import type { DeviceSpeech } from '../audio/use-speech.ts'
import { MemorySection } from '../memory/memory-section.tsx'
import { PersonasForm } from '../personas/personas-form.tsx'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { ScreenHeader } from '../primitives/screen-header.tsx'
import { AboutSection } from './about-section.tsx'
import { GeneralSection } from './general-section.tsx'
import { MicrophoneSection } from './microphone-section.tsx'
import { ModelsSection } from './models-section.tsx'
import { ShortcutsSection } from './shortcuts-section.tsx'
import { VoiceSection } from './voice-section.tsx'

export const SETTINGS_SECTIONS = ['general', 'voice', 'microphone', 'shortcuts', 'personalities', 'models', 'memory', 'about'] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

const TITLES: Record<SettingsSection, string> = {
  general: 'General',
  voice: 'Voice',
  microphone: 'Microphone',
  shortcuts: 'Shortcuts',
  personalities: 'Personalities',
  models: 'Models',
  memory: 'Memory',
  about: 'Updates & about'
}

/**
 * The sections, in two groups that say where each setting is kept: on this computer, or with the assistant,
 * which follows the user from one device to the next (docs/SPEC.md, section 5.2).
 */
const GROUPS: { title?: string; sections: SettingsSection[] }[] = [
  { title: 'This computer', sections: ['general', 'voice', 'microphone', 'shortcuts'] },
  { title: 'Your assistant', sections: ['personalities', 'models', 'memory'] },
  { sections: ['about'] }
]

export interface SettingsScreenProps {
  productName: string
  client: Client
  /** The user's settings, from the core. */
  settings: Settings
  /** What the assistant knows about the user, and when it sleeps. */
  memory: MemoryState
  /** The device's speech. Left out, the device has none and the section says so. */
  speech?: DeviceSpeech | undefined
  /** The section to open on. */
  section: SettingsSection
  setPersonas(choice: CommandInput<'personas.set'>): Promise<void>
  onPick(persona: PersonaId): void
  onClose(): void
}

/** The settings, one section at a time, with the sections listed on the left. Escape goes back. */
export function SettingsScreen({ productName, client, settings, memory, speech, section: first, setPersonas, onPick, onClose }: SettingsScreenProps) {
  const [section, setSection] = useState<SettingsSection>(first)
  const { personas } = settings
  const active = personas.available.find((persona) => persona.id === personas.active)

  useEffect(() => setSection(first), [first])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Escape while a shortcut is being recorded cancels the recording, not the screen.
      if (event.key === 'Escape' && !event.defaultPrevented) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const leads: Record<SettingsSection, string> = {
    general: `How ${productName} starts and stops on this computer, and where it keeps what it writes.`,
    voice: 'To hear you and answer aloud, this computer runs its own speech models. Your voice never leaves it.',
    microphone: 'The microphone it listens with, and when it stops listening. Talk to check that it hears you.',
    shortcuts: `The keys that call ${productName}. Click one, then press the keys you want.`,
    personalities: 'What you call each personality, and which one answers. A name is what you say to talk to it.',
    models: `${productName} runs on an AI program you already have, signed in with your own account. Choose the model it answers with: these choices follow you, not this computer.`,
    memory: `${productName} keeps every word of your conversations, and while it sleeps it works out what is worth remembering about you. Here is what it knows, where it learned it, and when it sleeps.`,
    about: `The version of ${productName} on this computer, and its updates.`
  }

  return (
    <section aria-label="Settings" className="mx-auto flex h-full w-full max-w-5xl gap-10 px-8 pt-8">
      <nav aria-label="Sections" className="scroll-quiet grid w-44 shrink-0 content-start gap-5 overflow-y-auto pb-10">
        <Eyebrow className="px-2.5 leading-8">Settings</Eyebrow>
        {GROUPS.map((group) => (
          <div key={group.title ?? 'more'} className={cn('grid gap-px', !group.title && 'border-line border-t pt-4')}>
            {group.title && <span className="mb-1 px-2.5 text-[0.6875rem] text-text-faint">{group.title}</span>}
            {group.sections.map((name) => (
              <button
                key={name}
                type="button"
                aria-current={section === name}
                onClick={() => setSection(name)}
                className={cn(
                  'relative h-8 rounded-md px-2.5 text-left text-[0.8125rem] transition-colors duration-(--duration-quick) ease-soft',
                  section === name ? 'bg-white/[0.06] text-text' : 'text-text-soft hover:bg-white/[0.03] hover:text-text'
                )}
              >
                {TITLES[name]}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="scroll-quiet min-w-0 flex-1 overflow-y-auto overflow-x-hidden pb-16">
        <div className="mb-6">
          <ScreenHeader title={TITLES[section]} closeLabel="Close settings" onClose={onClose} />
        </div>

        <Block lead={leads[section]}>
          {section === 'general' && <GeneralSection productName={productName} />}
          {section === 'voice' && <VoiceSection speech={speech} personas={personas.available} active={active} />}
          {section === 'microphone' && <MicrophoneSection />}
          {section === 'shortcuts' && <ShortcutsSection productName={productName} />}
          {section === 'personalities' && (
            <PersonasForm
              personas={personas.available}
              active={personas.active}
              submitLabel="Save"
              busyLabel="Saving…"
              doneLabel="Saved"
              onSubmit={setPersonas}
              onPick={onPick}
            />
          )}
          {section === 'models' && <ModelsSection client={client} settings={settings} />}
          {section === 'memory' && <MemorySection memory={memory} productName={productName} />}
          {section === 'about' && <AboutSection productName={productName} />}
        </Block>
      </div>
    </section>
  )
}

function Block({ lead, children }: { lead: string; children: ReactNode }) {
  return (
    <div className="grid gap-7">
      <p className="-mt-3 max-w-2xl text-sm text-text-soft leading-relaxed">{lead}</p>
      {children}
    </div>
  )
}
