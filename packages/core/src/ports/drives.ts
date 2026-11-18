/**
 * The removable drives of the computer the core runs on (docs/SPEC.md, section 12.4, more of the device): USB keys,
 * memory cards and external disks plugged in now. A drive's files are a place like any other, reached as the person
 * grants; the adapter only lists the drives and lets one go.
 *
 * A method rejects with an `Error` whose message is written for a model to act on.
 */
export interface Drives {
  /** The removable drives plugged in and opened by the system now, each once. Empty when there are none. */
  list(): Promise<Drive[]>
  /**
   * Let a drive go, so it can be unplugged safely: the system writes what it holds back and closes it. Rejects when
   * the system keeps it, a file on it being open.
   */
  eject(path: string): Promise<void>
}

export interface Drive {
  /** Where its files are, as the system names it: "E:\", "/Volumes/KEY", "/media/ada/KEY". */
  path: string
  /** Its label, or what the system calls it when it has none. */
  name: string
  /** How large it is, in bytes, when the system says. */
  size?: number
  /** How much of it is free, in bytes, when the system says. */
  free?: number
  /** Whether it can only be read: a locked card, a disc. */
  readOnly: boolean
}
