import type { Client, MemoryState } from '@repo/client'
import type { CommandInput, PersonaId, Settings } from '@repo/protocol'
import { motion } from 'motion/react'
import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react'
import { AccessSection } from '../access/access-section.tsx'
import { ActivitySection } from '../activity/activity-section.tsx'
import type { DeviceSpeech } from '../audio/use-speech.ts'
import { useDevice } from '../device/device.tsx'
import { FilesSection } from '../files/files-section.tsx'
import { WidgetsSection, type WidgetsSectionProps } from '../library/widgets-section.tsx'
import { MemorySection } from '../memory/memory-section.tsx'
import { PersonasForm } from '../personas/personas-form.tsx'
import { ScreenHeader } from '../primitives/screen-header.tsx'
import { Sidebar, SidebarGroup, SidebarItem } from '../primitives/sidebar.tsx'
import { RemindersSection } from '../schedule/reminders-section.tsx'
import { AboutSection } from '../settings/about-section.tsx'
import { GeneralSection } from '../settings/general-section.tsx'
import { MicrophoneSection } from '../settings/microphone-section.tsx'
import { ModelsSection } from '../settings/models-section.tsx'
import { ShortcutsSection } from '../settings/shortcuts-section.tsx'
import { VoiceSection } from '../settings/voice-section.tsx'
import { SHEET_CSS_WIDTH, sheetWidthStyle } from '../shell/sheet-width.ts'
import { slide } from '../styles/motion.ts'
import { asksToGoBack, BACK_BUTTON } from './going-back.ts'

/** Everything a page of the hub may draw with. */
export interface HubContext {
  productName: string
  client: Client
  /** The user's settings, from the core. */
  settings: Settings
  /** What the assistant knows about the user, and when it sleeps. */
  memory: MemoryState
  /** The device's speech. Left out, the device has none and the page says so. */
  speech: DeviceSpeech | undefined
  /** The widget library, for its page, and the widget to open there. */
  widgets: Omit<WidgetsSectionProps, 'onShown'>
  setPersonas(choice: CommandInput<'personas.set'>): Promise<void>
  onPick(persona: PersonaId): void
  /** Go back to the conversation. */
  onBack(): void
}

/** A page of the hub: its title, the paragraph that says what it holds, and what it shows. */
interface HubPageEntry {
  title: string
  lead(productName: string): string
  render(hub: HubContext): ReactNode
}

/**
 * Every page of the hub. A page is one entry here, listed in the sidebar by naming it in one of the groups below.
 * The settings themselves stay in the settings folder: here they are pages among others.
 */
const PAGES = {
  widgets: {
    title: 'Widgets',
    lead: (name) => `The views you saved from what ${name} showed you. Pin them beside the conversation, sort them into collections, or ask for a change.`,
    render: (hub) => <WidgetsSection {...hub.widgets} onShown={hub.onBack} />
  },
  files: {
    title: 'Files',
    lead: (name) => `What ${name} keeps in its own folder: the files you hand it, in its inbox, and the files it writes for you.`,
    render: (hub) => <FilesSection client={hub.client} productName={hub.productName} />
  },
  memory: {
    title: 'Memory',
    lead: (name) =>
      `${name} keeps every word of your conversations, and while it sleeps it works out what is worth remembering about you. Here is what it knows, where it learned it, and when it sleeps.`,
    render: (hub) => <MemorySection memory={hub.memory} productName={hub.productName} />
  },
  activity: {
    title: 'Activity',
    lead: (name) =>
      `Everything ${name} did on this computer: each file it read or changed, each command it ran and each action on a web page, what was decided, and how it went.`,
    render: (hub) => <ActivitySection client={hub.client} productName={hub.productName} />
  },
  reminders: {
    title: 'Reminders',
    lead: (name) =>
      `What you asked ${name} to do later: reminders it says at their time, and tasks it carries out as if you had just asked, once or again and again.`,
    render: (hub) => <RemindersSection client={hub.client} productName={hub.productName} />
  },
  general: {
    title: 'General',
    lead: (name) => `How ${name} starts and stops on this computer, and where it keeps what it writes.`,
    render: (hub) => <GeneralSection productName={hub.productName} />
  },
  voice: {
    title: 'Voice',
    lead: () => 'To hear you and answer aloud, this computer runs its own speech models. Your voice never leaves it.',
    render: (hub) => {
      const { personas, languages, interruptions, vocabulary } = hub.settings
      const active = personas.available.find((persona) => persona.id === personas.active)
      return (
        <VoiceSection
          client={hub.client}
          languages={languages}
          interruptions={interruptions}
          vocabulary={vocabulary}
          speech={hub.speech}
          personas={personas.available}
          active={active}
        />
      )
    }
  },
  microphone: {
    title: 'Microphone',
    lead: () => 'The microphone it listens with, and when it stops listening. Talk to check that it hears you.',
    render: () => <MicrophoneSection />
  },
  shortcuts: {
    title: 'Shortcuts',
    lead: (name) => `The keys that call ${name}. Click one, then press the keys you want.`,
    render: (hub) => <ShortcutsSection productName={hub.productName} />
  },
  personalities: {
    title: 'Personalities',
    lead: () => 'What you call each personality, and which one answers. A name is what you say to talk to it.',
    render: (hub) => (
      <PersonasForm
        personas={hub.settings.personas.available}
        active={hub.settings.personas.active}
        submitLabel="Save"
        busyLabel="Saving…"
        doneLabel="Saved"
        onSubmit={hub.setPersonas}
        onPick={hub.onPick}
      />
    )
  },
  models: {
    title: 'Models',
    lead: (name) =>
      `${name} runs on an AI program you already have, signed in with your own account. Choose the model it answers with: these choices follow you, not this computer.`,
    render: (hub) => <ModelsSection client={hub.client} settings={hub.settings} />
  },
  access: {
    title: 'Access',
    lead: (name) =>
      `What ${name} may reach on this computer: its own folder, the folders and files you give it, or everything. It is held to this on every use, whatever it is asked.`,
    render: (hub) => <AccessSection client={hub.client} settings={hub.settings} productName={hub.productName} />
  },
  about: {
    title: 'Updates & about',
    lead: (name) => `The version of ${name} on this computer, and its updates.`,
    render: (hub) => <AboutSection productName={hub.productName} />
  }
} satisfies Record<string, HubPageEntry>

