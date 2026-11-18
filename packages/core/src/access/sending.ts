/**
 * What a command line sends from this computer to another machine, as far as it says (docs/SPEC.md, section 12.2):
 * the files whose contents an upload carries (`curl -T`, `curl -F file=@…`, `wget --post-file`, `-InFile`), the
 * files a copy puts on a server (`scp`, `rsync`, `aws s3 cp`, `gsutil cp`, `rclone copy`, `az storage blob upload`),
 * and what a program is given on its standard input when that comes from a file or another command (`< notes.txt
 * nc host 9000`, `cat key | ssh host`). Text written on the line itself is not counted: the person sees it on the card.
 */

export interface Sent {
  /** The local files and folders whose contents leave the computer, as written. `-` is what the program is given on its input. */
  files: string[]
  /** Where they go, when the copy names it: `nas`, `example.com`, `s3.amazonaws.com`. */
  to: string[]
}

/** A remote place as `scp` and `rsync` name one: `host:path`, `user@host:path`, never a drive such as `C:\…`. */
const REMOTE = /^(?:[^@/\\\s:]+@)?(\[[^\]]+\]|[a-z0-9][a-z0-9.-]*):/i
const DRIVE = /^[A-Za-z]:([\\/]|$)/
const remoteHost = (word: string): string | undefined => {
  if (DRIVE.test(word)) return undefined
  const address = /^(?:scp|sftp|rsync):\/\/(?:[^@/]*@)?(\[[^\]]+\]|[^:/]+)/i.exec(word)
  if (address) return address[1]
  return REMOTE.exec(word)?.[1]
}

/** The options of `scp` and `rsync` that take a value, so the value is not taken for a file. */
const COPYING_VALUED = new Set([
  '-c',
  '-F',
  '-i',
  '-J',
  '-l',
  '-o',
  '-P',
  '-S',
  '-X',
  '-e',
  '-B',
  '-f',
  '-M',
  '-T',
  '--rsh',
  '--exclude',
  '--include',
  '--exclude-from',
  '--include-from',
  '--files-from',
  '--filter',
  '--password-file',
  '--port',
  '--chmod',
  '--log-file',
  '--temp-dir',
  '--partial-dir',
  '--backup-dir',
  '--compare-dest',
  '--link-dest',
  '--copy-dest',
  '--block-size',
  '--bwlimit',
  '--timeout',
  '--max-size',
  '--min-size',
  '--remote-option',
  '--suffix'
])

/** The words that are no option nor an option's value. */
function positionals(args: readonly string[], valued: (word: string) => boolean): string[] {
  const found: string[] = []
  for (let index = 0; index < args.length; index++) {
    const word = args[index] ?? ''
    if (word === '--') {
      found.push(...args.slice(index + 1))
      break
    }
    if (word.startsWith('-') && word !== '-') {
      if (!word.includes('=') && valued(word)) index++
      continue
    }
    found.push(word)
  }
  return found
}

/** A copy whose last place is remote sends every place before it that is local. */
function copied(places: readonly string[], remote: (word: string) => string | undefined): Sent | undefined {
  const target = places.at(-1)
  const host = target === undefined ? undefined : remote(target)
  if (places.length < 2 || host === undefined) return undefined
  const files = places.slice(0, -1).filter((place) => remote(place) === undefined)
  return files.length > 0 ? { files, to: host === '' ? [] : [host] } : undefined
}

/** The value of an option, written apart (`-T file`), joined (`-Tfile`) or after `=` (`--upload-file=file`). */
function* values(args: readonly string[], short: readonly string[], long: readonly string[], caseless = false): Generator<string> {
  for (let index = 0; index < args.length; index++) {
    const written = args[index] ?? ''
    const word = caseless ? written.toLowerCase() : written
    const next = args[index + 1]
    if ((short.includes(word) || long.includes(word)) && next !== undefined) {
      yield next
      index++
      continue
    }
    const joinedLong = long.find((option) => word.startsWith(`${option}=`))
    if (joinedLong) {
      yield written.slice(joinedLong.length + 1)
      continue
    }
    const joinedShort = short.find((option) => option.length === 2 && word.startsWith(option) && word.length > 2 && !word.startsWith('--'))
    if (joinedShort) yield written.slice(2)
  }
}

/** A file curl or wget reads a body from: `@file`, with `@-` for its input. */
const atFile = (value: string) => (value.startsWith('@') && value.length > 1 ? value.slice(1) : undefined)

