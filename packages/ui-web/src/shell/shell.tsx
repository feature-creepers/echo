import type { Client, CoreLink } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import type { Accent, CommandInput, PersonaId } from '@repo/protocol'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import type { SpeechEngine } from '../audio/engine.ts'
import { useDeviceSpeech } from '../audio/use-speech.ts'
import { Stage } from '../conversation/stage.tsx'
import { Transcript } from '../conversation/transcript.tsx'
import { Onboarding } from '../onboarding/onboarding.tsx'
import { Orb } from '../presence/orb.tsx'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { IconButton } from '../primitives/icon-button.tsx'
import { SettingsGlyph, TranscriptGlyph } from '../primitives/icons.tsx'
import { SettingsScreen, type SettingsSection } from '../settings/settings-screen.tsx'
import { accentStyle } from '../styles/accent.ts'

export interface ShellProps {
  /** The name of the product, as the app that hosts the interface is called. */
  productName: string
  /** Where the app stands with its core. */
  link: CoreLink
  /** What the app holds while it is connected to its core. */
  client: Client | undefined
  /** The device's speech engines. Left out, the user types and the assistant's sentences are only shown. */
  speech?: SpeechEngine | undefined
}

/**
 * The interface, whole: it decides what fills the window from where the app stands with its core and
 * from the user's settings.
 */
export function Shell({ productName, link, client, speech }: ShellProps) {
  if (link.state === 'failed') {
    return (
      <Frame productName={productName}>
        <Notice problem title="Not connected" detail={link.reason} />
      </Frame>
    )
  }
  if (link.state === 'starting' || !client) {
    return (
      <Frame productName={productName}>
        <Notice title="Starting" />
      </Frame>
    )
  }
  return <Connected productName={productName} client={client} engine={speech} />
}

type Screen = { is: 'main' } | { is: 'onboarding' } | { is: 'settings'; section: SettingsSection }

