import type { Client, CoreLink } from '@repo/client'
import { describeShortcut, matchesShortcut, pinnedOf } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import type { Accent, CommandInput, PersonaId } from '@repo/protocol'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { OPEN_ACCESS_EVENT } from '../access/access-indicator.tsx'
import type { SpeechEngine } from '../audio/engine.ts'
import { useDeviceSpeech } from '../audio/use-speech.ts'
import { Stage } from '../conversation/stage.tsx'
import { DeviceProvider, keyPress, useDevice } from '../device/device.tsx'
import type { DeviceHost } from '../device/host.ts'
import { LibraryContext, type LibraryControls } from '../library/library-context.ts'
import { LibraryScreen } from '../library/library-screen.tsx'
import { DOCKED_SHIFT, PinnedStack, usePinnedDock } from '../library/pinned-stack.tsx'
import { NowPlaying } from '../media/now-playing.tsx'
import { PlayerProvider, usePlayer } from '../media/player-provider.tsx'
import { Onboarding } from '../onboarding/onboarding.tsx'
import { Orb } from '../presence/orb.tsx'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { IconButton } from '../primitives/icon-button.tsx'
import { LibraryGlyph, PinnedGlyph, SettingsGlyph, SheetGlyph } from '../primitives/icons.tsx'
import { SettingsScreen, type SettingsSection } from '../settings/settings-screen.tsx'
import { accentStyle } from '../styles/accent.ts'
import { DURATION, EASE, glide } from '../styles/motion.ts'
import type { ViewActions } from '../view/context.ts'
import { type SheetTab, SideSheet } from './side-sheet.tsx'

export interface ShellProps {
  /** The name of the product, as the app that hosts the interface is called. */
  productName: string
  /** Where the app stands with its core. */
  link: CoreLink
  /** What the app holds while it is connected to its core. */
  client: Client | undefined
  /** The device's speech engines. Left out, the user types and the assistant's sentences are only shown. */
  speech?: SpeechEngine | undefined
  /** The app's keeping of this device's settings, its version and its updates. Left out, the settings of the device last until the window closes. */
  device?: DeviceHost | undefined
}

/** The event an app dispatches on the window to show the settings: from its tray, for instance. */
export const OPEN_SETTINGS_EVENT = 'echo:open-settings'

/**
 * The interface, whole: it decides what fills the window from where the app stands with its core and
 * from the user's settings.
 */
export function Shell({ device, ...rest }: ShellProps) {
  return (
    <DeviceProvider host={device}>
      <Screens {...rest} />
    </DeviceProvider>
  )
}

function Screens({ productName, link, client, speech }: Omit<ShellProps, 'device'>) {
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
  return (
    <PlayerProvider>
      <Connected productName={productName} client={client} engine={speech} />
    </PlayerProvider>
  )
}

type Screen = { is: 'main' } | { is: 'onboarding' } | { is: 'settings'; section: SettingsSection } | { is: 'library'; widget?: string | undefined }