function curl(args: readonly string[]): string[] {
  const files: string[] = []
  for (const value of values(args, ['-d'], ['--data', '--data-binary', '--data-urlencode', '--json'])) {
    // `--data-urlencode name@file` reads the file too.
    const file = atFile(value) ?? /^[^=@]+@(.+)$/.exec(value)?.[1]
    if (file) files.push(file)
  }
  for (const value of values(args, ['-F'], ['--form'])) {
    const file = /^[^=]*=[@<]([^;]+)/.exec(value)?.[1]
    if (file) files.push(file)
  }
  for (const value of values(args, ['-T'], ['--upload-file'])) files.push(value === '.' ? '-' : value)
  return files
}

/** HTTPie's items after the address: `field@file` uploads a file, `field=@file` and `field:=@file` embed one. */
function httpie(args: readonly string[], fed: boolean): string[] {
  const words = positionals(args, () => false)
  // A method may come first: `http POST example.com …`.
  const items = words.slice(/^[A-Z]+$/.test(words[0] ?? '') ? 2 : 1)
  const files = items.flatMap((item) => {
    const file = /^[^=:@/]+(?::?=)?@(.+)$/.exec(item)?.[1]
    return file ? [file] : []
  })
  return fed ? [...files, '-'] : files
}

/** `aws s3 cp|mv|sync`: options are `--name value`, but for those that are switches. */
const AWS_SWITCHES = new Set([
  '--recursive',
  '--dryrun',
  '--quiet',
  '--delete',
  '--no-progress',
  '--only-show-errors',
  '--follow-symlinks',
  '--no-follow-symlinks',
  '--exact-timestamps',
  '--size-only',
  '--no-guess-mime-type',
  '--no-sign-request',
  '--no-verify-ssl',
  '--debug',
  '--no-paginate'
])

/**
 * What one command sends, or nothing when it sends no file. `fed` says that its standard input comes from a file or
 * another command; a program that sends its input then sends that.
 */
export function sentBy(program: string, args: readonly string[], fed: boolean): Sent | undefined {
  const name = program.toLowerCase()
  const lower = args.map((word) => word.toLowerCase())
  const result = (files: string[], to: string[] = []): Sent | undefined => {
    const kept = [...new Set(files.map((file) => (file === '-' && !fed ? '' : file)).filter((file) => file !== ''))]
    return kept.length > 0 ? { files: kept, to } : undefined
  }
  switch (name) {
    case 'curl':
      return result(curl(args))
    case 'wget':
      return result([...values(args, [], ['--post-file', '--body-file'])])
    case 'invoke-webrequest':
    case 'invoke-restmethod':
      return result([...values(args, [], ['-infile'], true)])
    case 'http':
    case 'https':
    case 'xh':
      return result(httpie(args, fed))
    case 'scp':
    case 'rsync':
      return copied(
        positionals(args, (word) => COPYING_VALUED.has(word)),
        remoteHost
      )
    case 'ssh':
    case 'nc':
    case 'ncat':
    case 'netcat':
    case 'socat':
    case 'telnet':
      return result(fed ? ['-'] : [])
    case 'aws': {
      if (lower[0] !== 's3' || !['cp', 'mv', 'sync'].includes(lower[1] ?? '')) return undefined
      const places = positionals(args.slice(2), (word) => word.startsWith('--') && !AWS_SWITCHES.has(word))
      return copied(places, (word) => (/^s3:\/\//i.test(word) ? 's3.amazonaws.com' : undefined))
    }
    case 'gsutil': {
      const at = lower.findIndex((word) => ['cp', 'mv', 'rsync'].includes(word))
      if (at < 0) return undefined
      const places = positionals(args.slice(at + 1), (word) => ['-z', '-j', '-L', '-h', '-p', '-x'].includes(word))
      return copied(places, (word) => (/^gs:\/\//i.test(word) ? 'storage.googleapis.com' : undefined))
    }
    case 'rclone': {
      if (!['copy', 'copyto', 'move', 'moveto', 'sync'].includes(lower[0] ?? '')) return undefined
      const places = positionals(args.slice(1), (word) => word.startsWith('--') && !word.includes('='))
      // A remote is a name the person configured (`drive:backups`): where it goes, the line does not say.
      return copied(places, (word) => (!DRIVE.test(word) && /^[\w.-]+:/.test(word) ? '' : undefined))
    }
    case 'az':
      if (lower[0] !== 'storage' || lower[1] !== 'blob' || !['upload', 'upload-batch'].includes(lower[2] ?? '')) return undefined
      return result([...values(args, ['-f', '-s'], ['--file', '--source'])], ['blob.core.windows.net'])
    default:
      return undefined
  }
}
