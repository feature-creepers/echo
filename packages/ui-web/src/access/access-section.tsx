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
import { lastPart } from './words.ts'

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

/**
 * What the assistant may reach on this computer (docs/SPEC.md, section 12.2): its own folder, the folders and
 * files the user picks, or everything, and whether it asks before each change. The core keeps these and
 * enforces them on every use, whatever the model asks.
 */
export function AccessSection({ client, settings, productName }: { client: Client; settings: Settings; productName: string }) {
  const { access } = settings
  const { host } = useDevice()
  const engines = useFollowed(client.engines)
  const [problem, setProblem] = useState<string>()
  const [busy, setBusy] = useState(false)

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
          title="Changes and commands"
          detail={
            access.approvals === 'ask'
              ? 'A card asks you before each change to a file and each command. Answer with a click, or say yes or no.'
              : `Changes within what you gave are made without asking. Commands are still asked, as they can reach anything${access.computer === 'write' ? ', except now: it has the whole computer' : ''}.`
          }
          stacked
        >
          <Choice
            label="Changes and commands"
            value={access.approvals}
            options={[
              { value: 'ask', label: 'Ask me first' },
              { value: 'trust', label: 'Allow within what I gave' }
            ]}
            onChange={(value) => void change({ approvals: value })}
          />
        </SettingRow>
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
