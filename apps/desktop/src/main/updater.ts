import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { UpdateState } from '@repo/client'
import { app } from 'electron'
import type { AppUpdater } from 'electron-updater'

/**
 * Where the releases are, for a person: the page of the repository the feed comes from, as the packager wrote
 * it into the package (app-update.yml). Nothing for a copy run from the sources, which has no feed.
 */
export function releasesPage(): string | undefined {
  try {
    const config = readFileSync(join(process.resourcesPath, 'app-update.yml'), 'utf8')
    const owner = /^owner:\s*(\S+)\s*$/m.exec(config)?.[1]
    const repo = /^repo:\s*(\S+)\s*$/m.exec(config)?.[1]
    return owner && repo ? `https://github.com/${owner}/${repo}/releases/latest` : undefined
  } catch {
    return undefined
  }
}

/** The first look waits for the app to settle; then one every few hours, for an app left running for days. */
const FIRST_CHECK_MS = 20_000
const CHECK_EVERY_MS = 4 * 3_600_000

export interface Updater {
  state(): UpdateState
  onState(listener: (state: UpdateState) => void): () => void
  /** Look for a newer version now. When updates are automatic, one found is downloaded at once. */
  check(): Promise<void>
  /** Download the version found, when updates are not automatic. */
  download(): Promise<void>
  /** Quit and install the version downloaded, then start again. Only ever on the user's word: it ends what the app is doing. */
  install(): void
  /** Download by itself and install when the app quits, or wait for the user's word. */
  setAutomatic(on: boolean): void
}

/** Why this build cannot replace itself, in words for the user. Nothing when it can. */
function cannotUpdate(): string | undefined {
  if (process.env.ECHO_UPDATE_FEED) return undefined
  if (!app.isPackaged) return 'This copy runs from the sources. Installed copies update themselves.'
  if (process.platform === 'linux' && !process.env.APPIMAGE) return 'Only the AppImage updates itself. Install new versions the way you installed this one.'
  // The installer leaves its uninstaller beside the program. A copy unpacked from the ZIP has none, and an update would install a second copy.
  if (process.platform === 'win32' && !existsSync(join(dirname(process.execPath), `Uninstall ${app.getName()}.exe`))) {
    return 'This copy was unpacked from a ZIP. Install it with the installer to get updates.'
  }
  return undefined
}

/**
 * Whether a new version installs itself, or is only announced with the page to download it from. macOS installs an
 * update only when it meets the signature of the copy running, which a copy with none cannot give: the signature is
 * looked at there only, and not for a test feed, which is tried on every system.
 */
export async function installsItself(platform: NodeJS.Platform, testFeed: boolean, signed: () => Promise<boolean>): Promise<boolean> {
  return platform !== 'darwin' || testFeed || (await signed())
}

/**
 * Whether this copy holds a valid signature from a certificate Apple issued, as the release workflow's Developer ID
 * gives it, which a later version signed by the same developer meets. An unsigned copy, one signed ad hoc, and one
 * whose files no longer match its signature hold none. The signature itself is asked, not how the build was made, so
 * no copy is promised an update that macOS would then refuse.
 */
function signedByDeveloper(): Promise<boolean> {
  const bundle = join(process.execPath, '..', '..', '..')
  return new Promise((resolve) => execFile('/usr/bin/codesign', ['--verify', '-R=anchor apple generic', bundle], (error) => resolve(!error)))
}

/**
 * New versions, from the GitHub releases of the project: the release workflow uploads the packages and the
 * manifests that describe them (latest.yml, latest-mac.yml, latest-linux.yml), and electron-updater reads them.
 *
 * Downloading happens in the background and installing when the app quits, so an update never cuts into a
 * conversation; the user can also restart for it at once. On macOS a copy built without a signature cannot install
 * its updates: there, a new version is announced with the page to download it from.
 */
