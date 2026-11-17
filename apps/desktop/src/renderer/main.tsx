import { type Client, type CoreLink, openClient } from '@repo/client'
import { type DeviceHost, OPEN_SETTINGS_EVENT, Shell, type SpeechEngine, silentVoice, TALK_EVENT } from '@repo/ui-web'
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import manifest from '../../package.json'
import '../preload/bridge.ts'

/** Where the app stands with its core, as the main process reports it. */
function useCoreLink(): CoreLink {
  const [link, setLink] = useState<CoreLink>({ state: 'starting' })
  useEffect(() => {
    const stop = window.desktop.onCoreLink(setLink)
    void window.desktop.coreLink().then(setLink)
    return stop
  }, [])
  return link
}

/** What the window holds for as long as the app is connected to its core. */
function useClient(connected: boolean): Client | undefined {
  const [client, setClient] = useState<Client>()
  useEffect(() => {
    if (!connected) return
    const opened = openClient(window.desktop.core, silentVoice())
    setClient(opened)
    return () => {
      opened.close()
      setClient(undefined)
    }
  }, [connected])
  return client
}

/** The device's speech engines, as the window reaches them through the app. */
const speech: SpeechEngine = {
  async status() {
    const status = await window.desktop.speech.status()
    return { ready: status.ready, models: status.sets.map((set) => ({ id: set.id, name: set.name, bytes: set.bytes, installed: set.installed })) }
  },
  install: (onProgress) => window.desktop.speech.install((progress) => onProgress({ received: progress.received, total: progress.total })),
  transcribe: (sound) => window.desktop.speech.transcribe(sound),
  speak: (text, how) => window.desktop.speech.speak(text, how),
  styles: () => window.desktop.speech.styles()
}

/** This device's settings, the app's version and its updates, as the window reaches them through the app. */
const device: DeviceHost = {
  settings: window.desktop.device,
  about: () => window.desktop.app.about(),
  openDataFolder: () => window.desktop.app.openDataFolder(),
  openReleases: () => window.desktop.app.openReleases(),
  updates: window.desktop.updates
}

function App() {
  const link = useCoreLink()
  const client = useClient(link.state === 'connected')
  return <Shell productName={manifest.productName} link={link} client={client} speech={speech} device={device} />
}

// The global shortcut, pressed in another app, reaches the interface as an event on the window; so does the tray's "Settings".
window.desktop.onTalk(() => window.dispatchEvent(new Event(TALK_EVENT)))
window.desktop.onOpenSettings(() => window.dispatchEvent(new Event(OPEN_SETTINGS_EVENT)))

// Where the system draws a translucent material behind the window, the page lets it through its side panes.
const material = new URLSearchParams(location.search).get('material')
if (material) document.documentElement.dataset.material = material

const root = document.getElementById('root')
if (!root) throw new Error('The page has no #root element.')
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
