/**
 * A two-way link that carries protocol messages to a core, whatever is underneath: a pipe to a core
 * on this machine, a WebSocket to a remote one.
 *
 * A transport delivers whole messages, already decoded. It checks nothing about their content.
 */
export interface Transport {
  /**
   * The core is on another machine. What it asks of this device is then checked here again before it runs, so the
   * device never depends on a remote core being right (docs/SPEC.md, section 12.2).
   */
  readonly remote: boolean
  send(message: unknown): void
  /** Sets the one listener called for each message received. */
  onMessage(listener: (message: unknown) => void): void
  /** Sets the one listener called once when the link is gone, with the cause when it failed. */
  onClose(listener: (cause?: Error) => void): void
  close(): void
}
