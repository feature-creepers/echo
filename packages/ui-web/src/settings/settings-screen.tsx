import type { EnginesState, MemoryState } from '@repo/client'
import type { CommandInput, PersonaId, Settings } from '@repo/protocol'
import { type ReactNode, useEffect, useState } from 'react'
import type { DeviceSpeech } from '../audio/use-speech.ts'
import { VoicePicker } from '../audio/voice-picker.tsx'
import { VoiceSetup } from '../audio/voice-setup.tsx'
import { EngineRows } from '../conversation/engine-rows.tsx'
import { MemorySection } from '../memory/memory-section.tsx'
import { PersonasForm } from '../personas/personas-form.tsx'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { IconButton } from '../primitives/icon-button.tsx'
import { CloseGlyph } from '../primitives/icons.tsx'
import { Kbd } from '../primitives/kbd.tsx'

export const SETTINGS_SECTIONS = ['personalities', 'voice', 'memory', 'engine'] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

const TITLES: Record<SettingsSection, string> = { personalities: 'Personalities', voice: 'Voice', memory: 'Memory', engine: 'Engine' }

export interface SettingsScreenProps {
  productName: string
  personas: Settings['personas']
  engines: EnginesState
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

/** The user's settings, one section at a time, with the sections listed on the left. Escape goes back. */
export function SettingsScreen({ productName, personas, engines, memory, speech, section: first, setPersonas, onPick, onClose }: SettingsScreenProps) {
  const [section, setSection] = useState<SettingsSection>(first)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <section aria-label="Settings" className="mx-auto flex h-full w-full max-w-5xl gap-12 px-8 pt-10">
      <nav aria-label="Sections" className="grid w-44 shrink-0 content-start gap-1">
        <Eyebrow className="mb-3 px-3">Settings</Eyebrow>
        {SETTINGS_SECTIONS.map((name) => (
          <button
            key={name}
            type="button"
            aria-current={section === name}
            onClick={() => setSection(name)}
            className={cn(
              'relative h-9 rounded-sm px-3 text-left text-sm transition duration-150 ease-soft',
              section === name
                ? 'bg-raised text-text before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-accent'
                : 'text-text-soft hover:bg-raised/60 hover:text-text'
            )}
          >
            {TITLES[name]}
          </button>
        ))}
      </nav>

      <div className="scroll-quiet min-w-0 flex-1 overflow-y-auto pb-16">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="font-medium text-3xl tracking-tight">{TITLES[section]}</h1>
          <div className="flex items-center gap-2">
            <Kbd>esc</Kbd>
            <IconButton label="Close settings" onClick={onClose}>
              <CloseGlyph />
            </IconButton>
          </div>
        </div>

        {section === 'personalities' && (
          <Block lead="What you call each personality, and which one answers. A name is what you say to talk to it.">
            <PersonasForm
              personas={personas.available}
              active={personas.active}
              submitLabel="Save"
              busyLabel="Saving…"
              doneLabel="Saved"
              onSubmit={setPersonas}
              onPick={onPick}
            />
          </Block>
        )}
        {section === 'voice' && (
          <Block lead="To hear you and answer aloud, this computer runs its own speech models. Your voice never leaves it.">
            {speech ? (
              <div className="grid gap-8">
                <VoiceSetup speech={speech} />
                <VoicePicker speech={speech} personas={personas.available} />
              </div>
            ) : (
              <p className="text-sm text-text-soft">This device cannot run speech models.</p>
            )}
          </Block>
        )}
        {section === 'memory' && (
          <Block
            lead={`${productName} keeps every word of your conversations, and while it sleeps it works out what is worth remembering about you. Here is what it knows, where it learned it, and when it sleeps.`}
          >
            <MemorySection memory={memory} productName={productName} />
          </Block>
        )}
        {section === 'engine' && (
          <Block lead={`${productName} runs on an AI program you already have, signed in with your own account. The first one that is ready is used.`}>
            <EngineRows engines={engines} />
          </Block>
        )}
      </div>
    </section>
  )
}

function Block({ lead, children }: { lead: string; children: ReactNode }) {
  return (
    <div className="grid gap-6">
      <p className="max-w-2xl text-text-soft leading-relaxed">{lead}</p>
      {children}
    </div>
  )
}