export function createUpdater(automatic: boolean): Updater {
  const events = new EventEmitter<{ state: [UpdateState] }>()
  const current = app.getVersion()
  const unavailable = cannotUpdate()
  const page = releasesPage()
  let state: UpdateState = unavailable ? { is: 'unavailable', current, reason: unavailable } : { is: 'idle', current }
  let updater: AppUpdater | undefined
  let loading: Promise<AppUpdater | undefined> | undefined
  let manual = false
  let auto = automatic

  const set = (next: UpdateState) => {
    state = next
    events.emit('state', state)
  }

  const problem = (error: Error): string => {
    const message = error.message ?? String(error)
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|net::ERR/i.test(message)) return 'The releases could not be reached. It will try again later.'
    if (/code signature|not signed/i.test(message))
      return 'This build is not signed, so it cannot install updates. Download the new version from the releases page.'
    return message.split('\n')[0]?.slice(0, 200) ?? 'The update failed.'
  }

  const load = async (): Promise<AppUpdater | undefined> => {
    if (unavailable) return undefined
    manual = !(await installsItself(process.platform, Boolean(process.env.ECHO_UPDATE_FEED), signedByDeveloper))
    // Loaded only when updates can happen: a copy run from the sources never loads it.
    const { autoUpdater } = await import('electron-updater')
    updater = autoUpdater
    autoUpdater.autoDownload = auto && !manual
    autoUpdater.autoInstallOnAppQuit = auto && !manual
    autoUpdater.disableWebInstaller = true
    autoUpdater.logger = null
    // For trying an update without publishing one: a folder of release files served over HTTP. A copy run
    // from the sources has no update configuration of its own, which the updater reads for its cache folder.
    const feed = process.env.ECHO_UPDATE_FEED
    if (feed) {
      if (!app.isPackaged) {
        const config = join(app.getPath('userData'), 'dev-app-update.yml')
        writeFileSync(config, `provider: generic\nurl: ${feed}\nupdaterCacheDirName: ${app.getName().toLowerCase()}-updater\n`)
        autoUpdater.updateConfigPath = config
        autoUpdater.forceDevUpdateConfig = true
      }
      autoUpdater.setFeedURL({ provider: 'generic', url: feed })
    }
    autoUpdater.on('checking-for-update', () => set({ is: 'checking', current }))
    autoUpdater.on('update-not-available', () => set({ is: 'latest', current, checkedAt: new Date().toISOString() }))
    autoUpdater.on('update-available', (info) =>
      set(
        autoUpdater.autoDownload
          ? { is: 'downloading', current, latest: info.version, percent: 0 }
          : { is: 'available', current, latest: info.version, ...(manual && page ? { page } : {}) }
      )
    )
    autoUpdater.on('download-progress', (progress) => {
      if (state.is === 'downloading' || state.is === 'available')
        set({ is: 'downloading', current, latest: state.latest, percent: Math.round(progress.percent) })
    })
    autoUpdater.on('update-downloaded', (info) => set({ is: 'ready', current, latest: info.version }))
    autoUpdater.on('error', (error: Error) => {
      // A repository with no release yet has nothing newer.
      if (/No published versions|latest version on GitHub|HttpError: 404/i.test(error.message))
        set({ is: 'latest', current, checkedAt: new Date().toISOString() })
      else set({ is: 'failed', current, problem: problem(error) })
    })
    return autoUpdater
  }
  // Set up once, though two checks may ask for it before it is ready.
  const ready = () => {
    loading ??= load()
    return loading
  }

  const check = async () => {
    // A download under way or done is not started again.
    if (state.is === 'checking' || state.is === 'downloading' || state.is === 'ready') return
    const loaded = await ready()
    try {
      await loaded?.checkForUpdates()
    } catch {
      // Told through the "error" event.
    }
  }

  if (!unavailable) {
    setTimeout(() => void check(), FIRST_CHECK_MS).unref()
    setInterval(() => void check(), CHECK_EVERY_MS).unref()
  }

  return {
    state: () => state,
    onState(listener) {
      events.on('state', listener)
      return () => void events.off('state', listener)
    },
    check,
    async download() {
      if (state.is !== 'available' || manual) return
      try {
        await (await ready())?.downloadUpdate()
      } catch {
        // Told through the "error" event.
      }
    },
    install() {
      if (state.is !== 'ready' || !updater) return
      // Silent on Windows (the installer shows no pages), and the app starts again afterwards.
      updater.quitAndInstall(true, true)
    },
    setAutomatic(on) {
      auto = on
      if (updater) {
        updater.autoDownload = on && !manual
        updater.autoInstallOnAppQuit = on && !manual
      }
    }
  }
}
