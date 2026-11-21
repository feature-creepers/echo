import type { Client, CoreLink } from '@repo/client'
import { describeShortcut, followServices, matchesShortcut, pinnedOf } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import type { Accent, CommandInput, PersonaId, TurnId } from '@repo/protocol'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, type Ref, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { SpeechEngine } from '../audio/engine.ts'
import { useDeviceSpeech } from '../audio/use-speech.ts'
import { Stage } from '../conversation/stage.tsx'
import { useCoreViewActions } from '../conversation/view-actions.ts'
import { DeviceProvider, keyPress, useDevice } from '../device/device.tsx'
import type { DeviceHost } from '../device/host.ts'
import { type MiniWindow, useMiniWindow } from '../device/mini.ts'
import { QuickLook } from '../files/quick-look.tsx'
import { type HubPage, HubScreen } from '../hub/hub-screen.tsx'
import { HUB_KEEPS, STAGE_KEEPS } from '../hub/room.ts'
import { LibraryContext, type LibraryControls } from '../library/library-context.ts'
import { PinnedDocksView, usePinnedDocks } from '../library/pinned-docks.tsx'
import { PlayerProvider, usePlayer } from '../media/player-provider.tsx'
import { Onboarding } from '../onboarding/onboarding.tsx'
import { Eye } from '../presence/eye.tsx'
import { Button } from '../primitives/button.tsx'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { IconButton } from '../primitives/icon-button.tsx'
import { LibraryGlyph, SheetGlyph, WidgetsGlyph } from '../primitives/icons.tsx'
import { accentStyle } from '../styles/accent.ts'
import { DURATION, EASE } from '../styles/motion.ts'
import { FIRST_SHEET_PLACE, moveSheet, type SheetTab } from './sheet-place.ts'
import { previewSheetWidth } from './sheet-width.ts'
import { SideSheet } from './side-sheet.tsx'

export interface ShellProps {
  /** The name of the product, as the app that hosts the interface is called. */
  productName: string
  /** Where the app stands with its core. */
  link: CoreLink
  /** What the app holds while it is connected to its core. */
  client: Client | undefined
  /** The device's speech engines. Left out, the person types and the assistant's sentences are only shown. */
  speech?: SpeechEngine | undefined
  /** The app's keeping of this device's settings, its version and its updates. Left out, the settings of the device last until the window closes. */
  device?: DeviceHost | undefined
}

/** The event an app dispatches on the window to show the settings, on their general page: from its tray, for instance. */
export const OPEN_SETTINGS_EVENT = 'echo:open-settings'

/** What the title row's button to the hub, and the hub itself, are called where the person reads them. */
const HUB_NAME = 'Library and settings'

/** The window's own buttons are bare glyphs: what they open shows in the full ink, never on a plane. */
const FLAT = 'hover:bg-transparent active:bg-transparent active:text-text-soft aria-pressed:bg-transparent'

/**
 * The interface, whole: it decides what fills the window from where the app stands with its core and
 * from the person's settings.
 */
export function Shell({ device, ...rest }: ShellProps) {
  return (
    <DeviceProvider host={device}>
      <Screens {...rest} />
    </DeviceProvider>
  )
}

function Screens({ productName, link, client, speech }: Omit<ShellProps, 'device'>) {
  const mini = useMiniWindow()
  if (link.state === 'failed') {
    return (
      <Frame productName={productName} mini={mini}>
        <Notice problem title="Not connected" detail={link.reason} />
      </Frame>
    )
  }
  if (link.state === 'starting' || !client) {
    return (
      <Frame productName={productName} mini={mini}>
        <Notice title="Starting" />
      </Frame>
    )
  }
  return (
    <PlayerProvider>
      <Connected productName={productName} client={client} engine={speech} mini={mini} />
    </PlayerProvider>
  )
}

type Screen = { is: 'main' } | { is: 'onboarding' } | { is: 'hub'; page: HubPage; widget?: string | undefined }

