import { followSettings, openSession, type CoreLink, type Session, type SettingsState } from '@repo/client'
import { Shell, applyTheme } from '@repo/ui-web'
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

/** The exchange with the core, for as long as the app is connected to it. */
function useClient(connected: boolean): { session: Session; settings: SettingsState } | undefined {
  const [client, setClient] = useState<{ session: Session; settings: SettingsState }>()
  useEffect(() => {
    if (!connected) return
    const session = openSession(window.desktop.core)
    const settings = followSettings(session)
    setClient({ session, settings })
    return () => {
      settings.stop()
      session.close()
      setClient(undefined)
    }
  }, [connected])
  return client
}

function App() {
  const link = useCoreLink()
  const client = useClient(link.state === 'connected')
  return <Shell productName={manifest.productName} link={link} client={client} />
}

const root = document.getElementById('root')
if (!root) throw new Error('The page has no #root element.')
applyTheme(document.documentElement)
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
