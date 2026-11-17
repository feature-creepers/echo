import { type Client, type CoreLink, openClient } from '@repo/client'
import { Shell, silentVoice } from '@repo/ui-web'
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

function App() {
  const link = useCoreLink()
  const client = useClient(link.state === 'connected')
  return <Shell productName={manifest.productName} link={link} client={client} />
}

const root = document.getElementById('root')
if (!root) throw new Error('The page has no #root element.')
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