function Connected({ productName, client, engine, mini }: { productName: string; client: Client; engine: SpeechEngine | undefined; mini: MiniWindow }) {
  const snapshot = useFollowed(client.settings)
  const speaking = useFollowed(client.speech)
  const [screen, setScreen] = useState<Screen>()
  /** The screen the app opened on, decided once, when the settings first arrive. */
  const entered = useRef<Screen>(undefined)
  /** The page of the hub last shown in this run of the app, which its button opens on: the widgets at first. */
  const lastPage = useRef<HubPage>('widgets')
  // The hub needs the full window: from Mini, the window goes back to it first.
  const leaveMini = mini.on ? mini.set : undefined
  const openHub = useCallback(
    (page: HubPage = lastPage.current, widget?: string) => {
      leaveMini?.(false)
      lastPage.current = page
      setScreen({ is: 'hub', page, widget })
    },
    [leaveMini]
  )

  /**
   * Where the side sheet stands: open on a tab or closed, and where each tab is. It opens and closes over whatever
   * screen shows, and stays open from one screen to the next. Held here, so that anything on the screen can open it
   * on a place: a line's full answer, a thread at work.
   */
  const [sheetPlace, moveSheetTo] = useReducer(moveSheet, FIRST_SHEET_PLACE)
  const sheet = sheetPlace.open
  const toggleSheet = useCallback((tab?: SheetTab) => moveSheetTo({ to: 'toggle', tab }), [])
  const openAnswer = useCallback((turn: TurnId) => moveSheetTo({ to: 'answer', turn }), [])
  const openThread = useCallback((thread: string | undefined) => moveSheetTo({ to: 'thread', thread }), [])
  /** The persona the person is about to pick in a form, shown in its accent before anything is sent. */
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
        const { source, volume, position } = player.current()
        switch (event.action) {
          case 'stop':
            return player.stop()
          case 'pause':
            return player.pause()
          case 'resume':
            return source && player.play(source)
          case 'volume':
            return player.setVolume(event.level ?? volume + (event.step ?? 0))
          case 'seek':
            return player.seek(event.to ?? position + (event.by ?? 0))
          case 'queue':
            return event.source && player.enqueue(event.source)
          case 'next':
            return player.next()
          case 'clear-queue':
            return player.clearQueue()
        }
      }),
    [client, player]
  )

  // The pinned widgets: docked on both sides of the conversation in a wide window, behind a toggle in a narrow one.
  const library = useFollowed(client.library)
  // The docks measure the room the screen has beside the side sheet, however it changes.
  const [screenArea, setScreenArea] = useState<HTMLDivElement | null>(null)
  const docks = usePinnedDocks(pinnedOf(library).length, screenArea)

  // A saved widget opens in the library, on its widgets page.
  // The services widget apps call, followed while the window shows the conversation.
  const services = useMemo(() => followServices(client.session), [client])
  useEffect(() => () => services.unfollow(), [services])
  const controls = useMemo<LibraryControls>(
    () => ({ library: client.library, services, session: client.session, open: (widget) => openHub('widgets', widget) }),
    [client, services, openHub]
  )
  const say = useCallback(
    (text: string) => {
      client.speech.stop()
      client.channel.say(text).catch(() => undefined)
    },
    [client]
  )
  /** What the blocks of a pinned or saved widget can do. */
  const actions = useCoreViewActions(client, say)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (transcriptKey === '' || !matchesShortcut(keyPress(event), transcriptKey, device.mac)) return
      event.preventDefault()
      // Mini has no room for the sheet: the window goes back to the full one, and shows the transcript there.
      if (!leaveMini) return toggleSheet('transcript')
      leaveMini(false)
      moveSheetTo({ to: 'tab', tab: 'transcript' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [transcriptKey, device.mac, toggleSheet, leaveMini])

  // The app asks for the settings: its tray's menu opens them on their general page.
  useEffect(() => {
    const onOpen = () => openHub('general')
    window.addEventListener(OPEN_SETTINGS_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, onOpen)
  }, [openHub])

  // How wide the person made the side sheet, kept on this device. While its edge is dragged, the width is written
  // straight to the page, once a frame, so nothing is drawn again; it is kept when the drag ends.
  const sheetWidth = device.settings.sheet.width
  const changeDevice = device.change
  const sheetArea = useRef<HTMLDivElement>(null)
  const previewWidth = useCallback((width: number) => previewSheetWidth(sheetArea.current, width), [])
  const keepSheetWidth = useCallback((width: number) => changeDevice({ sheet: { width } }), [changeDevice])

  if (snapshot.state === 'loading') {
    return (
      <Frame productName={productName} mini={mini}>
        <Notice title="Starting" />
      </Frame>
    )
  }
  if (snapshot.state === 'failed') {
    return (
      <Frame productName={productName} mini={mini}>
        <Notice problem title="The settings could not be read" detail={snapshot.reason} />
      </Frame>
    )
  }

  const { personas } = snapshot.settings
  const shownPersona = personas.available.find((persona) => persona.id === (picked ?? personas.active))
  const accent = shownPersona?.accent
  // First launch is for someone whose personas were not confirmed when the app opened. Once in it, the person
  // stays in it until its last step, although the personas are confirmed halfway through.
  entered.current ??= personas.confirmed ? { is: 'main' } : { is: 'onboarding' }
  // Mini shows the main screen, whatever the full window shows, and gives it back once it leaves.
  const chosen: Screen = screen ?? entered.current
  const showing: Screen = mini.on && chosen.is === 'hub' ? { is: 'main' } : chosen

  if (showing.is === 'onboarding' && mini.on) {
    return (
      <Frame productName={productName} accent={accent} mini={mini}>
        <Notice title="Set up in the full window" />
      </Frame>
    )
  }
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

  // Three buttons at most, from the left: the library and settings, the sidebar, and, while any is pinned, the
  // pinned widgets. Pressed from the hub, the widgets' button goes back to the main screen to show them.
  const widgetsShown = showing.is === 'main' && docks.shown
  const cornerActions = (
    <>
      <IconButton label={HUB_NAME} active={showing.is === 'hub'} onClick={() => (showing.is === 'hub' ? toMain() : openHub())} className={FLAT}>
        <LibraryGlyph />
      </IconButton>
      <IconButton
        label={sheet ? 'Hide the sidebar' : transcriptKey ? `Show the sidebar (${describeShortcut(transcriptKey, device.mac)})` : 'Show the sidebar'}
        active={sheet !== undefined}
        onClick={() => toggleSheet()}
        className={FLAT}
      >
        <SheetGlyph />
      </IconButton>
    </>
  )
  const titleActions = (
    <>
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
              className={FLAT}
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
      <Frame
        productName={productName}
        accent={accent}
        actions={titleActions}
        corner={cornerActions}
        mini={mini}
        frameRef={sheetArea}
        sideOpen={sheet !== undefined && !mini.on}
        // The sheet takes its width from the window, top to bottom, and stays from one screen to the next: the
        // screen beside it narrows, so nothing is ever under it.
        side={
          <AnimatePresence initial={false}>
            {sheet && !mini.on && (
              <SideSheet
                key="sheet"
                client={client}
                personas={personas.available}
                place={sheetPlace}
                tab={sheet}
                onMove={moveSheetTo}
                onOpenMemory={() => openHub('memory')}
                resize={{
                  width: sheetWidth,
                  keep: showing.is === 'hub' ? HUB_KEEPS : STAGE_KEEPS,
                  onPreview: previewWidth,
                  onCommit: keepSheetWidth
                }}
              />
            )}
          </AnimatePresence>
        }
      >
        <div className="flex h-full">
          <div ref={setScreenArea} className="relative h-full min-w-0 flex-1">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={showing.is}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0, transition: { duration: DURATION.calm, ease: EASE } }}
                exit={{ opacity: 0, transition: { duration: DURATION.quick, ease: EASE } }}
                className="h-full"
              >
                {showing.is === 'hub' ? (
                  <HubScreen
                    productName={productName}
                    client={client}
                    settings={snapshot.settings}
                    memory={client.memory}
                    speech={engine ? speech : undefined}
                    page={showing.page}
                    onPage={(page) => openHub(page)}
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
                    onBack={toMain}
                  />
                ) : (
                  // The composer stays centred in the window whatever is pinned; the answers take the room between
                  // the docks while they stand beside it.
                  <div className="relative h-full">
                    <Stage
                      client={client}
                      personas={personas}
                      onSwitch={(persona) => setPersonas({ names: [], active: persona })}
                      onSetUpEngine={() => openHub('models')}
                      onOpenAccess={() => openHub('access')}
                      speech={speech.ready}
                      voiceLevel={speech.ready ? speech.level : undefined}
                      onSetUpVoice={engine ? () => openHub('voice') : undefined}
                      onOpenAnswer={openAnswer}
                      onOpenThread={openThread}
                      mini={mini.on ? { onFullWindow: () => mini.set(false) } : undefined}
                      docked={docks.wide && docks.shown}
                    />
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
            {/* A file shown from any view, the stream's, a pinned widget's or a saved one's, opens in one quick look. */}
            {/* The pinned widgets are drawn whatever screen shows, hidden in Mini and on the hub, so each keeps its
                state and a widget app keeps running (docs/SPEC.md, section 9.9). */}
            <div className={mini.on || showing.is === 'hub' ? 'hidden' : 'contents'}>
              <PinnedDocksView controls={controls} actions={actions} docks={docks} />
            </div>
            <QuickLook client={client} />
          </div>
        </div>
      </Frame>
    </LibraryContext.Provider>
  )
}

