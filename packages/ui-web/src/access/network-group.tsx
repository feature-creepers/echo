import { type Access, type CommandInput, hostSchema, MAX_HOSTS } from '@repo/protocol'
import { type KeyboardEvent, useState } from 'react'
import { cn } from '../primitives/cn.ts'
import { IconButton } from '../primitives/icon-button.tsx'
import { CloseGlyph } from '../primitives/icons.tsx'
import { Switch } from '../primitives/switch.tsx'
import { SettingGroup, SettingRow } from '../settings/rows.tsx'

interface NetworkGroupProps {
  access: Access
  busy: boolean
  change(asked: CommandInput<'access.set'>): Promise<void>
}

/**
 * Where commands may go on the network (docs/SPEC.md, section 12.2): the local network and the internet, each
 * asked at every level when the person wants, the destinations that go by the level all the same, and those never
 * reached. Commands are read for the addresses they name; what a program works out once it runs is not seen.
 */
export function NetworkGroup({ access, busy, change }: NetworkGroupProps) {
  return (
    <SettingGroup title="The network" note="For commands; the browser has its own rules">
      <SettingRow
        title="Always ask before reaching the local network"
        detail={
          access.askLocalNetwork ? (
            'A command that reaches a device at home or at work (a private address, a name such as nas or printer.local) is asked every time. You may allow it for the session.'
          ) : (
            <span className="text-warn">A command that reaches a device of your local network follows the choice above, like any other command.</span>
          )
        }
      >
        <Switch
          label="Always ask before reaching the local network"
          on={access.askLocalNetwork}
          disabled={busy}
          onChange={(on) => void change({ askLocalNetwork: on })}
        />
      </SettingRow>
      <SettingRow
        title="Always ask before reaching the internet"
        detail={
          access.askNetwork
            ? 'A download, an API call, a package installed or a git fetch is asked every time, unless it goes only where you allow below. One that does not say where it goes is asked too.'
            : 'A command that reaches the internet follows the choice above, like any other command.'
        }
      >
        <Switch label="Always ask before reaching the internet" on={access.askNetwork} disabled={busy} onChange={(on) => void change({ askNetwork: on })} />
      </SettingRow>
      <SettingRow
        title="Allowed without asking"
        detail="These follow the choice above even when the network is asked. A name covers the names under it."
        stacked
      >
        <HostList label="Allowed without asking" hosts={access.allowedHosts} busy={busy} onChange={(allowedHosts) => change({ allowedHosts })} />
      </SettingRow>
      <SettingRow title="Never reached" detail="A command that names one of these is refused before anything is asked, whatever you chose." stacked>
        <HostList label="Never reached" hosts={access.refusedHosts} busy={busy} onChange={(refusedHosts) => change({ refusedHosts })} />
      </SettingRow>
    </SettingGroup>
  )
}

/** Destinations as chips, each removable, and a field to add one: Enter adds it. */
function HostList({ label, hosts, busy, onChange }: { label: string; hosts: readonly string[]; busy: boolean; onChange(hosts: string[]): Promise<void> }) {
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string>()

  const add = () => {
    const read = hostSchema.safeParse(draft)
    if (!read.success) return setProblem('A name such as github.com, or an address such as 192.168.1.20.')
    if (hosts.length >= MAX_HOSTS) return setProblem(`${MAX_HOSTS} at most.`)
    setProblem(undefined)
    setDraft('')
    if (!hosts.includes(read.data)) void onChange([...hosts, read.data])
  }
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      add()
    } else if (event.key === 'Escape' && draft !== '') {
      // Escape empties the field, and goes no further: in settings it would also go back to the conversation.
      event.stopPropagation()
      setDraft('')
      setProblem(undefined)
    }
  }

  return (
    <div className="grid gap-2">
      {hosts.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={label}>
          {hosts.map((host) => (
            <li key={host} className="inline-flex h-7 items-center gap-0.5 rounded-sm bg-white/[0.07] pl-2.5 font-mono text-text text-xs">
              {host}
              <IconButton label={`Remove ${host}`} disabled={busy} className="size-6" onClick={() => void onChange(hosts.filter((one) => one !== host))}>
                <CloseGlyph />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <input
        type="text"
        aria-label={`Add to “${label}”`}
        placeholder="Add a name or an address, then press Enter"
        value={draft}
        disabled={busy}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={problem !== undefined}
        onChange={(event) => {
          setDraft(event.target.value)
          setProblem(undefined)
        }}
        onKeyDown={onKey}
        className={cn(
          'h-7 w-full max-w-sm rounded-md border border-line-strong bg-black/25 px-2.5 font-mono text-text text-xs shadow-[inset_0_1px_1px_rgb(0_0_0/0.25)] transition duration-(--duration-quick) ease-soft placeholder:font-sans placeholder:text-text-faint aria-invalid:border-danger'
        )}
      />
      {problem && (
        <p role="alert" className="text-danger text-xs">
          {problem}
        </p>
      )}
    </div>
  )
}
