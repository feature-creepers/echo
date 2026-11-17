import { type Client, type CoreLink, openClient } from '@repo/client'
import { Shell, type SpeechEngine, silentVoice, TALK_EVENT } from '@repo/ui-web'
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
  speak: (text, how) => window.desktop.speech.speak(text, how)
}

function App() {
  const link = useCoreLink()
  const client = useClient(link.state === 'connected')
  return <Shell productName={manifest.productName} link={link} client={client} speech={speech} />
}

// The global shortcut, pressed in another app, reaches the interface as an event on the window.
window.desktop.onTalk(() => window.dispatchEvent(new Event(TALK_EVENT)))

const root = document.getElementById('root')
if (!root) throw new Error('The page has no #root element.')
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
