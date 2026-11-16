import type { CoreLink } from '@repo/client'
import { Shell } from '@repo/ui-web'
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../preload/bridge.ts'

function App() {
  const [link, setLink] = useState<CoreLink>({ state: 'starting' })

  useEffect(() => {
    const stop = window.desktop.onCoreLink(setLink)
    void window.desktop.coreLink().then(setLink)
    return stop
  }, [])

  return <Shell name="JARVIS" link={link} />
}

const root = document.getElementById('root')
if (!root) throw new Error('The page has no #root element.')
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