export type HubPage = keyof typeof PAGES
export const HUB_PAGES = Object.keys(PAGES) as HubPage[]

/**
 * The groups of the sidebar, in order. The library holds what the assistant keeps for the user; the settings are
 * split by where each is kept: on this computer, or with the assistant, which follows the user from one device
 * to the next (docs/SPEC.md, section 5.2).
 */
const GROUPS: { title: string; pages: HubPage[] }[] = [
  { title: 'Library', pages: ['widgets', 'files', 'memory', 'reminders', 'activity'] },
  { title: 'This computer', pages: ['general', 'voice', 'microphone', 'shortcuts'] },
  { title: 'Your assistant', pages: ['personalities', 'models', 'access'] }
]

/** What stands apart, at the bottom of the sidebar. */
const APART: HubPage[] = ['about']

export interface HubScreenProps extends HubContext {
  /** The page open. */
  page: HubPage
  onPage(page: HubPage): void
  /** The side sheet is open and the hub keeps room for it on the right, so nothing of the page is under it. */
  sheetRoom: boolean
}

/**
 * Library and settings: the screen that covers the main one, a hub of pages listed in a sidebar, as native
 * settings are, with the page open beside it. The way back to the conversation is the first row of the sidebar;
 * Escape, the mouse's back button, Alt and Left (Command and [ on a Mac) go back too.
 */
export function HubScreen({ page, onPage, sheetRoom, ...hub }: HubScreenProps) {
  const { onBack } = hub
  const { mac, settings: device } = useDevice()
  const scroller = useRef<HTMLDivElement>(null)
  const entry: HubPageEntry = PAGES[page]

  // Each page opens at its top.
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0
  }, [page])

  useEffect(() => {
    // A dialog over the hub, such as an open widget, is closed first: going back waits for it.
    const covered = () => document.querySelector('[aria-modal="true"]') !== null
    const onKey = (event: KeyboardEvent) => {
      // A dialog or a shortcut being recorded takes Escape before the hub, and marks it as handled.
      if (event.defaultPrevented || event.repeat) return
      const plainEscape = event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
      const press = { key: event.key, code: event.code, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey }
      if (!plainEscape && (!asksToGoBack(press, mac) || covered())) return
      event.preventDefault()
      onBack()
    }
    const onMouse = (event: MouseEvent) => {
      if (event.button !== BACK_BUTTON) return
      // Pressed, it is kept from doing anything else; released, it goes back.
      event.preventDefault()
      if (event.type === 'mouseup' && !covered()) onBack()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onMouse)
    window.addEventListener('mouseup', onMouse)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onMouse)
      window.removeEventListener('mouseup', onMouse)
    }
  }, [onBack, mac])

  const item = (name: HubPage) => (
    <SidebarItem key={name} on={page === name} onClick={() => onPage(name)}>
      {PAGES[name].title}
    </SidebarItem>
  )

  return (
    // A split view, as native settings are: the pages in a sidebar on the left, the one open beside it.
    <section aria-label="Library and settings" className="relative flex h-full w-full">
      <Sidebar label="Pages" back={{ label: 'Back to conversation', onBack }} footer={APART.map(item)}>
        {GROUPS.map((group) => (
          <SidebarGroup key={group.title} title={group.title}>
            {group.pages.map(item)}
          </SidebarGroup>
        ))}
      </Sidebar>

      {/* With the side sheet open and room for both, the page ends where the sheet starts. It changes place once,
          and its column glides there with the sheet, moved only by a transform. */}
      <motion.div
        ref={scroller}
        layoutScroll
        className="scroll-quiet min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
        data-sheet-width
        style={{ ...sheetWidthStyle(device.sheet.width), marginRight: sheetRoom ? SHEET_CSS_WIDTH : 0 }}
      >
        <motion.div layout="position" layoutDependency={sheetRoom} transition={slide} className="mx-auto w-full max-w-[60rem] px-10 pt-7 pb-16">
          <div className="mb-6">
            <ScreenHeader title={entry.title} />
          </div>
          <div className="grid grid-cols-1 gap-7">
            <p className="-mt-3 max-w-2xl text-[0.8125rem] text-text-soft leading-relaxed">{entry.lead(hub.productName)}</p>
            {entry.render(hub)}
          </div>
        </motion.div>
      </motion.div>
    </section>
  )
}
