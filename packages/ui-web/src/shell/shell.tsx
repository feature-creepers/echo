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
import { useFileActions } from '../files/file-actions.ts'
import { LibraryContext, type LibraryControls } from '../library/library-context.ts'
import { PinnedDocksView, usePinnedDocks } from '../library/pinned-docks.tsx'
import { PlayerProvider, usePlayer } from '../media/player-provider.tsx'
import { Onboarding } from '../onboarding/onboarding.tsx'
import { Orb } from '../presence/orb.tsx'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { IconButton } from '../primitives/icon-button.tsx'
import { SettingsGlyph, SheetGlyph, WidgetsGlyph } from '../primitives/icons.tsx'
import { SettingsScreen, type SettingsSection } from '../settings/settings-screen.tsx'
import { accentStyle } from '../styles/accent.ts'
import { DURATION, EASE } from '../styles/motion.ts'
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

type Screen = { is: 'main' } | { is: 'onboarding' } | { is: 'settings'; section: SettingsSection; widget?: string | undefined }

function Connected({ productName, client, engine }: { productName: string; client: Client; engine: SpeechEngine | undefined }) {
  const snapshot = useFollowed(client.settings)
  const speaking = useFollowed(client.speech)
  const [screen, setScreenState] = useState<Screen>()
  /** The screen showing, for the keys, which are listened to once. */
  const onScreen = useRef<Screen['is']>('main')
  /** The screen the app opened on, decided once, when the settings first arrive. */
  const entered = useRef<Screen>(undefined)
  /** The side sheet, open on a tab, and the tab it opens on next. */
  const [sheet, setSheet] = useState<SheetTab>()
  const lastTab = useRef<SheetTab>('transcript')
  const openSheet = useCallback((tab: SheetTab | undefined) => {
    if (tab) lastTab.current = tab
    setSheet(tab)
  }, [])
  // The side sheet belongs to the conversation: the settings close it, and it opens over the main screen
  // only, so opening it from the settings goes back to the conversation first.
  const setScreen = useCallback((next: Screen) => {
    if (next.is !== 'main') setSheet(undefined)
    setScreenState(next)
  }, [])
  /** The sheet as it is now, for the keys, which are listened to once. */
  const sheetNow = useRef<SheetTab>(undefined)
  sheetNow.current = sheet
  const toggleSheet = useCallback(
    (tab?: SheetTab) => {
      const wanted = tab ?? lastTab.current
      if (onScreen.current !== 'main') {
        setScreenState({ is: 'main' })
        return openSheet(wanted)
      }
      const open = sheetNow.current
      openSheet(open !== undefined && (tab === undefined || open === tab) ? undefined : wanted)
    },
    [openSheet]
  )
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
  }, [setScreen])

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

  // The pinned widgets: docked on both sides of the conversation in a wide window, behind a toggle in a narrow one.
  const library = useFollowed(client.library)
  const docks = usePinnedDocks(pinnedOf(library).length)

  // A saved widget opens in the settings, in their widgets section.
  const controls = useMemo<LibraryControls>(
    () => ({ library: client.library, open: (widget) => setScreen({ is: 'settings', section: 'widgets', widget }) }),
    [client]
  )
  const say = useCallback(
    (text: string) => {
      client.speech.stop()
      client.channel.say(text).catch(() => undefined)
    },
    [client]
  )
  /** What the blocks of a pinned or saved widget can do. Nothing there starts playing by itself. */
  const files = useFileActions()
  const actions = useMemo<ViewActions>(
    () => ({
      say,
      readFile: (file: string) => client.session.run('file.read', { file }),
      readShapes: (url: string) => client.session.run('shapes.read', { url }).then((read) => read.shapes),
      files
    }),
    [say, client, files]
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (transcriptKey !== '' && matchesShortcut(keyPress(event), transcriptKey, device.mac)) {
        event.preventDefault()
        toggleSheet('transcript')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [transcriptKey, device.mac, toggleSheet])

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
  onScreen.current = showing.is

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

  // Three buttons at most, from the left: the settings, the sidebar, and, while any is pinned, the pinned widgets.
  // Pressed from the settings, the widgets' button goes back to the main screen to show them.
  const widgetsShown = showing.is === 'main' && docks.shown
  const titleActions = (
    <>
      <IconButton
        label={showing.is === 'settings' ? 'Close settings' : 'Settings'}
        active={showing.is === 'settings'}
        onClick={() => (showing.is === 'settings' ? toMain() : setScreen({ is: 'settings', section: 'general' }))}
      >
        <SettingsGlyph />
      </IconButton>
      <IconButton
        label={sheet ? 'Hide the sidebar' : transcriptKey ? `Show the sidebar (${describeShortcut(transcriptKey, device.mac)})` : 'Show the sidebar'}
        active={sheet !== undefined}
        onClick={() => toggleSheet()}
      >
        <SheetGlyph />
      </IconButton>
      <AnimatePresence initial={false}>
        {docks.count > 0 && (
          <motion.span
            key="widgets"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DURATION.calm, ease: EASE }}
          >
            <IconButton
              label={widgetsShown ? 'Hide pinned widgets' : 'Show pinned widgets'}
              active={widgetsShown}
              onClick={() => {
                if (showing.is === 'main') return docks.toggle()
                toMain()
                docks.show()
              }}
            >
              <WidgetsGlyph />
            </IconButton>
          </motion.span>
        )}
      </AnimatePresence>
    </>
  )

  return (
    <LibraryContext.Provider value={controls}>
      <Frame productName={productName} accent={accent} actions={titleActions}>
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
                  widgets={{
                    controls,
                    actions,
                    selected: showing.widget,
                    onAsk: (text) => {
                      toMain()
                      say(text)
                    }
                  }}
                  setPersonas={setPersonas}
                  onPick={setPicked}
                  onClose={toMain}
                />
              ) : (
                // The conversation stays centred in the window whatever is pinned: the docks sit in the room on its sides.
                // Nothing clips here, so the light around the core runs on into the title row, which is the same ground.
                <div className="relative h-full">
                  <Stage
                    client={client}
                    personas={personas}
                    onSwitch={(persona) => setPersonas({ names: [], active: persona })}
                    onSetUpEngine={() => setScreen({ is: 'settings', section: 'models' })}
                    speech={speech.ready}
                    voiceLevel={speech.ready ? speech.level : undefined}
                    onSetUpVoice={engine ? () => setScreen({ is: 'settings', section: 'voice' }) : undefined}
                  />
                  <PinnedDocksView controls={controls} actions={actions} docks={docks} />
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
  children: ReactNode
}

