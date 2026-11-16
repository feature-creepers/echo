import type { CoreLink } from '@repo/client'

/**
 * What the window may ask of the app, and nothing more. The preload script puts it on `window.desktop`;
 * the window has no other way to reach the system.
 */
export interface DesktopBridge {
  /** Where the app stands with its core, now. */
  coreLink(): Promise<CoreLink>
  /** Be told each time that changes. Returns a function that stops the telling. */
  onCoreLink(listener: (link: CoreLink) => void): () => void
}

/** The channel that carries the state of the link, as a request and as a notification. */
export const CORE_LINK_CHANNEL = 'core-link'

declare global {
  interface Window {
    desktop: DesktopBridge
  }
}
