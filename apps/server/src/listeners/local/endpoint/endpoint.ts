/** A place on this machine where the core can listen and only local programs can connect. */
export interface Endpoint {
  /** What a client connects to: a Unix socket path, or a named pipe on Windows. */
  address: string
  /** Remove what was created on disk for it. Called when the core stops. */
  remove(): void
}
