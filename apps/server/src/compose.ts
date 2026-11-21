import { randomUUID } from 'node:crypto'
import { basename, extname, join } from 'node:path'
import { createAccounts, createServices } from '@repo/accounts'
import { createBrowser } from '@repo/browser'
import { type Core, createCore } from '@repo/core'
import { createEmbedder } from '@repo/embedder'
import { createComputer, createHarnesses, createWorkspace } from '@repo/harness'
import { createClipboard, createDesktop, createDrives, createPrinters } from '@repo/screen'
import { openStore } from '@repo/store'
import { serveTools } from '@repo/tools'
import manifest from '../package.json' with { type: 'json' }
import { localToken } from './auth/local-token.ts'
import type { Config } from './config.ts'
import { registrations } from './registrations.ts'
import { sealerOfStarter } from './vault/starter.ts'
import { openVault } from './vault/vault.ts'
import { createPublicWeb } from './web/public-web.ts'

export interface Composition {
  core: Core
  /** Let go of what the core holds on this machine. Called once, when the process stops. */
  close(): Promise<void>
}

/**
 * Wire the core to what it needs on this machine.
 *
 * This is the only file that knows both the core and the adapters it runs on.
 */
export async function compose(config: Config): Promise<Composition> {
  const store = openStore({ folder: config.data })
  const log = { error: (message: string) => void process.stderr.write(`${message}\n`) }
  // The assistant's own folder, where it keeps the files it makes for the user: in the data folder, created now.
  // The rest of the data folder is never reached by a session; what the person moves to the trash goes in it.
  const computer = await createComputer({ workspace: join(config.data, 'workspace'), data: config.data })
  // The browser the assistant drives, with a profile of its own beside the user's data; what it downloads goes to the assistant's folder.
  const browser = createBrowser({ profile: join(config.data, 'browser'), downloads: join(computer.workspace, 'downloads'), log })
  // The other apps of this computer, read through its accessibility tree. The app's own windows are never among them:
  // the core runs in the app's program, so its name is the one left out, with the product's.
  const own = [basename(process.execPath, extname(process.execPath)).toLowerCase(), 'echo']
  const desktop = createDesktop({ folder: join(config.data, 'screen'), own })
  const timers = {
    after(ms: number, work: () => void) {
      // A timer of the core never keeps the process alive on its own.
      const timer = setTimeout(work, ms).unref()
      return () => clearTimeout(timer)
    }
  }
  // The person's accounts: their sign-ins sealed in the vault, never in the store, and opened in the system's browser.
  const vault = openVault({ file: join(config.data, 'vault.json'), sealer: sealerOfStarter() })
  const accounts = createAccounts({ vault, open: (url) => desktop.open(url), registrations, log })
  // The services the person connects for widget apps, their sign-ins in the same vault.
  const services = createServices({ vault, open: (url) => desktop.open(url), timers })
  // The same folder, as the person browses it and hands files into it.
  const workspace = await createWorkspace(computer.workspace)
  // The model of search by meaning, kept with the core's data rather than the device's: downloaded only when the person asks.
  const embedder = createEmbedder({ folder: join(config.data, 'models'), log })
  const core = createCore({
    version: manifest.version,
    acceptsCredential: localToken(config.token),
    records: store.records,
    blobs: store.blobs,
    versions: store.versions,
    search: store.search,
    vectors: store.vectors,
    embedder,
    log,
    harnesses: createHarnesses({ folder: join(config.data, 'harness'), log }),
    newId: randomUUID,
    web: createPublicWeb(),
    computer,
    browser,
    desktop,
    clipboard: createClipboard(),
    // What a printer that makes files (Microsoft Print to PDF) makes lands in the assistant's folder, never in a dialog.
    printers: createPrinters({ files: join(computer.workspace, 'printed') }),
    drives: createDrives(),
    workspace,
    accounts,
    services,
    timers
  })
  // Sessions can show things once the tool server listens: it carries their calls to the core.
  const tools = await serveTools(core.toolHost, { version: manifest.version, log })
  core.serveToolsAt(tools.url)

  return {
    core,
    async close() {
      core.close()
      await embedder.close()
      await browser.close()
      await desktop.close()
      await tools.close()
      store.close()
    }
  }
}