interface FrameProps {
  productName: string
  /** The accent everything inside shows. Left out, the neutral one. */
  accent?: Accent | undefined
  /** What the title row offers, beside the product's name. */
  actions?: ReactNode
  /**
   * The window's own buttons, in its top right corner just left of the system's controls, as T3 Code places its panel
   * toggles: they stand there whether the side is open or not, over its top when it is.
   */
  corner?: ReactNode
  /** Mini: the window has no title row, only the way back to the full window. */
  mini?: MiniWindow | undefined
  /** What stands beside the screen, the whole height of the window, its own top holding the system's controls: the side sheet. */
  side?: ReactNode
  /** The side is open: the title row then ends where it starts, since the side's top holds the system's controls. */
  sideOpen?: boolean
  /** The window's frame, where a width being dragged is written. */
  frameRef?: Ref<HTMLDivElement>
  children: ReactNode
}

/**
 * The window: the title row, and the screen under it, on one ground.
 *
 * The title row is no bar of its own: it is the top of the window, on the same ground as the rest, as in a
 * native app whose toolbar is part of its content. The window is dragged by it, and the system draws its buttons
 * (close, minimise, maximise) over it, on no colour of their own: the titlebar-area values say which part of the
 * row those leave free. Where the system draws a material behind the page, the ground tints it.
 *
 * In Mini the whole ground drags the window, and the row keeps only a quiet way back to the full window, at its left,
 * shown while the pointer is over the window or the keyboard is in it; on Windows and Linux the system's buttons stay
 * over its right end, and what Mini shows starts under them.
 */
