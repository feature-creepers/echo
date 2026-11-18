/** Where an app that updates itself stands with its next version. */
export type UpdateState =
  /** This build cannot update itself, and why, in words for the user: run from the sources, or a system that needs a signed app. */
  | { is: 'unavailable'; current: string; reason: string }
  | { is: 'idle'; current: string }
  | { is: 'checking'; current: string }
  /** This is the newest version. */
  | { is: 'latest'; current: string; checkedAt: string }
  /**
   * A newer version exists and waits for the user to download it. `page` is where to get it by hand, when
   * this build cannot install it itself.
   */
  | { is: 'available'; current: string; latest: string; page?: string }
  | { is: 'downloading'; current: string; latest: string; percent: number }
  /** Downloaded: it installs when the app quits, or now with a restart. */
  | { is: 'ready'; current: string; latest: string }
  /** The last check or download failed, and why, in words for the user. */
  | { is: 'failed'; current: string; problem: string }