function Connected({ productName, client, engine }: { productName: string; client: Client; engine: SpeechEngine | undefined }) {
  const snapshot = useFollowed(client.settings)
  const channel = useFollowed(client.channel)
  const threads = useFollowed(client.threads)
  const [screen, setScreen] = useState<Screen>()
  /** The screen the app opened on, decided once, when the settings first arrive. */
  const entered = useRef<Screen>(undefined)
  const [transcript, setTranscript] = useState(false)
  /** The persona the user is about to pick in a form, shown in its accent before anything is sent. */
  const [picked, setPicked] = useState<PersonaId>()

  const settled = snapshot.state === 'ready' ? snapshot.settings.personas : undefined
  const speech = useDeviceSpeech(
    engine,
    client,
    settled?.available.find((persona) => persona.id === settled.active)
  )

  const setPersonas = useCallback(
    async (choice: CommandInput<'personas.set'>) => {
      await client.session.run('personas.set', choice)
      setPicked(undefined)
    },
    [client]
  )
  const toMain = useCallback(() => {
    setPicked(undefined)
    setScreen({ is: 'main' })
  }, [])

  // Control or Command with T opens and closes the transcript.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 't') {
        event.preventDefault()
        setTranscript((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (snapshot.state === 'loading') {
    return (
      <Frame productName={productName}>
        <Notice title="Starting" />
      </Frame>
    )
  }
  if (snapshot.state === 'failed') {
    return (
      <Frame productName={productName}>
        <Notice problem title="The settings could not be read" detail={snapshot.reason} />
      </Frame>
    )
  }

  const { personas } = snapshot.settings
  const accent = personas.available.find((persona) => persona.id === (picked ?? personas.active))?.accent
  // First launch is for someone whose personas were not confirmed when the app opened. Once in it, the user
  // stays in it until its last step, although the personas are confirmed halfway through.
  entered.current ??= personas.confirmed ? { is: 'main' } : { is: 'onboarding' }
  const showing: Screen = screen ?? entered.current

  if (showing.is === 'onboarding') {
    return (
      <Frame productName={productName} accent={accent}>
        <Onboarding
          productName={productName}
          personas={personas}
          engines={client.engines}
          speech={engine ? speech : undefined}
          setPersonas={setPersonas}
          onPick={setPicked}
          onDone={toMain}
        />
      </Frame>
    )
  }

  const actions = (
    <>
      <IconButton label="Transcript (Ctrl+T)" active={transcript} onClick={() => setTranscript((open) => !open)}>
        <TranscriptGlyph />
      </IconButton>
      <IconButton
        label="Settings"
        active={showing.is === 'settings'}
        onClick={() => (showing.is === 'settings' ? toMain() : setScreen({ is: 'settings', section: 'personalities' }))}
      >
        <SettingsGlyph />
      </IconButton>
    </>
  )

  return (
    <Frame productName={productName} accent={accent} actions={actions}>
      <div className="flex h-full">
        <div className="relative min-w-0 flex-1">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={showing.is}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="h-full"
            >
              {showing.is === 'settings' ? (
                <SettingsScreen
                  productName={productName}
                  personas={personas}
                  engines={client.engines}
                  speech={engine ? speech : undefined}
                  section={showing.section}
                  setPersonas={setPersonas}
                  onPick={setPicked}
                  onClose={toMain}
                />
              ) : (
                <Stage
                  client={client}
                  personas={personas}
                  onSwitch={(persona) => setPersonas({ names: [], active: persona })}
                  onSetUpEngine={() => setScreen({ is: 'settings', section: 'engine' })}
                  speech={speech.ready}
                  voiceLevel={speech.ready ? speech.level : undefined}
                  onSetUpVoice={engine ? () => setScreen({ is: 'settings', section: 'voice' }) : undefined}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
        <AnimatePresence initial={false}>
          {transcript && (
            <motion.div
              key="transcript"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 'auto', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              className="h-full overflow-hidden"
            >
              <Transcript
                exchanges={channel.exchanges}
                personas={personas.available}
                threads={threads}
                onFocus={(thread) => void client.threads.focus(thread).catch(() => undefined)}
                onClose={() => setTranscript(false)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Frame>
  )
}

interface FrameProps {
  productName: string
  /** The accent everything inside shows. Left out, the neutral one. */
  accent?: Accent | undefined
  /** What the title row offers on the right. */
  actions?: ReactNode
  children: ReactNode
}

/**
 * The window: a ground with a wash of the accent, the title row, and the screen under it.
 *
 * The title row is the window's own bar. The window is dragged by it, and the system draws its buttons
 * (close, minimise, maximise) over it: the titlebar-area values say which part of the row those leave free.
 */
function Frame({ productName, accent, actions, children }: FrameProps) {
  return (
    <div className="accent-shift relative flex h-screen flex-col overflow-hidden bg-ground" style={accentStyle(accent)}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_50%_at_50%_0%,color-mix(in_oklab,var(--accent)_13%,transparent),transparent_70%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,var(--color-line-strong)_1px,transparent_1px)] bg-[size:28px_28px] opacity-25 [mask-image:radial-gradient(60%_60%_at_50%_45%,black,transparent)]"
      />
      <header className="drag relative h-[calc(env(titlebar-area-height,var(--frame-title-bar))+1px)] shrink-0 border-line border-b">
        <div className="absolute top-[env(titlebar-area-y,0px)] left-[env(titlebar-area-x,0px)] flex h-[env(titlebar-area-height,var(--frame-title-bar))] w-[env(titlebar-area-width,100%)] items-center justify-between pr-2 pl-4">
          <span className="flex items-center gap-2.5 font-medium font-mono text-xs lowercase tracking-[0.22em]">
            <span className="size-1.5 rounded-full bg-accent shadow-[0_0_10px_var(--accent)]" />
            {productName}
          </span>
          <span className="no-drag flex items-center gap-0.5">{actions}</span>
        </div>
      </header>
      <main className="relative min-h-0 flex-1">{children}</main>
    </div>
  )
}

/** What fills the window when there is nothing else to show: the app is starting, or it could not. */
function Notice({ title, detail, problem = false }: { title: string; detail?: string; problem?: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center" role={problem ? 'alert' : 'status'}>
      {!problem && <Orb size={120} mood="thinking" />}
      <Eyebrow className={problem ? 'text-danger' : undefined}>{title}</Eyebrow>
      {detail !== undefined && <p className="max-w-xl text-sm text-text-soft leading-relaxed [overflow-wrap:anywhere]">{detail}</p>}
    </div>
  )
}