function Connected({ productName, client, engine }: { productName: string; client: Client; engine: SpeechEngine | undefined }) {
  const snapshot = useFollowed(client.settings)
  const speaking = useFollowed(client.speech)
  const [screen, setScreen] = useState<Screen>()
  /** The screen the app opened on, decided once, when the settings first arrive. */
  const entered = useRef<Screen>(undefined)
  /** The side sheet, open on a tab, and the tab it opens on next. */
  const [sheet, setSheet] = useState<SheetTab>()
  const lastTab = useRef<SheetTab>('transcript')
  const openSheet = useCallback((tab: SheetTab | undefined) => {
    if (tab) lastTab.current = tab
    setSheet(tab)
  }, [])
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

  // A key of this device's settings opens and closes the transcript: Control or Command with T, unless changed.
  const device = useDevice()
  const transcriptKey = device.settings.shortcuts.transcript
  // What plays goes quiet under the assistant's voice, and comes back when it stops speaking.
  const player = usePlayer()
  useEffect(() => player.duck('speaking', speaking.sentence !== undefined), [player, speaking.sentence])
  // The assistant pauses, resumes or stops what plays when asked to: the player is the app's, not a view's.
  useEffect(
    () =>
      client.session.onEvent((event) => {
        if (event.name !== 'media.control') return
        const { source } = player.current()
        if (event.action === 'stop') player.stop()
        else if (event.action === 'pause') player.pause()
        else if (source) player.play(source)
      }),
    [client, player]
  )

  // The pinned widgets: docked beside the conversation in a wide window, behind a toggle in a narrow one.
  const library = useFollowed(client.library)
  const dock = usePinnedDock(pinnedOf(library).length)

  const controls = useMemo<LibraryControls>(() => ({ library: client.library, open: (widget) => setScreen({ is: 'library', widget }) }), [client])
  const say = useCallback(
    (text: string) => {
      client.speech.stop()
      client.channel.say(text).catch(() => undefined)
    },
    [client]
  )
  /** What the blocks of a pinned or saved widget can do. Nothing there starts playing by itself. */
  const actions = useMemo<ViewActions>(
    () => ({
      say,
      readFile: (file: string) => client.session.run('file.read', { file }),
      readShapes: (url: string) => client.session.run('shapes.read', { url }).then((read) => read.shapes)
    }),
    [say, client]
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (transcriptKey !== '' && matchesShortcut(keyPress(event), transcriptKey, device.mac)) {
        event.preventDefault()
        setSheet((open) => {
          if (open === 'transcript') return undefined
          lastTab.current = 'transcript'
          return 'transcript'
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [transcriptKey, device.mac])

  // The app asks for the settings: its tray's menu.
  useEffect(() => {
    const onOpen = () => setScreen({ is: 'settings', section: 'general' })
    // The bottom bar's access indicator opens its own section.
    const onAccess = () => setScreen({ is: 'settings', section: 'access' })
    window.addEventListener(OPEN_SETTINGS_EVENT, onOpen)
    window.addEventListener(OPEN_ACCESS_EVENT, onAccess)
    return () => {
      window.removeEventListener(OPEN_SETTINGS_EVENT, onOpen)
      window.removeEventListener(OPEN_ACCESS_EVENT, onAccess)
    }
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
        <Ground />
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

  const titleActions = (
    <>
      <NowPlaying />
      {showing.is === 'main' && dock.count > 0 && (
        <IconButton
          label={dock.shown ? `Hide the pinned widgets (${dock.count})` : `Show the pinned widgets (${dock.count})`}
          active={dock.shown}
          onClick={dock.toggle}
        >
          <PinnedGlyph />
        </IconButton>
      )}
      <IconButton label="Library" active={showing.is === 'library'} onClick={() => (showing.is === 'library' ? toMain() : setScreen({ is: 'library' }))}>
        <LibraryGlyph />
      </IconButton>
      <IconButton
        label={
          transcriptKey
            ? `Side sheet: transcript, threads, inspector (${describeShortcut(transcriptKey, device.mac)})`
            : 'Side sheet: transcript, threads, inspector'
        }
        active={sheet !== undefined}
        onClick={() => openSheet(sheet ? undefined : lastTab.current)}
      >
        <SheetGlyph />
      </IconButton>
      <IconButton
        label="Settings"
        active={showing.is === 'settings'}
        onClick={() => (showing.is === 'settings' ? toMain() : setScreen({ is: 'settings', section: 'general' }))}
      >
        <SettingsGlyph />
      </IconButton>
    </>
  )

  return (
    <LibraryContext.Provider value={controls}>
      <Frame productName={productName} accent={accent} actions={titleActions} split={showing.is !== 'main'}>
        <div className="relative h-full">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={showing.is}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0, transition: { duration: DURATION.calm, ease: EASE } }}
              exit={{ opacity: 0, transition: { duration: DURATION.quick, ease: EASE } }}
              className="h-full"
            >
              {showing.is === 'settings' ? (
                <SettingsScreen
                  productName={productName}
                  client={client}
                  settings={snapshot.settings}
                  memory={client.memory}
                  speech={engine ? speech : undefined}
                  section={showing.section}
                  setPersonas={setPersonas}
                  onPick={setPicked}
                  onClose={toMain}
                />
              ) : showing.is === 'library' ? (
                <LibraryScreen
                  controls={controls}
                  actions={actions}
                  selected={showing.widget}
                  onAsk={(text) => {
                    toMain()
                    say(text)
                  }}
                  onClose={toMain}
                />
              ) : (
                <div className="relative h-full overflow-hidden">
                  <Ground />
                  {/* With the pinned widgets docked, the conversation is centred in the space left of them. Moved, not laid out again. */}
                  <motion.div className="relative h-full" initial={false} animate={{ x: dock.shown && dock.wide ? DOCKED_SHIFT : 0 }} transition={glide}>
                    <Stage
                      client={client}
                      personas={personas}
                      onSwitch={(persona) => setPersonas({ names: [], active: persona })}
                      onSetUpEngine={() => setScreen({ is: 'settings', section: 'models' })}
                      speech={speech.ready}
                      voiceLevel={speech.ready ? speech.level : undefined}
                      onSetUpVoice={engine ? () => setScreen({ is: 'settings', section: 'voice' }) : undefined}
                    />
                  </motion.div>
                  <PinnedStack controls={controls} actions={actions} dock={dock} />
                </div>
              )}
            </motion.div>
          </AnimatePresence>
          {/* The sheet slides over whatever screen is there: it never pushes the stage off centre. */}
          <AnimatePresence initial={false}>
            {sheet && (
              <SideSheet key="sheet" client={client} personas={personas.available} tab={sheet} onTab={openSheet} onClose={() => openSheet(undefined)} />
            )}
          </AnimatePresence>
        </div>
      </Frame>
    </LibraryContext.Provider>
  )
}

interface FrameProps {
  productName: string
  /** The accent everything inside shows. Left out, the neutral one. */
  accent?: Accent | undefined
  /** What the title row offers on the right. */
  actions?: ReactNode
  /** The screen paints its own panes (a sidebar and its content), so the window's material shows in the sidebar. */
  split?: boolean
  children: ReactNode
}

/**
 * The window: the title row, and the screen under it.
 *
 * The title row is the window's own bar, as in a native app with a unified toolbar. The window is dragged by it,
 * and the system draws its buttons (close, minimise, maximise) over it: the titlebar-area values say which part
 * of the row those leave free. Where the system draws a material behind the page, the row and the screens tint it.
 */
function Frame({ productName, accent, actions, split = false, children }: FrameProps) {
  return (
    <div className="accent-shift relative flex h-screen flex-col overflow-hidden" style={accentStyle(accent)}>
      <header className="drag relative h-[calc(env(titlebar-area-height,var(--frame-title-bar))+1px)] shrink-0 border-black/50 border-b bg-(--window) shadow-[0_1px_0_rgb(255_255_255/0.035)]">
        <div className="absolute top-[env(titlebar-area-y,0px)] left-[env(titlebar-area-x,0px)] flex h-[env(titlebar-area-height,var(--frame-title-bar))] w-[env(titlebar-area-width,100%)] items-center justify-between pr-2 pl-4">
          <span className="font-semibold text-[0.8125rem] text-text-soft tracking-[-0.005em]">{productName}</span>
          <span className="no-drag flex items-center gap-0.5">{actions}</span>
        </div>
      </header>
      <main className={cn('relative min-h-0 flex-1', !split && 'bg-(--window)')}>{children}</main>
    </div>
  )
}

/** The ground of the main screen and of first launch: dense, faint dots, and a little of the accent's light from above. */
function Ground() {
  return (
    <>
      <div aria-hidden="true" className="dot-ground pointer-events-none absolute inset-0" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(56%_42%_at_50%_0%,color-mix(in_oklab,var(--accent)_8%,transparent),transparent_100%)]"
      />
    </>
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
