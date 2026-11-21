import { createHash } from 'node:crypto'
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

/** What the update manifest says of a file: its SHA-512 in base64, and its size in bytes. */
interface FileFacts {
  sha512: string
  size: number
}

function factsOf(file: string): FileFacts {
  const bytes = readFileSync(file)
  return { sha512: createHash('sha512').update(bytes).digest('base64'), size: bytes.length }
}

/**
 * The update manifest with the installer's facts from before signing changed to those from after. The installer is
 * found by both, so a manifest that describes another file is refused rather than changed.
 */
export function describeSigned(manifest: string, unsigned: FileFacts, signed: FileFacts): string {
  const size = new RegExp(`(\\bsize: )${unsigned.size}$`, 'm')
  if (!manifest.includes(unsigned.sha512) || !size.test(manifest)) throw new Error('The update manifest does not describe the installer that was signed.')
  return manifest.replaceAll(unsigned.sha512, signed.sha512).replace(size, `$1${signed.size}`)
}

/**
 * Puts the Windows installer SignPath signed in place of the one electron-builder made, and describes it in the
 * update manifest (latest.yml): the signature changes the installer's bytes, and the updater refuses a download
 * whose hash is not the manifest's. The block map, which lets an update download only what changed, described the
 * unsigned bytes: it is removed, and updates download the whole installer.
 *
 *   node build/signed-installer.ts release/signed-installer/Echo-0.2.0-setup.exe release
 */
if (import.meta.main) {
  const [signed, release] = process.argv.slice(2)
  if (!signed || !release) throw new Error('Give the signed installer and the folder electron-builder wrote the release to.')
  const installer = join(release, basename(signed))
  const manifest = join(release, 'latest.yml')
  writeFileSync(manifest, describeSigned(readFileSync(manifest, 'utf8'), factsOf(installer), factsOf(signed)))
  copyFileSync(signed, installer)
  rmSync(`${installer}.blockmap`, { force: true })
}
