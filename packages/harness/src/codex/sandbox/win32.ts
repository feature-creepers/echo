/**
 * Windows: Codex's read-only sandbox exists only once a kind of sandbox is chosen. This one needs no
 * administrator rights and no set-up by the user.
 */
export const SANDBOX_SETTINGS: string[] = ['-c', 'windows.sandbox="unelevated"']
