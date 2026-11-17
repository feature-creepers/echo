import type { CoreLink, SessionLink } from '@repo/client'

/**
 * What the window may ask of the app, and nothing more. The preload script puts it on `window.desktop`;
 * the window has no other way to reach the system.
 */
export interface DesktopBridge {
  /** Where the app stands with its core, now. */
  coreLink(): Promise<CoreLink>
  /** Be told each time that changes. Returns a function that stops the telling. */
  onCoreLink(listener: (link: CoreLink) => void): () => void
  /**
   * The messages exchanged with the core once connected: what the window opens its session on.
   * The app passes them on unread, both ways. Sent while there is no link, a message is dropped.
   */
  core: SessionLink
}

/** The channel that carries the state of the link, as a request and as a notification. */
export const CORE_LINK_CHANNEL = 'core-link'

/** The channel that carries the messages between the window and the core, both ways. */
export const CORE_MESSAGE_CHANNEL = 'core-message'

declare global {
  interface Window {
    desktop: DesktopBridge
  }
}