/**
 * The window: the title row, and the screen under it, on one ground.
 *
 * The title row is no bar of its own: it is the top of the window, on the same ground as the rest, as in a
 * native app whose toolbar is part of its content. The window is dragged by it, and the system draws its buttons
 * (close, minimise, maximise) over it, on no colour of their own: the titlebar-area values say which part of the
 * row those leave free. Where the system draws a material behind the page, the ground tints it.
 */
function Frame({ productName, accent, actions, children }: FrameProps) {
  return (
    <div className="accent-shift relative flex h-screen flex-col overflow-hidden bg-(--window)" style={accentStyle(accent)}>
      <Ground />
      <header className="drag relative h-[env(titlebar-area-height,var(--frame-title-bar))] shrink-0">
        <div className="absolute top-[env(titlebar-area-y,0px)] left-[env(titlebar-area-x,0px)] flex h-[env(titlebar-area-height,var(--frame-title-bar))] w-[env(titlebar-area-width,100%)] items-center justify-between pr-2 pl-4">
          {/* The product's name, written small as a wordmark: lowercase here only, by its style, so it is still read as a name. */}
          <span className="font-semibold text-[0.8125rem] text-text-soft lowercase tracking-[-0.01em]">{productName}</span>
          <span className="no-drag flex items-center gap-0.5">{actions}</span>
        </div>
      </header>
      <main className="relative min-h-0 flex-1">{children}</main>
    </div>
  )
}

/**
 * The ground of every screen, title row included: fine, faint dots, and a little of the accent's light from the
 * top of the window.
 */
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
