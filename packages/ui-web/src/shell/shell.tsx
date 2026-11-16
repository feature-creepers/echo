import type { CoreLink } from '@repo/client'

export interface ShellProps {
  /** The name of the assistant, as the app shows it. */
  name: string
  link: CoreLink
}

/**
 * The frame of the interface. For now it only says where the app stands with its core: the look,
 * the stage and the rest of section 13 of the spec are not built yet.
 */
export function Shell({ name, link }: ShellProps) {
  return (
    <main>
      <h1>{name}</h1>
      <p role="status">{describe(link)}</p>
    </main>
  )
}

function describe(link: CoreLink): string {
  switch (link.state) {
    case 'starting':
      return 'Starting…'
    case 'connected':
      return `Connected to the core, version ${link.core.version}.`
    case 'failed':
      return `Not connected: ${link.reason}`
  }
}
