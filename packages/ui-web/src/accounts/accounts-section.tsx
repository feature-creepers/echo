import { type AccountsState, type Client, CommandFailed, followAccounts, followServices, type ServicesState } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import { type Account, type AccountPart, type AccountProvider, type AccountsView, type Connection, MAX_ACCOUNTS } from '@repo/protocol'
import { useEffect, useState } from 'react'
import { Button } from '../primitives/button.tsx'
import { Switch } from '../primitives/switch.tsx'
import { SettingGroup, SettingRow } from '../settings/rows.tsx'
import { partsWords } from './words.ts'

/** The accounts, followed for as long as the page is open. */
function useAccounts(client: Client): AccountsState | undefined {
  const [state, setState] = useState<AccountsState>()
  useEffect(() => {
    const followed = followAccounts(client.session)
    setState(followed)
    return () => followed.unfollow()
  }, [client])
  return state
}

/**
 * The Accounts page (docs/SPEC.md, section 13.2): the accounts whose calendar and mail the assistant reads, each to
 * sign in to again or disconnect, and the providers this build offers to connect one. It follows the core, so a
 * sign-in finished in the browser shows at once.
 */
export function AccountsSection({ client, productName }: { client: Client; productName: string }) {
  const state = useAccounts(client)
  const services = useServices(client)
  return state ? (
    <div className="grid gap-10">
      <Accounts state={state} productName={productName} />
      {services && <Services state={services} />}
    </div>
  ) : (
    <Reading />
  )
}

/** The services widget apps call, followed for as long as the page is open. */
function useServices(client: Client): ServicesState | undefined {
  const [state, setState] = useState<ServicesState>()
  useEffect(() => {
    const followed = followServices(client.session)
    setState(followed)
    return () => followed.unfollow()
  }, [client])
  return state
}

/** The services connected for widget apps (docs/SPEC.md, section 9.9): each connected on a widget, disconnected here. */
function Services({ state }: { state: ServicesState }) {
  const view = useFollowed(state)
  const [problem, setProblem] = useState<string>()
  if (!view || view.connections.length === 0) return null
  const disconnect = (connection: Connection) => {
    setProblem(undefined)
    state.disconnect(connection.id).catch((error: unknown) => setProblem(told(error, 'The service could not be disconnected.')))
  }
  return (
    <SettingGroup title="Services for widgets" note="Connected on a widget">
      {view.connections.map((connection) => (
        <ServiceRow key={connection.id} connection={connection} onDisconnect={() => disconnect(connection)} />
      ))}
      {problem && (
        <p role="alert" className="px-4 py-3 text-danger text-xs leading-relaxed">
          {problem}
        </p>
      )}
    </SettingGroup>
  )
}