function Frame({ productName, accent, actions, corner, mini, side, sideOpen = false, frameRef, children }: FrameProps) {
  return (
    // Clipped, not hidden: what slides in or out past an edge (the side sheet, the pinned widgets) is cut there, and
    // the window can never be scrolled sideways, not even by bringing something into view or giving it the keyboard.
    <div
      ref={frameRef}
      className={cn('accent-shift relative flex h-screen overflow-clip bg-ground', mini?.on && 'group/mini drag')}
      style={accentStyle(accent)}
    >
      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="drag relative h-[env(titlebar-area-height,var(--frame-title-bar))] shrink-0">
          {mini?.on ? (
            <FullWindowButton onPress={() => mini.set(false)} />
          ) : (
            <div
              className={cn(
                'absolute top-[env(titlebar-area-y,0px)] left-[env(titlebar-area-x,0px)] flex h-[env(titlebar-area-height,var(--frame-title-bar))] items-center gap-2 pr-2 pl-4',
                // The system's controls sit over the side's top while it is open: the row runs to the side's edge.
                sideOpen ? 'right-0' : 'w-[env(titlebar-area-width,100%)]'
              )}
            >
              {/* The product's name, written small as a wordmark: lowercase here only, by its style, so it is still read as a name. */}
              <span className="font-semibold text-[0.8125rem] text-text-soft lowercase tracking-[-0.01em]">{productName}</span>
              <span className="no-drag flex items-center gap-0.5">{actions}</span>
            </div>
          )}
        </header>
        <main className="relative min-h-0 flex-1">{children}</main>
      </div>
      {side}
      {corner && !mini?.on && (
        <div className="no-drag fixed top-[env(titlebar-area-y,0px)] right-[calc(100vw-env(titlebar-area-x,0px)-env(titlebar-area-width,100vw)+0.5rem)] z-50 flex h-[env(titlebar-area-height,var(--frame-title-bar))] items-center gap-0.5">
          {corner}
        </div>
      )}
    </div>
  )
}

/** Mini's way back to the full window, at the left of the row: quiet, shown while the pointer is over the window or the keyboard is in it. */
function FullWindowButton({ onPress }: { onPress(): void }) {
  const focused = useWindowFocused()
  return (
    <div className="absolute inset-y-0 left-0 flex items-center pl-2">
      <Button
        kind="quiet"
        size="sm"
        onClick={onPress}
        className={cn('no-drag opacity-0 group-hover/mini:opacity-100 focus-visible:opacity-100', focused && 'opacity-100')}
      >
        Full window
      </Button>
    </div>
  )
}

/** Whether the window has the keyboard: the person is in it, rather than in another app. */
function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(() => document.hasFocus())
  useEffect(() => {
    const onFocus = () => setFocused(true)
    const onBlur = () => setFocused(false)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, [])
  return focused
}

/** What fills the window when there is nothing else to show: the app is starting, or it could not. */
function Notice({ title, detail, problem = false }: { title: string; detail?: string; problem?: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center" role={problem ? 'alert' : 'status'}>
      {!problem && <Eye size={120} mood="thinking" />}
      <Eyebrow className={problem ? 'text-danger' : undefined}>{title}</Eyebrow>
      {detail !== undefined && <p className="max-w-xl text-sm text-text-soft leading-relaxed [overflow-wrap:anywhere]">{detail}</p>}
    </div>
  )
}
