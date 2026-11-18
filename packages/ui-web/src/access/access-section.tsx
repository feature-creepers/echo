import type { Client } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import type { CommandInput, Place, Settings } from '@repo/protocol'
import { useState } from 'react'
import { useDevice } from '../device/device.tsx'
import { Button } from '../primitives/button.tsx'
import { Choice } from '../primitives/choice.tsx'
import { cn } from '../primitives/cn.ts'
import { IconButton } from '../primitives/icon-button.tsx'
import { CloseGlyph } from '../primitives/icons.tsx'
import { Switch } from '../primitives/switch.tsx'
import { SettingGroup, SettingRow } from '../settings/rows.tsx'
import { useStandingRules } from './use-standing-rules.ts'
import { LEVELS, lastPart } from './words.ts'

/** A path shown in full when it fits, and by its end when it does not: the end says which folder it is. */
function PathText({ path, className }: { path: string; className?: string }) {
  return (
    <span dir="rtl" title={path} className={cn('block truncate text-left font-mono text-text-soft text-xs', className)}>
      <bdi>{path}</bdi>
    </span>
  )
}

const FolderMark = ({ kind }: { kind: Place['kind'] }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true">
    {kind === 'folder' ? (
      <path d="M2 4.5V12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.5 3.5H3a1 1 0 0 0-1 1Z" />
    ) : (
      <path d="M4 2.5h5L12.5 6v7.5a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5v-11A.5.5 0 0 1 4 2.5ZM9 2.5V6h3.5" />
    )}
  </svg>
)

/** A command, as a prompt and a line. */
const CommandMark = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.3"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
    <path d="m4.5 6.5 2 1.5-2 1.5M8 10h3.5" />
  </svg>
)

/** How many places never reached are listed before "Show all". */
const PROTECTED_SHOWN = 6

/**
 * What the assistant may reach on this computer (docs/SPEC.md, section 12.2): its own folder, the folders and
 * files the user picks, or everything; what it asks first; what was allowed for this session; and the places it
 * never reaches. The core keeps these and enforces them on every use, whatever the model asks.
 */
