import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { appIcon, appIconPixels, icns, ico } from '../src/main/mark.ts'

/**
 * Lays out what the packager turns into an app, in `stage/`: the built program, a manifest with no
 * development dependencies and with the repository whose releases it updates from, the one native library the speech engines load at run time, for the system
 * the package is for, and the library that drives the browser, which the core loads at run time. That system need not be this one: a Windows package can be made on Linux.
 *
 *   node build/stage.ts --os win32 --arch x64
 */
const { values } = parseArgs({ options: { os: { type: 'string', default: process.platform }, arch: { type: 'string', default: process.arch } } })
const os = values.os as string
const arch = values.arch as string

const here = (path: string) => join(import.meta.dirname, '..', path)
const stage = here('stage')
rmSync(stage, { recursive: true, force: true })
mkdirSync(join(stage, 'node_modules'), { recursive: true })

// The program, as electron-vite built it.
cpSync(here('out'), join(stage, 'out'), { recursive: true })

// The app's icons, drawn at each size each system asks for, where the packager looks for them (stage/build):
// round for Windows and Linux, a tile with its margin for macOS.
const resources = join(stage, 'build')
mkdirSync(join(resources, 'icons'), { recursive: true })
writeFileSync(join(resources, 'icon.ico'), ico([16, 20, 24, 32, 40, 48, 64, 96, 128, 256].map((size) => ({ size, pixels: appIconPixels(size, 'round') }))))
writeFileSync(
  join(resources, 'icon.icns'),
  icns((size) => appIcon(size, 'tile'))
)
for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) writeFileSync(join(resources, 'icons', `${size}x${size}.png`), appIcon(size, 'round'))

/**
 * The GitHub repository whose releases are the update feed: the one a GitHub Actions run belongs to, else the
 * one this clone was taken from. The packager writes it into the package (app-update.yml), for the app to
 * know where to look. Taken from where the code lives rather than written down, so a fork updates from itself.
 */
function repository(): string | undefined {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY
  try {
    const origin = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim()
    return /github\.com[:/]([^/]+\/[^/]+?)(\.git)?$/.exec(origin)?.[1]
  } catch {
    return undefined
  }
}

// The manifest: what the packager reads for the name, the version and the feed, and nothing it would try to install.
const manifest = JSON.parse(readFileSync(here('package.json'), 'utf8'))
const feed = repository()
if (!feed) process.stderr.write('No GitHub repository was found: the package will not look for updates.\n')
const modules = createRequire(here('package.json'))
const libraryFolder = dirname(modules.resolve('sherpa-onnx-node/package.json'))
const library = JSON.parse(readFileSync(join(libraryFolder, 'package.json'), 'utf8'))
// Playwright drives the browser from the core's process. It is plain JavaScript with no dependency of its own, the same on every system,
// and it reads its own files when it starts, so it is shipped as published rather than bundled into the core.
const driverFolder = dirname(modules.resolve('playwright-core/package.json'))
const driver = JSON.parse(readFileSync(join(driverFolder, 'package.json'), 'utf8'))
writeFileSync(
  join(stage, 'package.json'),
  `${JSON.stringify(
    {
      name: 'echo',
      productName: manifest.productName,
      version: manifest.version,
      description: manifest.description,
      author: manifest.author,
      license: manifest.license,
      type: manifest.type,
      main: manifest.main,
      ...(feed ? { repository: { type: 'git', url: `https://github.com/${feed}` } } : {}),
      dependencies: { 'playwright-core': driver.version, 'sherpa-onnx-node': library.version }
    },
    null,
    2
  )}\n`
)

// The browser's driver, as published.
cpSync(driverFolder, join(stage, 'node_modules', 'playwright-core'), { recursive: true, dereference: true })

// The speech library, and its native part for the target system, fetched from the registry as published.
cpSync(libraryFolder, join(stage, 'node_modules', 'sherpa-onnx-node'), { recursive: true, dereference: true })
const native = `sherpa-onnx-${os === 'win32' ? 'win' : os}-${arch}`
// Downloaded beside the stage, so tar is given a short relative path within one folder tree (see below).
const download = mkdtempSync(join(dirname(stage), '.stage-download-'))
try {
  execFileSync('npm', ['pack', `${native}@${library.version}`, '--pack-destination', download, '--silent'], {
    stdio: 'inherit',
    shell: process.platform === 'win32'
  })
  const tarball = readdirSync(download).find((file) => file.endsWith('.tgz'))
  if (!tarball) throw new Error(`npm did not download ${native}.`)
  const target = join(stage, 'node_modules', native)
  mkdirSync(target, { recursive: true })
  // Unpacked where it goes, the archive named from there with forward slashes: GNU tar, the one Git Bash puts
  // first on Windows, reads `C:\…` as a remote machine called C and backslashes as escapes. Every tar reads a
  // relative path with forward slashes as it is.
  const archive = relative(target, join(download, tarball)).split(sep).join('/')
  execFileSync('tar', ['-xzf', archive, '--strip-components=1'], { stdio: 'inherit', cwd: target })
} finally {
  rmSync(download, { recursive: true, force: true })
}

process.stdout.write(`Staged ${manifest.productName} ${manifest.version} for ${os}-${arch} in ${stage}\n`)
