import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { appIcon, appIconPixels, icns, ico } from '../src/main/mark.ts'

/**
 * Lays out what the packager turns into an app, in `stage/`: the built program, a manifest with no
 * development dependencies and with the repository whose releases it updates from, and the one native library the speech engines load at run time, for the system
 * the package is for. That system need not be this one: a Windows package can be made on Linux.
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
const speech = createRequire(here('package.json'))
const libraryFolder = dirname(speech.resolve('sherpa-onnx-node/package.json'))
const library = JSON.parse(readFileSync(join(libraryFolder, 'package.json'), 'utf8'))
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
      dependencies: { 'sherpa-onnx-node': library.version }
    },
    null,
    2
  )}\n`
)

// The speech library, and its native part for the target system, fetched from the registry as published.
cpSync(libraryFolder, join(stage, 'node_modules', 'sherpa-onnx-node'), { recursive: true, dereference: true })
const native = `sherpa-onnx-${os === 'win32' ? 'win' : os}-${arch}`
const download = mkdtempSync(join(tmpdir(), 'stage-'))
try {
  execFileSync('npm', ['pack', `${native}@${library.version}`, '--pack-destination', download, '--silent'], {
    stdio: 'inherit',
    shell: process.platform === 'win32'
  })
  const tarball = readdirSync(download).find((file) => file.endsWith('.tgz'))
  if (!tarball) throw new Error(`npm did not download ${native}.`)
  const target = join(stage, 'node_modules', native)
  mkdirSync(target, { recursive: true })
  execFileSync('tar', ['-xzf', join(download, tarball), '-C', target, '--strip-components=1'], { stdio: 'inherit' })
} finally {
  rmSync(download, { recursive: true, force: true })
}

process.stdout.write(`Staged ${manifest.productName} ${manifest.version} for ${os}-${arch} in ${stage}\n`)
