/** Where the core reports what went wrong, for the person running it. */
export interface Log {
  error(message: string): void
}
