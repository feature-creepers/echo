import type { Client, MemoryState } from '@repo/client'
import type { CommandInput, PersonaId, Settings } from '@repo/protocol'
import { type ReactNode, useEffect, useState } from 'react'
import { AccessSection } from '../access/access-section.tsx'
import type { DeviceSpeech } from '../audio/use-speech.ts'
import { FilesSection } from '../files/files-section.tsx'
import { WidgetsSection, type WidgetsSectionProps } from '../library/widgets-section.tsx'
import { MemorySection } from '../memory/memory-section.tsx'
import { PersonasForm } from '../personas/personas-form.tsx'
import { ScreenHeader } from '../primitives/screen-header.tsx'
import { Sidebar, SidebarItem } from '../primitives/sidebar.tsx'
import { AboutSection } from './about-section.tsx'
import { GeneralSection } from './general-section.tsx'
import { MicrophoneSection } from './microphone-section.tsx'
import { ModelsSection } from './models-section.tsx'
import { ShortcutsSection } from './shortcuts-section.tsx'
import { VoiceSection } from './voice-section.tsx'

export const SETTINGS_SECTIONS = [
  'general',
  'voice',
  'microphone',
  'shortcuts',
  'personalities',
  'models',
  'access',
  'memory',
  'widgets',
  'files',
  'about'
] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

const TITLES: Record<SettingsSection, string> = {
  general: 'General',
  voice: 'Voice',
  microphone: 'Microphone',
  shortcuts: 'Shortcuts',
  personalities: 'Personalities',
  models: 'Models',
  access: 'Access',
  memory: 'Memory',
  widgets: 'Widgets',
  files: 'Files',
  about: 'Updates & about'
}

/**
 * The sections, in two groups that say where each setting is kept: on this computer, or with the assistant,
 * which follows the user from one device to the next (docs/SPEC.md, section 5.2).
 */
const GROUPS: { title?: string; sections: SettingsSection[] }[] = [
  { title: 'This computer', sections: ['general', 'voice', 'microphone', 'shortcuts'] },
  { title: 'Your assistant', sections: ['personalities', 'models', 'access', 'memory', 'widgets', 'files'] },
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
  /** The widget library, for its section, and the widget to open there. */
  widgets: Omit<WidgetsSectionProps, 'onShown'>
  setPersonas(choice: CommandInput<'personas.set'>): Promise<void>
  onPick(persona: PersonaId): void
  onClose(): void
}

/** The settings, one section at a time, with the sections listed on the left. Escape goes back. */
export function SettingsScreen({ productName, client, settings, memory, speech, section: first, widgets, setPersonas, onPick, onClose }: SettingsScreenProps) {
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
    access: `What ${productName} may reach on this computer: its own folder, the folders and files you give it, or everything. It is held to this on every use, whatever it is asked.`,
    memory: `${productName} keeps every word of your conversations, and while it sleeps it works out what is worth remembering about you. Here is what it knows, where it learned it, and when it sleeps.`,
    widgets: `The views you saved from what ${productName} showed you. Pin them beside the conversation, sort them into collections, or ask for a change.`,
    files: `What ${productName} keeps in its own folder: the files you hand it, in its inbox, and the files it writes for you.`,
    about: `The version of ${productName} on this computer, and its updates.`
  }

  return (
    // A split view, as native settings are: the sections in a sidebar on the left, the one open beside it.
    <section aria-label="Settings" className="relative flex h-full w-full">
      <Sidebar title="Settings" label="Sections">
        {GROUPS.map((group) => (
          <div key={group.title ?? 'more'} className="grid gap-px">
            {group.title && <span className="mb-0.5 px-2.5 font-semibold text-[0.6875rem] text-text-faint">{group.title}</span>}
            {group.sections.map((name) => (
              <SidebarItem key={name} on={section === name} onClick={() => setSection(name)}>
                {TITLES[name]}
              </SidebarItem>
            ))}
          </div>
        ))}
      </Sidebar>

      <div className="scroll-quiet min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mx-auto w-full max-w-3xl px-10 pt-7 pb-16">
          <div className="mb-6">
            <ScreenHeader title={TITLES[section]} closeLabel="Close settings" onClose={onClose} />
          </div>

          <Block lead={leads[section]}>
            {section === 'general' && <GeneralSection productName={productName} />}
            {section === 'voice' && (
              <VoiceSection client={client} languages={settings.languages} speech={speech} personas={personas.available} active={active} />
            )}
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
            {section === 'access' && <AccessSection client={client} settings={settings} productName={productName} />}
            {section === 'memory' && <MemorySection memory={memory} productName={productName} />}
            {section === 'widgets' && <WidgetsSection {...widgets} onShown={onClose} />}
            {section === 'files' && <FilesSection client={client} productName={productName} />}
            {section === 'about' && <AboutSection productName={productName} />}
          </Block>
        </div>
      </div>
    </section>
  )
}

function Block({ lead, children }: { lead: string; children: ReactNode }) {
  return (
    <div className="grid gap-7">
      <p className="-mt-3 max-w-2xl text-[0.8125rem] text-text-soft leading-relaxed">{lead}</p>
      {children}
    </div>
  )
}