function ServiceRow({ connection, onDisconnect }: { connection: Connection; onDisconnect(): void }) {
  const [asking, setAsking] = useState(false)
  const since = new Date(connection.since).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
  const host = /^https:\/\/([^/?#]+)/.exec(connection.api)?.[1] ?? connection.api
  return (
    <SettingRow
      title={connection.name}
      detail={
        <span className="grid gap-0.5">
          <span>{`${host} · ${connection.kind === 'token' ? 'a token' : 'signed in'} · connected on ${since}`}</span>
          {connection.state === 'sign-in-again' && <span className="text-warn">This computer no longer holds its sign-in: connect it again on a widget.</span>}
        </span>
      }
    >
      {asking ? (
        <span className="flex items-center gap-2">
          <span className="text-text-soft text-xs">Disconnect it?</span>
          <Button size="sm" onClick={onDisconnect}>
            Disconnect
          </Button>
          <Button size="sm" kind="quiet" onClick={() => setAsking(false)}>
            Keep it
          </Button>
        </span>
      ) : (
        <Button size="sm" kind="quiet" onClick={() => setAsking(true)}>
          Disconnect
        </Button>
      )}
    </SettingRow>
  )
}

function Reading() {
  return <p className="text-text-faint text-xs">Reading your accounts…</p>
}

/** What the core said when it refused, else a sentence of the page's own. */
const told = (error: unknown, otherwise: string) => (error instanceof CommandFailed && error.detail ? error.detail : otherwise)

function Accounts({ state, productName }: { state: AccountsState; productName: string }) {
  const view = useFollowed(state)
  const unread = useFollowed(state.unread)
  const [parts, setParts] = useState<Record<AccountPart, boolean>>({ calendar: true, mail: true })
  const [problem, setProblem] = useState<string>()
  /** The account last disconnected, while its provider keeps the access until the person removes it there. */
  const [left, setLeft] = useState<{ address: string; provider: AccountProvider }>()

  if (unread) return <p className="text-danger text-xs">The accounts could not be read. Close the settings and open them again.</p>
  if (!view) return <Reading />

  const connect = (provider: string, asked: AccountPart[], account?: string) => {
    setProblem(undefined)
    setLeft(undefined)
    state
      .connect({ provider, parts: asked, ...(account === undefined ? {} : { account }) })
      .catch((error: unknown) => setProblem(told(error, 'The account could not be connected.')))
  }
  const disconnect = (account: Account) => {
    setProblem(undefined)
    const provider = view.providers.find((one) => one.id === account.provider)
    state
      .disconnect(account.id)
      .then(() => setLeft(provider?.permissions ? { address: account.address, provider } : undefined))
      .catch((error: unknown) => setProblem(told(error, 'The account could not be disconnected.')))
  }
  const asked = (Object.keys(parts) as AccountPart[]).filter((part) => parts[part])

  return (
    <div className="grid gap-10">
      {!view.keeping.kept && (
        <p role="status" className="max-w-2xl text-warn text-xs leading-relaxed">
          {view.keeping.reason}
        </p>
      )}

      <SettingGroup title="Connected" note={view.accounts.length > 0 ? `${view.accounts.length} of ${MAX_ACCOUNTS}` : undefined}>
        {view.accounts.length === 0 ? (
          <Empty productName={productName} />
        ) : (
          view.accounts.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              view={view}
              onSignIn={() => connect(account.provider, account.parts, account.id)}
              onDisconnect={() => disconnect(account)}
            />
          ))
        )}
        {left?.provider.permissions && (
          <p className="px-4 py-3 text-text-faint text-xs leading-relaxed">
            {`${left.address} is disconnected from this computer. ${left.provider.label} keeps the access until you remove it from `}
            <a href={left.provider.permissions} target="_blank" rel="noreferrer" className="text-text-soft underline underline-offset-2 hover:text-text">
              your account’s app permissions
            </a>
            .
          </p>
        )}
      </SettingGroup>

      <SettingGroup title="Connect an account" note="Read only">
        <SettingRow title="What it may read" detail="Ask for what you want it to read: you can sign in again later to give more.">
          <span className="flex items-center gap-5">
            {(['calendar', 'mail'] as const).map((part) => (
              <span key={part} className="flex items-center gap-2 text-xs">
                <Switch
                  label={partsWords([part])}
                  on={parts[part]}
                  disabled={view.signingIn !== undefined}
                  onChange={(on) => setParts({ ...parts, [part]: on })}
                />
                {partsWords([part])}
              </span>
            ))}
          </span>
        </SettingRow>

        {view.signingIn ? (
          <SettingRow title="Finish signing in in your browser" detail="It waits five minutes. Close the tab, or cancel here, to give up.">
            <Button size="sm" onClick={() => void state.cancel().catch(() => undefined)}>
              Cancel
            </Button>
          </SettingRow>
        ) : (
          view.providers.map((provider) => (
            <SettingRow key={provider.id} title={provider.label} detail={provider.offered ? <Notes notes={provider.notes} /> : provider.problem}>
              <Button size="sm" disabled={!provider.offered || asked.length === 0} onClick={() => connect(provider.id, asked)}>
                {`Connect a ${provider.label} account…`}
              </Button>
            </SettingRow>
          ))
        )}

        {problem && (
          <p role="alert" className="px-4 py-3 text-danger text-xs leading-relaxed">
            {problem}
          </p>
        )}
      </SettingGroup>
    </div>
  )
}

function AccountRow({ account, view, onSignIn, onDisconnect }: { account: Account; view: AccountsView; onSignIn(): void; onDisconnect(): void }) {
  const [asking, setAsking] = useState(false)
  const provider = view.providers.find((one) => one.id === account.provider)
  const since = new Date(account.since).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
  const again = account.state === 'sign-in-again'
  return (
    <SettingRow
      title={account.address}
      detail={
        <span className="grid gap-0.5">
          <span>{`${provider?.label ?? account.provider} · ${partsWords(account.parts)} · connected on ${since}`}</span>
          {again && <span className="text-warn">This computer no longer holds its sign-in: sign in again to read it.</span>}
        </span>
      }
    >
      {asking ? (
        <span className="flex items-center gap-2">
          <span className="text-text-soft text-xs">Disconnect it?</span>
          <Button size="sm" onClick={onDisconnect}>
            Disconnect
          </Button>
          <Button size="sm" kind="quiet" onClick={() => setAsking(false)}>
            Keep it
          </Button>
        </span>
      ) : (
        <span className="flex items-center gap-2">
          {again && (
            <Button size="sm" disabled={view.signingIn !== undefined || provider?.offered !== true} onClick={onSignIn}>
              Sign in again
            </Button>
          )}
          <Button size="sm" kind="quiet" onClick={() => setAsking(true)}>
            Disconnect
          </Button>
        </span>
      )}
    </SettingRow>
  )
}

function Notes({ notes }: { notes: readonly string[] }) {
  return (
    <span className="grid gap-1">
      {notes.map((note) => (
        <span key={note}>{note}</span>
      ))}
    </span>
  )
}

function Empty({ productName }: { productName: string }) {
  return (
    <p className="px-4 py-6 text-center text-text-faint text-xs leading-relaxed">
      {`No account is connected. Connect one, and ${productName} can tell you what is on your calendar, find and read your mail, and tell you when a mail arrives.`}
    </p>
  )
}
