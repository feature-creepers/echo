import { type VaultAnswer, type VaultRequest, vaultRequestSchema } from '@repo/protocol'
import { app, safeStorage, type UtilityProcess } from 'electron'
import { keyringProblem } from './keyring/index.ts'

/**
 * The core's vault, on this device (docs/SPEC.md, section 12.4, item 4): the core keeps its secrets sealed, and asks
 * the app to seal and open them over its parent port, since only Electron's main process reaches the system's own
 * store: DPAPI on Windows, the Keychain on macOS, the Secret Service or KWallet on Linux. The asynchronous calls only:
 * the synchronous ones are deprecated in Electron 45 and removed in 46.
 */
export function serveVault(core: UtilityProcess): void {
  core.on('message', (message: unknown) => {
    const request = vaultRequestSchema.safeParse(message)
    if (request.success) void answer(request.data).then((reply) => core.postMessage(reply))
  })
}

/** Why sealing would protect nothing here, in words for the person; nothing when the system's store keeps it. */
async function unsafe(): Promise<string | undefined> {
  if (!(await safeStorage.isAsyncEncryptionAvailable()))
    return 'This computer’s system store cannot seal sign-ins, so they last until the app quits, and each account then asks you to sign in again.'
  return keyringProblem()
}

async function answer(request: VaultRequest): Promise<VaultAnswer> {
  const reply = { type: 'vault' as const, id: request.id }
  try {
    // Electron's store works once the app is ready.
    await app.whenReady()
    const problem = await unsafe()
    if (problem) return { ...reply, ok: false, reason: problem }
    switch (request.op) {
      case 'keeping':
        return { ...reply, ok: true }
      case 'seal':
        return { ...reply, ok: true, text: (await safeStorage.encryptStringAsync(request.text ?? '')).toString('base64') }
      case 'open': {
        const opened = await safeStorage.decryptStringAsync(Buffer.from(request.text ?? '', 'base64'))
        return { ...reply, ok: true, text: opened.result, ...(opened.shouldReEncrypt ? { stale: true as const } : {}) }
      }
    }
  } catch (error) {
    return { ...reply, ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}
