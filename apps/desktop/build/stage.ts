import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { appIcon, appIconPixels, icns, ico } from '../src/main/mark.ts'

/**
 * Lays out what the packager turns into an app, in `stage/`: the built program, its icons, a manifest with no
 * development dependencies and with the repository whose releases it updates from, and the libraries loaded at run
 * time: the speech engines' native library, the one that drives the browser, and those of search by meaning, each with
 * the native part of the system the package is for. That system need not be this one: a Windows package can be made
 * on Linux.
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

/** The folder of a package as installed, found from the folder of another, and its manifest. */
function installed(name: string, from: string): { folder: string; manifest: { version: string; optionalDependencies?: Record<string, string> } } {
  const entry = createRequire(join(from, 'package.json')).resolve(name)
  for (let folder = dirname(entry); dirname(folder) !== folder; folder = dirname(folder)) {
    const file = join(folder, 'package.json')
    if (!existsSync(file)) continue
    const manifest = JSON.parse(readFileSync(file, 'utf8'))
    if (manifest.name === name) return { folder, manifest }
  }
  throw new Error(`${name} was not found from ${from}.`)
}

// Search by meaning: transformers.js runs the memory's model in a worker of the core, on ONNX Runtime, and loads sharp
// when it starts, though text needs no picture. sqlite-vec keeps the vectors in the store.
const transformers = installed('@huggingface/transformers', here('.'))
const runtime = installed('onnxruntime-node', transformers.folder)
const pictures = installed('sharp', transformers.folder)
const vectors = installed('sqlite-vec', here('.'))
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
      dependencies: {
        '@huggingface/transformers': transformers.manifest.version,
        'playwright-core': driver.version,
        'sherpa-onnx-node': library.version,
        'sqlite-vec': vectors.manifest.version
      }
    },
    null,
    2
  )}\n`
)

// The browser's driver, as published.
cpSync(driverFolder, join(stage, 'node_modules', 'playwright-core'), { recursive: true, dereference: true })

/** Copy a package as installed into the stage, leaving out what `keep` refuses. */
function stageInstalled(name: string, folder: string, keep?: (path: string) => boolean): void {
  cpSync(folder, join(stage, 'node_modules', ...name.split('/')), { recursive: true, dereference: true, ...(keep ? { filter: keep } : {}) })
}

/** Make a staged package declare these dependencies, and no others. */
function declareOnly(name: string, dependencies: Record<string, string>): void {
  const file = join(stage, 'node_modules', ...name.split('/'), 'package.json')
  writeFileSync(file, `${JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), dependencies }, null, 2)}\n`)
}

/** Fetch a package for the target system from the registry, as published, and unpack it where it goes. */
function stageFetched(name: string, version: string): void {
  // Downloaded beside the stage, so tar is given a short relative path within one folder tree (see below).
  const download = mkdtempSync(join(dirname(stage), '.stage-download-'))
  try {
    execFileSync('npm', ['pack', `${name}@${version}`, '--pack-destination', download, '--silent'], {
      stdio: 'inherit',
      shell: process.platform === 'win32'
    })
    const tarball = readdirSync(download).find((file) => file.endsWith('.tgz'))
    if (!tarball) throw new Error(`npm did not download ${name}.`)
    const target = join(stage, 'node_modules', ...name.split('/'))
    mkdirSync(target, { recursive: true })
    // Unpacked where it goes, the archive named from there with forward slashes: GNU tar, the one Git Bash puts
    // first on Windows, reads `C:\…` as a remote machine called C and backslashes as escapes. Every tar reads a
    // relative path with forward slashes as it is.
    const archive = relative(target, join(download, tarball)).split(sep).join('/')
    execFileSync('tar', ['-xzf', archive, '--strip-components=1'], { stdio: 'inherit', cwd: target })
  } finally {
    rmSync(download, { recursive: true, force: true })
  }
}

// The speech library, and its native part for the target system.
stageInstalled('sherpa-onnx-node', libraryFolder)
stageFetched(`sherpa-onnx-${os === 'win32' ? 'win' : os}-${arch}`, library.version)

// transformers.js, and ONNX Runtime, whose package carries every system's native part, 300 MB in all: only the target's
// is staged. ONNX Runtime's install script is not needed, and is not run (pnpm-workspace.yaml).
const common = installed('onnxruntime-common', runtime.folder)
stageInstalled('@huggingface/transformers', transformers.folder)
const natives = join(runtime.folder, 'bin', 'napi-v6')
stageInstalled('onnxruntime-node', runtime.folder, (path) => !path.startsWith(natives) || isTarget(relative(natives, path)))
stageInstalled('onnxruntime-common', common.folder)
// The packager takes in every dependency a package declares, and refuses one that is missing. The Node build of
// transformers.js carries its tokenizer, its templates and ONNX Runtime for the web within it, and ONNX Runtime's
// adm-zip and global-agent serve its install script: each declares only what it loads.
declareOnly('@huggingface/transformers', { 'onnxruntime-node': runtime.manifest.version, sharp: pictures.manifest.version })
declareOnly('onnxruntime-node', { 'onnxruntime-common': common.manifest.version })

// sharp, what it needs, and its native part for the target system, with the library of pictures it binds on macOS and Linux.
stageInstalled('sharp', pictures.folder)
for (const name of ['@img/colour', 'detect-libc', 'semver']) stageInstalled(name, installed(name, pictures.folder).folder)
const pictureNatives = pictures.manifest.optionalDependencies ?? {}
const pictureNative = pictureNatives[`@img/sharp-${os}-${arch}`]
if (!pictureNative) throw new Error(`sharp has no build for ${os}-${arch}.`)
stageFetched(`@img/sharp-${os}-${arch}`, pictureNative)
const pictureLibrary = pictureNatives[`@img/sharp-libvips-${os}-${arch}`]
if (pictureLibrary) stageFetched(`@img/sharp-libvips-${os}-${arch}`, pictureLibrary)

// sqlite-vec, and its native part for the target system, named after Windows rather than win32. Where it has none,
// search by meaning is unavailable and says so.
stageInstalled('sqlite-vec', vectors.folder)
const vectorNative = `sqlite-vec-${os === 'win32' ? 'windows' : os}-${arch}`
const vectorVersion = vectors.manifest.optionalDependencies?.[vectorNative]
if (vectorVersion) stageFetched(vectorNative, vectorVersion)
else process.stderr.write(`sqlite-vec has no build for ${os}-${arch}: search by meaning will be unavailable there.\n`)

/** Whether a path inside ONNX Runtime's native folder is kept: the folder itself, the target system's, and its own within. */
function isTarget(inside: string): boolean {
  const [system, machine] = inside === '' ? [] : inside.split(sep)
  return system === undefined || (system === os && (machine === undefined || machine === arch))
}

process.stdout.write(`Staged ${manifest.productName} ${manifest.version} for ${os}-${arch} in ${stage}\n`)
