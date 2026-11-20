import { safeStorage } from 'electron'

/**
 * Linux needs a running keyring: GNOME Keyring or another Secret Service, or KWallet. Without one, Chromium seals with
 * a password written in Chromium itself (`basic_text`), which protects nothing, or cannot tell what it uses (`unknown`).
 */
export function keyringProblem(): string | undefined {
  const backend = safeStorage.getSelectedStorageBackend()
  if (backend !== 'basic_text' && backend !== 'unknown') return undefined
  return 'No keyring is running on this computer, so sign-ins last until the app quits. Install GNOME Keyring (or another Secret Service) or KWallet, start it, then restart the app.'
}