export function AccessSection({ client, settings, productName }: { client: Client; settings: Settings; productName: string }) {
  const { access } = settings
  const { host } = useDevice()
  const engines = useFollowed(client.engines)
  const [problem, setProblem] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const rules = useStandingRules(client)

  const stopEverything = async () => {
    setStopping(true)
    try {
      await client.session.run('everything.stop', {})
    } catch {
      setProblem('It could not be stopped. Quit the app to stop it for sure.')
    } finally {
      setStopping(false)
    }
  }

  const change = async (asked: CommandInput<'access.set'>) => {
    setProblem(undefined)
    setBusy(true)
    try {
      await client.session.run('access.set', asked)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The change could not be saved.')
    } finally {
      setBusy(false)
    }
  }
  const setPlaces = (places: Place[]) => void change({ places })
  const add = async (kind: Place['kind']) => {
    const picked = await host?.files?.pick(kind).catch(() => [])
    if (!picked || picked.length === 0) return
    const known = new Set(access.places.map((place) => place.path))
    setPlaces([...access.places, ...picked.filter((path) => !known.has(path)).map((path) => ({ path, kind, write: false }))])
  }
  const codex = engines?.active === 'codex'

  return (
    <div className="grid gap-10">
      <SettingGroup title="Its own folder">
        <SettingRow
          title={`${productName}'s folder`}
          detail={
            <span className="grid gap-1.5">
              <span>Where it keeps the files it makes for you. It reads and writes there.</span>
              {access.folder && <PathText path={access.folder} />}
            </span>
          }
        >
          <div className="flex items-center gap-3">
            {access.folder && host?.files && (
              <Button kind="quiet" size="sm" onClick={() => void host.files?.reveal(access.folder as string)}>
                Show
              </Button>
            )}
            <Switch label={`${productName}'s folder`} on={access.workspace} disabled={busy} onChange={(on) => void change({ workspace: on })} />
          </div>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Folders and files" note="Or say which one: “you can look at my Documents folder”">
        {access.places.length === 0 && (
          <SettingRow title="Nothing else yet" detail={`Add the folders and files ${productName} may work with. Each is read only until you allow changes.`} />
        )}
        {access.places.map((place) => (
          <div key={place.path} className="flex items-center gap-4 px-5 py-3.5">
            <span className="shrink-0 text-text-faint">
              <FolderMark kind={place.kind} />
            </span>
            <div className="grid min-w-0 flex-1 gap-0.5">
              <span className="truncate font-medium text-sm">{lastPart(place.path)}</span>
              <PathText path={place.path} className="text-text-faint" />
            </div>
            <Choice
              label={`What ${productName} may do with ${lastPart(place.path)}`}
              value={place.write ? 'write' : 'read'}
              options={[
                { value: 'read', label: 'Read only' },
                { value: 'write', label: 'Read & change' }
              ]}
              onChange={(value) => setPlaces(access.places.map((other) => (other.path === place.path ? { ...other, write: value === 'write' } : other)))}
            />
            <IconButton label={`Remove ${lastPart(place.path)}`} onClick={() => setPlaces(access.places.filter((other) => other.path !== place.path))}>
              <CloseGlyph />
            </IconButton>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 bg-raised/30 px-5 py-3">
          {host?.files ? (
            <>
              <Button size="sm" disabled={busy} onClick={() => void add('folder')}>
                Add folders…
              </Button>
              <Button kind="quiet" size="sm" disabled={busy} onClick={() => void add('file')}>
                Add files…
              </Button>
            </>
          ) : (
            <span className="text-text-faint text-xs">Folders are picked from the desktop app.</span>
          )}
        </div>
      </SettingGroup>

      <SettingGroup title="The whole computer">
        <SettingRow
          title="Beyond these"
          detail={
            access.computer === 'off' ? (
              'Nothing else. This is the safe choice: it sees only what you gave it.'
            ) : (
              <span className="text-warn">
                {access.computer === 'read'
                  ? `${productName} can read every file you can, private ones included, and what it reads goes to the AI program's vendor.`
                  : `${productName} can read and change every file you can, and run any command. Give this only if you understand what that allows.`}
              </span>
            )
          }
          stacked
        >
          <Choice
            label="Beyond the folders and files given"
            value={access.computer}
            options={[
              { value: 'off', label: 'Nothing' },
              { value: 'read', label: 'Read everything' },
              { value: 'write', label: 'Read & change everything' }
            ]}
            onChange={(value) => void change({ computer: value })}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Before acting">
        <SettingRow
          title="What it asks you first"
          detail={
            <span className="grid gap-1">
              <span className={cn(access.approvals === 'auto' && 'text-warn')}>{LEVELS[access.approvals].detail}</span>
              <span>
                Whatever you choose, a command that deletes, formats, shuts down or changes permissions is asked every time. Answer with a click, or say “yes”,
                “yes, for the session” or “no”.
              </span>
            </span>
          }
          stacked
        >
          <Choice
            label="What it asks you first"
            value={access.approvals}
            options={(['ask', 'trust', 'auto'] as const).map((value) => ({ value, label: LEVELS[value].label }))}
            onChange={(value) => void change({ approvals: value })}
          />
        </SettingRow>
        <SettingRow
          title="Stop everything"
          detail={`Interrupts everything ${productName} is doing, withdraws its questions and forgets what you allowed for this session. Also in the tray's menu, or say “stop everything”.`}
        >
          <Button size="sm" disabled={stopping} onClick={() => void stopEverything()}>
            {stopping ? 'Stopping…' : 'Stop everything'}
          </Button>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Allowed for this session" note="Until you quit, or change these settings">
        {rules.allowances.length === 0 ? (
          <SettingRow
            title="Nothing yet"
            detail="When a card asks, “Allow for this session” lets the same command, or any change in the same folder, go ahead without asking again."
          />
        ) : (
          rules.allowances.map((allowance) => (
            <div key={allowance.id} className="flex items-center gap-4 px-4 py-3">
              <span className="shrink-0 text-text-faint">{allowance.kind === 'command' ? <CommandMark /> : <FolderMark kind="folder" />}</span>
              <div className="grid min-w-0 flex-1 gap-0.5">
                {allowance.kind === 'command' ? (
                  <span className="truncate font-mono text-[0.8125rem]">{allowance.subject}</span>
                ) : (
                  <span className="truncate text-[0.8125rem]">Changes in {lastPart(allowance.subject)}</span>
                )}
                <span className="text-text-faint text-xs">
                  {allowance.kind === 'command' ? 'Any use of this command, its paths still checked' : <PathText path={allowance.subject} />}
                </span>
              </div>
              <Button kind="quiet" size="sm" onClick={() => void rules.forget(allowance.id).catch(() => setProblem('It could not be forgotten.'))}>
                Forget
              </Button>
            </div>
          ))
        )}
      </SettingGroup>

      <SettingGroup title="Never reached" note="Refused to every tool and command, whatever you give">
        {rules.loading ? (
          <SettingRow title="Reading the list…" />
        ) : rules.protected.length === 0 ? (
          <SettingRow title="Nothing on this computer" detail={`${productName} runs where it reaches no file.`} />
        ) : (
          <>
            {(showAll ? rules.protected : rules.protected.slice(0, PROTECTED_SHOWN)).map((place) => (
              <div key={`${place.label}:${place.path}`} className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)] items-baseline gap-4 px-4 py-2.5">
                <span className="truncate text-[0.8125rem]">{place.label}</span>
                <PathText path={place.path} className="text-text-faint" />
              </div>
            ))}
            {rules.protected.length > PROTECTED_SHOWN && (
              <div className="bg-raised/30 px-4 py-2">
                <Button kind="quiet" size="sm" onClick={() => setShowAll(!showAll)}>
                  {showAll ? 'Show fewer' : `Show all ${rules.protected.length}`}
                </Button>
              </div>
            )}
          </>
        )}
      </SettingGroup>

      {(problem || codex) && (
        <p role={problem ? 'alert' : undefined} className={cn('text-xs leading-relaxed', problem ? 'text-danger' : 'text-text-soft')}>
          {problem ??
            'Codex cannot keep its reading to chosen folders: with Codex, files are within reach only when it may read the whole computer. Its changes stay within the folders you allow.'}
        </p>
      )}
    </div>
  )
}
