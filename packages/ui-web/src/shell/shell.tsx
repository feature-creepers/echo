import type { CoreLink, Session, SettingsState } from '@repo/client'
import { useSettings } from '@repo/client/react'
import type { Accent, CommandInput, PersonaId } from '@repo/protocol'
import { type ReactNode, useCallback, useState } from 'react'
import { Onboarding } from '../onboarding/onboarding.tsx'
import { Button } from '../primitives/button.tsx'
import { SettingsScreen } from '../settings/settings-screen.tsx'
import { accentStyle } from '../styles/theme.ts'
import { Notice } from './notice.tsx'
import { Presence } from './presence.tsx'
import styles from './shell.module.css'

export interface ShellProps {
  /** The name of the product, as the app that hosts the interface is called. */
  productName: string
  /** Where the app stands with its core. */
  link: CoreLink
  /** The exchange with the core and the settings it keeps, once connected. */
  client: { session: Session; settings: SettingsState } | undefined
}

/**
 * The interface, whole: it decides what fills the window from where the app stands with its core and
 * from the user's settings. The stage, the transcript and the rest of section 13 of the spec are not built yet.
 */
export function Shell({ productName, link, client }: ShellProps) {
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
        <Notice title="Starting…" />
      </Frame>
    )
  }
  return <Connected productName={productName} session={client.session} settings={client.settings} />
}

function Connected({ productName, session, settings }: { productName: string; session: Session; settings: SettingsState }) {
  const snapshot = useSettings(settings)
  const [screen, setScreen] = useState<'presence' | 'settings'>('presence')
  /** The persona the user is about to pick in a form, shown in its accent before anything is sent. */
  const [picked, setPicked] = useState<PersonaId>()

  const setPersonas = useCallback(
    async (choice: CommandInput<'personas.set'>) => {
      await session.run('personas.set', choice)
      setPicked(undefined)
    },
    [session]
  )
  const closeSettings = useCallback(() => {
    setPicked(undefined)
    setScreen('presence')
  }, [])

  if (snapshot.state === 'loading') {
    return (
      <Frame productName={productName}>
        <Notice title="Starting…" />
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

  if (!personas.confirmed) {
    return (
      <Frame productName={productName} accent={accent}>
        <Onboarding productName={productName} personas={personas} onSubmit={setPersonas} onPick={setPicked} />
      </Frame>
    )
  }
  if (screen === 'settings') {
    return (
      <Frame productName={productName} accent={accent}>
        <SettingsScreen personas={personas} onSubmit={setPersonas} onPick={setPicked} onClose={closeSettings} />
      </Frame>
    )
  }
  return (
    <Frame productName={productName} accent={accent} action={<Button onClick={() => setScreen('settings')}>Settings</Button>}>
      <Presence personas={personas} onSwitch={(persona) => setPersonas({ names: [], active: persona })} />
    </Frame>
  )
}

interface FrameProps {
  productName: string
  /** The accent everything inside shows. Left out, the neutral one. */
  accent?: Accent | undefined
  /** What the header offers on the right. */
  action?: ReactNode
  children: ReactNode
}

function Frame({ productName, accent, action, children }: FrameProps) {
  return (
    <div className={styles.frame} style={accentStyle(accent)}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.wordmark}>{productName}</span>
          <span className={styles.actions}>{action}</span>
        </div>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  )
}
