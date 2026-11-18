import { isPlain, type Piece, type Shell, type Stage, scan, textOf, type Word } from './command-words.ts'

export type { Shell }

/**
 * What a command line does, read before it runs (docs/SPEC.md, section 12.2): its simple commands and their
 * programs, whether it only reads, whether it destroys, whether it reaches the network, whether some of it
 * cannot be read in advance, and the paths it names.
 *
 * It reads the line as the shell would, and decides from what is written: a program can still compute other
 * paths, or do more than its name says. What it cannot tell, it never calls read-only. The adapter, where the
 * folders are, resolves the paths and checks them against what the person granted; the core decides from the
 * rest whether the person is asked.
 */

/** One simple command of a line, nested ones included. */
export interface ReadCommand {
  /** The program, as the analysis knows it: `git`, `rm`, `Remove-Item` for any of its aliases, a script's path as written. */
  program: string
  /** The program and its subcommand: what a session approval covers. `git commit`, `npm run`, `python`. */
  key: string
  /** Its words after the program, quotes taken off. */
  args: string[]
  readOnly: boolean
  destructive: boolean
  network: boolean
  /** What it runs cannot be read in advance: a script, code given inline, `eval`. */
  opaque: boolean
  /** It goes through the folders it names and everything in them. */
  recursive: boolean
}

/** A path a line names, as written, for the adapter to resolve: `~/Documents`, `${HOME}/x`, `C:\Users`, `../a`. */
export interface NamedPath {
  path: string
  /** The command reaches what is inside it too: it goes through it, or a wildcard picks from it. */
  below: boolean
}

export interface CommandReading {
  commands: ReadCommand[]
  /** The programs it runs, once each, in order. */
  programs: string[]
  /** Every stage only reads, nothing is written to a file, and all of it could be read in advance. */
  readOnly: boolean
  destructive: boolean
  network: boolean
  opaque: boolean
  /** A path it uses could not be told from the line: a variable only the shell knows, the output of another command. */
  unresolved: boolean
  /** The paths it names, in order, each once. Variables the adapter knows are written `${NAME}`. */
  paths: NamedPath[]
  /** The keys of its commands that are not read-only: what a session approval of this line would cover. */
  keys: string[]
}

/**
 * Variables that name a folder, which the adapter resolves on the machine. Windows' are found whatever their
 * capitals; the POSIX shell's must be written as they are here.
 */
const KNOWN_VARIABLES = new Set([
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'TEMP',
  'TMP',
  'TMPDIR',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMDATA',
  'ALLUSERSPROFILE',
  'SYSTEMROOT',
  'WINDIR',
  'SYSTEMDRIVE',
  'HOMEDRIVE',
  'HOMEPATH',
  'PUBLIC',
  'ONEDRIVE',
  'PWD',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'XDG_STATE_HOME'
])

/** Paths that are no file: where output is thrown away, the terminal, standard streams. */
const NOWHERE = /^(\/dev\/(null|stdin|stdout|stderr|tty|zero|random|urandom|fd\/\d+)|nul|con|\$null|-)$/i

/** What the line runs in: the shell, the folder `cd` moved to, and the variables it set itself. */
interface Context {
  shell: Shell
  /** Where `cd` moved to within the line, as written. Relative paths after it are read from there. */
  folder: string | undefined
  /** Variables the line sets itself (`x=…`, `for f in …`, `$_`): their values were read where they were set. */
  bound: Set<string>
  reading: CommandReading
  /** How deep in nested shells: a line that nests without end is not read further. */
  depth: number
}

/** Read a command line, as the given shell reads it. Claude Code's commands are read by the POSIX shell. */
export function readCommand(line: string, shell: Shell = 'posix'): CommandReading {
  const reading: CommandReading = {
    commands: [],
    programs: [],
    readOnly: true,
    destructive: false,
    network: false,
    opaque: false,
    unresolved: false,
    paths: [],
    keys: []
  }
  readLine(line, { shell, folder: undefined, bound: new Set(), reading, depth: 0 })
  reading.programs = [...new Set(reading.commands.map((command) => command.program))]
  reading.keys = [...new Set(reading.commands.filter((command) => !command.readOnly).map((command) => command.key))]
  reading.readOnly = reading.readOnly && !reading.opaque && !reading.unresolved && reading.commands.every((command) => command.readOnly)
  reading.destructive = reading.commands.some((command) => command.destructive)
  reading.network = reading.commands.some((command) => command.network)
  reading.opaque = reading.opaque || reading.commands.some((command) => command.opaque)
  if (reading.network || reading.destructive || reading.opaque) reading.readOnly = false
  return reading
}

const MAX_DEPTH = 8

function readLine(line: string, context: Context): void {
  if (context.depth > MAX_DEPTH) {
    context.reading.opaque = true
    return
  }
  const scanned = scan(line, context.shell)
  if (scanned.unreadable) context.reading.opaque = true
  for (const inner of scanned.inner) readLine(inner, { ...context, depth: context.depth + 1 })
  for (const stage of scanned.stages) readStage(stage, context)
}

// ---------------------------------------------------------------- paths

/** Whether a text, once its variables are known, is a path on a disk rather than a word, an address or a switch. */
function looksLikePath(path: string, shell: Shell, windowsProgram: boolean): boolean {
  if (path === '' || NOWHERE.test(path)) return false
  // Addresses, remote places (`host:path`, `user@host:`), registry and other providers (`HKLM:\`, `env:`).
  if (/^[A-Za-z][\w+.-]*:\/\//.test(path) || /^[\w.-]+@[\w.-]+:/.test(path) || /^[A-Za-z][\w.-]+:/.test(path)) return false
  // Switches: `/s`, `/f`, `//c`, and for Windows' own programs any `/word`.
  if (/^\/[A-Za-z?]{1,2}$/.test(path) || /^\/\/[A-Za-z?]/.test(path)) return false
  if ((shell === 'cmd' || windowsProgram) && /^\/[A-Za-z][\w:-]*$/.test(path)) return false
  if (/^(\/|\\|~|\$\{|[A-Za-z]:|\.\.?([\\/]|$))/.test(path)) return true
  return !/\s/.test(path) && /[\\/]/.test(path)
}

const isAbsolute = (path: string) => /^(\/|\\|~|\$\{|[A-Za-z]:)/.test(path)

/** A relative path read from a folder: `sub` and `a.txt` are `sub/a.txt`, `/` and `tmp` are `/tmp`. */
const joined = (folder: string, path: string) => `${folder.replace(/[\\/]+$/, '')}/${path}`

/**
 * The path a word names, as far as the line tells it: cut where a wildcard, a variable only the shell knows or
 * a command's output starts. `unknown` when even its start cannot be told.
 */
function pathOf(word: Word, context: Context): { path: string; below: boolean } | 'unknown' | undefined {
  let path = ''
  let cut = false
  let unknown = false
  for (const [index, piece] of word.pieces.entries()) {
    if (piece.kind === 'text') {
      if (piece.quoted) {
        path += piece.text
        continue
      }
      // A wildcard or a brace expansion: what is before it is the folder it picks from.
      const wild = piece.text.search(context.shell === 'cmd' ? /[*?]/ : /[*?[{]/)
      if (wild < 0) {
        path += piece.text
        continue
      }
      path += piece.text.slice(0, wild)
      cut = true
      break
    }
    if (piece.kind === 'variable') {
      // PowerShell's constants: `> $null` throws the output away.
      if (context.shell === 'powershell' && /^(null|true|false)$/i.test(piece.name)) return undefined
      const name = context.shell === 'posix' ? piece.name : piece.name.toUpperCase()
      if (index === 0 && KNOWN_VARIABLES.has(name) && (context.shell !== 'posix' || name === piece.name)) {
        path += `\${${name}}`
        continue
      }
      cut = true
      unknown = !(context.bound.has(piece.name) || piece.name === '_' || piece.name.toLowerCase() === 'psitem')
      break
    }
    cut = true
    unknown = true
    break
  }
  // A script block given to a command is code, read on its own, and no path.
  if (word.pieces.length === 1 && word.pieces[0]?.kind === 'inner' && word.pieces[0].block) return undefined
  if (cut) {
    // What is left is the folder: `~/Doc*` picks from `~`.
    const folder = path.replace(/[^\\/]*$/, '').replace(/(.)[\\/]+$/, '$1')
    if (folder === '') return unknown && path === '' ? 'unknown' : undefined
    path = folder
  }
  if (cut && unknown && path === '') return 'unknown'
  return path === '' ? undefined : { path, below: cut }
}

/** Note a path the line names, read from the folder `cd` moved to. Words that are not paths are left alone. */
function name(word: Word, context: Context, options: { always?: boolean; windowsProgram?: boolean; recursive?: boolean } = {}): void {
  const found = pathOf(word, context)
  if (found === 'unknown') {
    context.reading.unresolved = true
    return
  }
  if (!found) return
  const { always = false, windowsProgram = false, recursive = false } = options
  let { path } = found
  if (!always && !looksLikePath(path, context.shell, windowsProgram)) {
    // A plain name is in the folder the command runs in, which matters only once `cd` moved elsewhere.
    if (context.folder === undefined || /\s/.test(path) || /^[-/]/.test(path) || !/^[\w.@+-][\w .@+-]*$/.test(path)) return
  } else if (NOWHERE.test(path)) return
  if (context.folder !== undefined && !isAbsolute(path)) path = joined(context.folder, path)
  const named = { path, below: found.below || recursive }
  const known = context.reading.paths.find((other) => other.path === named.path)
  if (known) known.below ||= named.below
  else context.reading.paths.push(named)
}

/** A word's value after `--name=` or `name=`, as a word of its own, when it has one. */
function assignedValue(word: Word): Word | undefined {
  const first = word.pieces[0]
  if (first?.kind !== 'text' || first.quoted) return undefined
  const match = /^(--?[\w-]+=|[A-Za-z_]\w*=)/.exec(first.text)
  if (!match) return undefined
  const rest = first.text.slice(match[0].length)
  return { pieces: [...(rest === '' ? [] : [{ ...first, text: rest }]), ...word.pieces.slice(1)] }
}

// ---------------------------------------------------------------- programs

/** What is known of a program's use: whether it reads only, destroys, reaches the network, and what it nests. */
interface Kind {
  readOnly?: boolean
  destructive?: boolean
  network?: boolean
  opaque?: boolean
  recursive?: boolean
  /** The subcommand that makes its key, when it has one: `commit` for `git commit`. */
  sub?: string
  /** Which of its words are not paths: patterns, scripts, messages. By index in its words. */
  notPaths?: Set<number>
  /** Only these of its words are paths: `find`'s starting points. */
  onlyPaths?: Set<number>
  /** Lines it runs, read as commands of their own: `bash -c "…"`, `find -exec rm {} ;`, a script block. */
  nested?: { line: string; shell: Shell }[]
  /** It only starts what it nests, which decides for it. */
  launcher?: boolean
  /** It takes Windows-style `/switches`. */
  windows?: boolean
}

/** PowerShell's aliases of the commands it reads, to their names. */
const ALIASES: Record<string, string> = {
  gci: 'Get-ChildItem',
  ls: 'Get-ChildItem',
  dir: 'Get-ChildItem',
  gc: 'Get-Content',
  cat: 'Get-Content',
  type: 'Get-Content',
  sls: 'Select-String',
  gi: 'Get-Item',
  gl: 'Get-Location',
  pwd: 'Get-Location',
  gps: 'Get-Process',
  ps: 'Get-Process',
  measure: 'Measure-Object',
  rvpa: 'Resolve-Path',
  select: 'Select-Object',
  where: 'Where-Object',
  '?': 'Where-Object',
  sort: 'Sort-Object',
  ft: 'Format-Table',
  fl: 'Format-List',
  fw: 'Format-Wide',
  '%': 'ForEach-Object',
  foreach: 'ForEach-Object',
  rm: 'Remove-Item',
  del: 'Remove-Item',
  erase: 'Remove-Item',
  rd: 'Remove-Item',
  rmdir: 'Remove-Item',
  ri: 'Remove-Item',
  iwr: 'Invoke-WebRequest',
  curl: 'Invoke-WebRequest',
  wget: 'Invoke-WebRequest',
  irm: 'Invoke-RestMethod',
  kill: 'Stop-Process',
  spps: 'Stop-Process',
  ni: 'New-Item',
  mi: 'Move-Item',
  move: 'Move-Item',
  mv: 'Move-Item',
  cp: 'Copy-Item',
  copy: 'Copy-Item',
  cpi: 'Copy-Item',
  ren: 'Rename-Item',
  rni: 'Rename-Item',
  si: 'Set-Item',
  sp: 'Set-ItemProperty',
  gp: 'Get-ItemProperty',
  echo: 'Write-Output',
  write: 'Write-Output',
  cd: 'Set-Location',
  chdir: 'Set-Location',
  sl: 'Set-Location',
  iex: 'Invoke-Expression',
  saps: 'Start-Process',
  start: 'Start-Process',
  gcm: 'Get-Command',
  gm: 'Get-Member',
  group: 'Group-Object',
  compare: 'Compare-Object',
  diff: 'Compare-Object',
  sc: 'Set-Content',
  ac: 'Add-Content',
  clc: 'Clear-Content',
  cls: 'Clear-Host',
  clear: 'Clear-Host',
  h: 'Get-History',
  history: 'Get-History',
  ghy: 'Get-History',
  gsv: 'Get-Service',
  sasv: 'Start-Service',
  spsv: 'Stop-Service',
  gcim: 'Get-CimInstance',
  gwmi: 'Get-WmiObject',
  icm: 'Invoke-Command',
  tee: 'Tee-Object',
  epcsv: 'Export-Csv',
  ipcsv: 'Import-Csv',
  sleep: 'Start-Sleep',
  md: 'New-Item',
  mkdir: 'New-Item',
  gdr: 'Get-PSDrive'
}

/** PowerShell's commands that only read or show, beyond the verbs that do by convention. */
const POWERSHELL_READING = new Set([
  'where-object',
  'sort-object',
  'resolve-path',
  'join-path',
  'split-path',
  'compare-object',
  'group-object',
  'out-string',
  'out-host',
  'out-null',
  'write-output',
  'write-host',
  'write-verbose',
  'write-information',
  'start-sleep',
  'import-csv',
  'set-location',
  'push-location',
  'pop-location',
  'clear-host',
  'foreach-object'
])
/** Verbs whose commands only read, by PowerShell's own convention. */
const READING_VERBS = /^(get|test|measure|select|format|convertto|convertfrom|find)-/
const POWERSHELL_NETWORK = new Set([
  'invoke-webrequest',
  'invoke-restmethod',
  'start-bitstransfer',
  'test-connection',
  'test-netconnection',
  'resolve-dnsname',
  'send-mailmessage',
  'install-module',
  'install-package',
  'install-script',
  'update-module',
  'save-module',
  'find-module',
  'find-package',
  'find-script'
])
const POWERSHELL_DESTROYING = new Set([
  'remove-item',
  'remove-itemproperty',
  'clear-content',
  'clear-item',
  'clear-recyclebin',
  'format-volume',
  'clear-disk',
  'initialize-disk',
  'remove-partition',
  'stop-computer',
  'restart-computer',
  'uninstall-package',
  'uninstall-module',
  'uninstall-script',
  'remove-appxpackage',
  'uninstall-windowsfeature',
  'remove-windowsfeature',
  'set-acl',
  'set-executionpolicy',
  'remove-service',
  'remove-localuser',
  'remove-localgroup'
])
const POWERSHELL_OPAQUE = new Set(['invoke-expression', 'invoke-command', 'start-job', 'add-type', 'invoke-item'])

/** Programs that only read or show, whatever their options (those that change something are checked below). */
const READING = new Set([
  'ls',
  'dir',
  'vdir',
  'cat',
  'head',
  'tail',
  'wc',
  'file',
  'stat',
  'tree',
  'pwd',
  'du',
  'df',
  'which',
  'where',
  'whereis',
  'type',
  'grep',
  'egrep',
  'fgrep',
  'rg',
  'ag',
  'ack',
  'less',
  'more',
  'echo',
  'printf',
  'true',
  'false',
  ':',
  'test',
  '[',
  '[[',
  'basename',
  'dirname',
  'realpath',
  'readlink',
  'cut',
  'tr',
  'nl',
  'column',
  'fold',
  'fmt',
  'rev',
  'tac',
  'paste',
  'join',
  'comm',
  'cmp',
  'diff',
  'md5sum',
  'sha1sum',
  'sha256sum',
  'sha512sum',
  'shasum',
  'cksum',
  'b2sum',
  'od',
  'hexdump',
  'strings',
  'cal',
  'whoami',
  'id',
  'groups',
  'uname',
  'uptime',
  'free',
  'ps',
  'pgrep',
  'lsof',
  'lsblk',
  'printenv',
  'locale',
  'history',
  'jobs',
  'sleep',
  'seq',
  'expr',
  'jq',
  'fd',
  'fdfind',
  'locate',
  'cd',
  'pushd',
  'popd',
  'dirs',
  'alias',
  'hash',
  'help',
  'man',
  'info',
  'ver',
  'vol',
  'systeminfo',
  'tasklist',
  'findstr',
  'nproc',
  'arch',
  'lscpu',
  'lsusb',
  'lspci',
  'sw_vers',
  'mdfind',
  'mdls',
  'getmac',
  'hostname',
  'chcp',
  'set',
  'export',
  'unset',
  'setlocal',
  'endlocal',
  'rem',
  'title',
  'cls',
  'clear',
  'wait',
  'dpkg-query',
  'fc',
  'comp',
  'xxd',
  'sort',
  'uniq',
  'awk',
  'gawk',
  'mawk',
  'sed',
  'find',
  'date',
  'env',
  'yq'
])

/** Programs that run with a second word that says what they do: `git commit`, `npm run`. */
const WITH_SUBCOMMANDS = new Set([
  'git',
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'cargo',
  'go',
  'docker',
  'podman',
  'kubectl',
  'pip',
  'pip3',
  'uv',
  'dotnet',
  'winget',
  'choco',
  'scoop',
  'brew',
  'apt',
  'apt-get',
  'dnf',
  'yum',
  'zypper',
  'snap',
  'flatpak',
  'gh',
  'systemctl',
  'conda',
  'poetry',
  'deno',
  'gem',
  'pipx',
  'reg',
  'sc',
  'net',
  'netsh',
  'schtasks',
  'wsl',
  'diskutil',
  'defaults',
  'launchctl',
  'port'
])

/** Programs Windows ships, which take `/switches`. */
const WINDOWS_PROGRAMS = new Set([
  'taskkill',
  'icacls',
  'cacls',
  'takeown',
  'reg',
  'sc',
  'shutdown',
  'format',
  'diskpart',
  'robocopy',
  'xcopy',
  'where',
  'findstr',
  'ipconfig',
  'netsh',
  'wmic',
  'schtasks',
  'tasklist',
  'systeminfo',
  'attrib',
  'msiexec',
  'cipher',
  'bcdedit',
  'vssadmin',
  'bitsadmin',
  'certutil',
  'net',
  'setx',
  'mklink',
  'del',
  'erase',
  'rd',
  'rmdir',
  'copy',
  'move',
  'ren',
  'md',
  'type',
  'dir',
  'tree',
  'start'
])

const SHELLS: Record<string, Shell> = {
  bash: 'posix',
  sh: 'posix',
  zsh: 'posix',
  dash: 'posix',
  ksh: 'posix',
  fish: 'posix',
  powershell: 'powershell',
  pwsh: 'powershell',
  cmd: 'cmd'
}

/** Programs that run code from a file or from the text given them. */
const INTERPRETERS = new Set([
  'python',
  'python3',
  'python2',
  'py',
  'pythonw',
  'node',
  'nodejs',
  'deno',
  'bun',
  'ruby',
  'perl',
  'php',
  'rscript',
  'lua',
  'osascript',
  'cscript',
  'wscript',
  'tsx',
  'ts-node',
  'groovy',
  'julia',
  'java',
  'swift',
  'irb'
])

/** Programs that take another command after their own options, and run it. */
const WRAPPERS: Record<string, { values: readonly string[] }> = {
  sudo: { values: ['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-U'] },
  doas: { values: ['-u', '-C'] },
  env: { values: ['-u', '-C', '-S', '--unset', '--chdir'] },
  nice: { values: ['-n', '--adjustment'] },
  nohup: { values: [] },
  time: { values: ['-f', '-o'] },
  timeout: { values: ['-s', '-k', '--signal', '--kill-after'] },
  command: { values: [] },
  builtin: { values: [] },
  exec: { values: ['-a'] },
  stdbuf: { values: ['-i', '-o', '-e'] },
  ionice: { values: ['-c', '-n', '-p'] },
  xargs: { values: ['-I', '-i', '-n', '-P', '-d', '-L', '-l', '-s', '-a', '-E', '-e', '--delimiter', '--max-args', '--max-procs', '--arg-file'] },
  caffeinate: { values: ['-t', '-w'] },
  watch: { values: ['-n', '-d', '--interval'] }
}

/** Keywords of the POSIX shell that start or end a part of a line, and run nothing themselves. */
const POSIX_KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', '!', '{', '}', 'esac', 'in'])
const POWERSHELL_KEYWORDS = new Set([
  'if',
  'elseif',
  'else',
  'foreach',
  'for',
  'while',
  'do',
  'until',
  'switch',
  'try',
  'catch',
  'finally',
  'return',
  'break',
  'continue',
  'exit',
  'param',
  'begin',
  'process',
  'end'
])

/** Words of a program after its options: what is not an option, in order, with their index. */
function positionals(args: readonly string[], values: readonly string[] = []): { word: string; index: number }[] {
  const found: { word: string; index: number }[] = []
  for (let index = 0; index < args.length; index++) {
    const word = args[index] as string
    if (word === '--') {
      for (let rest = index + 1; rest < args.length; rest++) found.push({ word: args[rest] as string, index: rest })
      break
    }
    if (word.startsWith('-') && word.length > 1) {
      if (values.includes(word)) index++
      continue
    }
    found.push({ word, index })
  }
  return found
}

/** Whether a short option is among the words, alone or in a cluster: `-r`, `-rf`, `-Rv`. */
const short = (args: readonly string[], letter: string) => args.some((word) => /^-[A-Za-z]+$/.test(word) && word.slice(1).includes(letter))
const has = (args: readonly string[], ...options: string[]) => args.some((word) => options.includes(word))
const hasCaseless = (args: readonly string[], ...options: string[]) => args.some((word) => options.includes(word.toLowerCase()))
/** A PowerShell parameter, which may be shortened to any start that is still its own: `-Recurse`, `-rec`, `-r`. */
const parameter = (args: readonly string[], name: string, shortest = 1) =>
  args.some((word) => {
    const written = word.toLowerCase().replace(/:.*$/, '')
    return written.startsWith('-') && written.length > shortest && name.startsWith(written.slice(1))
  })

/** The subcommand of a program with subcommands, past its global options and their values. */
function subcommandOf(program: string, args: readonly string[]): { sub: string | undefined; at: number } {
  const values: Record<string, readonly string[]> = {
    git: ['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env'],
    npm: ['--prefix', '-w', '--workspace'],
    pnpm: ['-C', '--dir', '--filter', '-F'],
    yarn: ['--cwd'],
    docker: ['-H', '--host', '--context', '-c', '--config'],
    kubectl: ['-n', '--namespace', '--context', '--kubeconfig'],
    uv: ['--directory', '--project'],
    cargo: ['--manifest-path', '-Z']
  }
  const found = positionals(args, values[program] ?? [])[0]
  return { sub: found?.word, at: found?.index ?? -1 }
}

/** What `git` does with the words after it. */
function git(args: readonly string[]): Kind {
  const { sub, at } = subcommandOf('git', args)
  const rest = args.slice(at + 1)
  const kind: Kind = sub === undefined ? { readOnly: true } : { sub }
  // `-m "message"` and the like are words, never paths.
  const notPaths = new Set<number>()
  for (const [index, word] of args.entries()) if (['-m', '--message', '--author', '--format', '--pretty', '-c'].includes(word)) notPaths.add(index + 1)
  kind.notPaths = notPaths
  switch (sub) {
    case 'status':
    case 'log':
    case 'diff':
    case 'show':
    case 'ls-files':
    case 'rev-parse':
    case 'blame':
    case 'shortlog':
    case 'describe':
    case 'ls-tree':
    case 'cat-file':
    case 'grep':
    case 'count-objects':
    case 'merge-base':
    case 'name-rev':
    case 'for-each-ref':
    case 'show-ref':
    case 'whatchanged':
    case 'var':
    case 'check-ignore':
    case 'diff-tree':
    case 'diff-index':
    case 'rev-list':
    case 'help':
    case 'version':
      kind.readOnly = !has(rest, '--output') && !rest.some((word) => word.startsWith('--output='))
      break
    case 'branch':
      // Listing only: no name to make, and nothing deleted, moved or copied.
      kind.readOnly =
        positionals(rest, ['--contains', '--merged', '--no-merged', '--points-at', '--sort', '--format']).length === 0 &&
        !short(rest, 'd') &&
        !short(rest, 'D') &&
        !short(rest, 'm') &&
        !short(rest, 'M') &&
        !short(rest, 'c') &&
        !short(rest, 'C') &&
        !has(rest, '--delete', '--move', '--copy', '--set-upstream-to', '-u', '--unset-upstream', '--edit-description')
      kind.destructive = short(rest, 'D') || (has(rest, '--delete') && has(rest, '--force', '-f'))
      break
    case 'remote':
      kind.readOnly = rest.every((word) => word === '-v' || word === '--verbose')
      kind.network = has(rest, 'update', 'prune') || (rest[0] === 'show' && !has(rest, '-n'))
      break
    case 'tag':
      kind.readOnly = rest.length === 0 || has(rest, '-l', '--list')
      kind.destructive = short(rest, 'd') || has(rest, '--delete')
      break
    case 'config':
      kind.readOnly = has(rest, '--get', '--get-all', '--get-regexp', '--list', '-l', '--show-origin') && !has(rest, '--unset', '--add', '--replace-all')
      break
    case 'stash':
      kind.readOnly = rest[0] === 'list' || rest[0] === 'show'
      kind.destructive = rest[0] === 'drop' || rest[0] === 'clear'
      break
    case 'worktree':
      kind.readOnly = rest[0] === 'list'
      kind.destructive = rest[0] === 'remove' && has(rest, '--force', '-f')
      break
    case 'reflog':
      kind.readOnly = rest.length === 0 || rest[0] === 'show'
      kind.destructive = rest[0] === 'expire' || rest[0] === 'delete'
      break
    case 'clean':
      kind.destructive = !short(rest, 'n') && !has(rest, '--dry-run')
      break
    case 'reset':
      kind.destructive = has(rest, '--hard', '--keep', '--merge')
      break
    case 'push':
      kind.network = true
      kind.destructive =
        has(rest, '--force', '-f', '--force-with-lease', '--mirror', '--delete', '-d') ||
        rest.some((word) => word.startsWith('--force') || word.startsWith('+') || word.startsWith(':'))
      break
    case 'checkout':
      // Back to the committed version: what was changed in those files is lost.
      kind.destructive = has(rest, '--', '.', '-f', '--force')
      break
    case 'restore':
      kind.destructive = !has(rest, '--staged', '-S') || has(rest, '--worktree', '-W')
      break
    case 'rm':
    case 'filter-branch':
    case 'filter-repo':
      kind.destructive = true
      break
    case 'clone':
    case 'fetch':
    case 'pull':
    case 'ls-remote':
    case 'archive':
      kind.network = sub !== 'archive' || has(rest, '--remote')
      break
    case 'submodule':
      kind.network = rest[0] === 'update' || rest[0] === 'add' || rest[0] === 'sync'
      break
  }
  return kind
}

/** Package managers: installing reaches the network; removing one installed for the whole system destroys. */
function packages(program: string, args: readonly string[]): Kind {
  const { sub } = subcommandOf(program, args)
  const kind: Kind = sub === undefined ? {} : { sub }
  const word = sub ?? ''
  switch (program) {
    case 'npm':
    case 'pnpm':
    case 'yarn':
    case 'bun':
      kind.readOnly = ['ls', 'list', 'll', 'la', 'root', 'prefix', 'why', 'explain', 'bin'].includes(word) || (word === 'config' && has(args, 'get', 'list'))
      kind.network =
        [
          'install',
          'i',
          'ci',
          'add',
          'update',
          'up',
          'upgrade',
          'outdated',
          'view',
          'info',
          'show',
          'search',
          'audit',
          'publish',
          'login',
          'dlx',
          'x',
          'create',
          'init',
          'exec'
        ].includes(word) ||
        (program === 'yarn' && sub === undefined)
      kind.destructive = ['uninstall', 'remove', 'rm', 'un', 'r', 'unlink'].includes(word) && has(args, '-g', '--global')
      // A package's scripts are code of its own, not read here.
      kind.opaque =
        ['run', 'run-script', 'test', 't', 'start', 'exec', 'x', 'dlx', 'create'].includes(word) ||
        (program === 'yarn' &&
          !['add', 'install', 'remove', 'upgrade', 'info', 'why', 'list', 'config', 'init', 'outdated'].includes(word) &&
          sub !== undefined)
      break
    case 'pip':
    case 'pip3':
      kind.readOnly = ['list', 'show', 'freeze', 'check', 'help'].includes(word)
      kind.network = ['install', 'download', 'search', 'index'].includes(word)
      kind.destructive = word === 'uninstall'
      break
    case 'uv':
      kind.network = ['add', 'sync', 'lock', 'tool', 'run', 'init'].includes(word) || (word === 'pip' && has(args, 'install', 'sync', 'compile'))
      kind.readOnly = (word === 'pip' && has(args, 'list', 'show', 'freeze', 'tree')) || word === 'tree'
      kind.destructive = word === 'pip' && has(args, 'uninstall')
      kind.opaque = word === 'run' || word === 'tool'
      break
    case 'winget':
    case 'choco':
    case 'scoop':
    case 'brew':
    case 'port':
    case 'snap':
    case 'flatpak':
    case 'gem':
    case 'pipx':
    case 'conda':
    case 'poetry':
    case 'apt':
    case 'apt-get':
    case 'dnf':
    case 'yum':
    case 'zypper':
      kind.network = [
        'install',
        'upgrade',
        'update',
        'add',
        'source',
        'tap',
        'search',
        'download',
        'reinstall',
        'dist-upgrade',
        'full-upgrade',
        'in',
        'create'
      ].includes(word)
      kind.destructive = ['uninstall', 'remove', 'rm', 'purge', 'autoremove', 'erase'].includes(word)
      kind.readOnly =
        (program === 'conda' && (word === 'list' || word === 'info')) || (program === 'brew' && (word === 'list' || word === '--prefix' || word === 'config'))
      break
    case 'cargo':
      kind.network = ['install', 'add', 'fetch', 'update', 'publish', 'search', 'login'].includes(word)
      kind.destructive = word === 'uninstall'
      kind.opaque = ['run', 'build', 'test', 'bench'].includes(word)
      break
    case 'go':
      kind.readOnly = ['version', 'env', 'list', 'doc'].includes(word) && !has(args, '-w')
      kind.network = word === 'get' || word === 'install' || (word === 'mod' && has(args, 'download', 'tidy'))
      kind.opaque = ['run', 'test', 'generate', 'build'].includes(word)
      break
  }
  return kind
}

/** What a program does with its words. `program` is in lower case, without its folder or `.exe`. */
function kindOf(program: string, args: readonly string[], context: Context): Kind {
  const lower = args.map((word) => word.toLowerCase())
  const first = lower[0] ?? ''

  // Any program, asked only its version or its help.
  if (args.length === 1 && ['--version', '--help', '-version', '-help', '/?', '-?'].includes(first)) return { readOnly: true }

  if (program === 'git') return git(args)
  if (
    [
      'npm',
      'pnpm',
      'yarn',
      'bun',
      'pip',
      'pip3',
      'uv',
      'winget',
      'choco',
      'scoop',
      'brew',
      'port',
      'snap',
      'flatpak',
      'gem',
      'pipx',
      'conda',
      'poetry',
      'apt',
      'apt-get',
      'dnf',
      'yum',
      'zypper',
      'cargo',
      'go'
    ].includes(program)
  ) {
    return packages(program, args)
  }

  const shell = SHELLS[program]
  if (shell) return nestedShell(program, shell, args)

  if (INTERPRETERS.has(program)) {
    // `python -m pip install x` installs; `python script.py`, `node -e "…"` run what cannot be read here.
    const module = args.indexOf('-m')
    if (module >= 0 && ['pip', 'pip3'].includes(args[module + 1] ?? '')) {
      const { sub: _, ...kind } = packages('pip', args.slice(module + 2))
      return { ...kind, opaque: false }
    }
    return { opaque: true }
  }

  switch (program) {
    case 'rm':
    case 'rmdir':
    case 'unlink':
    case 'shred':
    case 'srm':
    case 'truncate':
    case 'del':
    case 'erase':
    case 'rd':
    case 'mkfs':
    case 'fdisk':
    case 'sfdisk':
    case 'gdisk':
    case 'parted':
    case 'wipefs':
    case 'format':
    case 'diskpart':
    case 'reboot':
    case 'poweroff':
    case 'halt':
    case 'icacls':
    case 'cacls':
    case 'takeown':
    case 'bcdedit':
      return { destructive: true, recursive: short(args, 'r') || short(args, 'R') || has(args, '--recursive') || hasCaseless(args, '/s') }
    case 'shutdown':
      return { destructive: !hasCaseless(args, '/a', '-a', '-c') }
    case 'init':
      return { destructive: has(args, '0', '6') }
    case 'chmod':
    case 'chown':
    case 'chgrp':
      return { destructive: short(args, 'R') || has(args, '--recursive'), recursive: short(args, 'R') || has(args, '--recursive') }
    case 'dd':
      return { destructive: args.some((word) => word.startsWith('of=')) }
    case 'kill':
    case 'pkill':
    case 'killall':
      return { destructive: has(args, '-9', '-KILL', '-SIGKILL') || (has(args, '-s') && hasCaseless(args, 'kill', 'sigkill')) }
    case 'taskkill':
      return { destructive: hasCaseless(args, '/f', '-f'), windows: true }
    case 'reg':
      return {
        sub: first,
        readOnly: first === 'query',
        destructive: ['add', 'delete', 'import', 'restore', 'load', 'unload', 'copy'].includes(first),
        windows: true
      }
    case 'sc':
      return {
        sub: first,
        readOnly: ['query', 'queryex', 'qc', 'getdisplayname', 'getkeyname', 'qdescription'].includes(first),
        destructive: first === 'delete',
        windows: true
      }
    case 'msiexec':
      return { destructive: hasCaseless(args, '/x', '/uninstall'), windows: true }
    case 'wmic':
      return {
        readOnly: lower.includes('get') && !lower.some((word) => ['delete', 'call', 'set', 'create'].includes(word)),
        destructive: lower.includes('delete') || lower.includes('uninstall'),
        windows: true
      }
    case 'vssadmin':
      return { destructive: first === 'delete' || first === 'resize', readOnly: first === 'list', windows: true }
    case 'cipher':
      return { destructive: lower.some((word) => word.startsWith('/w')), windows: true }
    case 'robocopy':
      return { destructive: hasCaseless(args, '/mir', '/purge', '/move', '/mov'), recursive: true, windows: true }
    case 'xcopy':
      return { recursive: hasCaseless(args, '/s', '/e'), windows: true }
    case 'attrib':
      return { readOnly: !args.some((word) => /^[+-][rahsi]$/i.test(word)), recursive: hasCaseless(args, '/s'), windows: true }
    case 'ipconfig':
      return { readOnly: args.length === 0 || hasCaseless(args, '/all', '/displaydns'), windows: true }
    case 'schtasks':
      return { readOnly: hasCaseless(args, '/query'), destructive: hasCaseless(args, '/delete'), windows: true }
    case 'diskutil':
      return { sub: first, readOnly: ['list', 'info'].includes(first), destructive: /^(erase|partition|zero|secureerase|reformat|apfs)/i.test(first) }
    case 'defaults':
      return { sub: first, readOnly: first === 'read' || first === 'read-type' || first === 'domains', destructive: first === 'delete' }
    case 'systemctl':
      return {
        sub: positionals(args)[0]?.word,
        readOnly: ['status', 'list-units', 'list-unit-files', 'is-active', 'is-enabled', 'show', 'cat', 'list-timers'].includes(
          positionals(args)[0]?.word ?? ''
        ),
        destructive: ['poweroff', 'reboot', 'halt', 'kexec'].includes(positionals(args)[0]?.word ?? '')
      }
    case 'crontab':
      return { readOnly: has(args, '-l'), destructive: has(args, '-r') }
    case 'docker':
    case 'podman': {
      const { sub } = subcommandOf(program, args)
      const word = sub ?? ''
      return {
        ...(sub === undefined ? {} : { sub }),
        readOnly: ['ps', 'images', 'inspect', 'logs', 'version', 'info', 'stats', 'top', 'port', 'history'].includes(word),
        network: ['pull', 'push', 'login', 'search', 'build'].includes(word),
        destructive:
          ['rm', 'rmi', 'prune', 'kill'].includes(word) ||
          ((word === 'system' || word === 'volume' || word === 'image' || word === 'container' || word === 'network') && has(args, 'prune', 'rm'))
      }
    }
    case 'kubectl': {
      const { sub } = subcommandOf(program, args)
      return { ...(sub === undefined ? {} : { sub }), network: true, destructive: sub === 'delete' }
    }
    case 'gh':
      return { sub: first, network: true }
    case 'curl':
    case 'wget':
    case 'aria2c':
    case 'ssh':
    case 'scp':
    case 'sftp':
    case 'ftp':
    case 'tftp':
    case 'telnet':
    case 'nc':
    case 'ncat':
    case 'netcat':
    case 'socat':
    case 'ping':
    case 'traceroute':
    case 'tracert':
    case 'nslookup':
    case 'dig':
    case 'whois':
    case 'http':
    case 'https':
    case 'xh':
    case 'bitsadmin':
    case 'npx':
    case 'pnpx':
    case 'bunx':
    case 'uvx':
      return {
        network: true,
        opaque: ['npx', 'pnpx', 'bunx', 'uvx'].includes(program),
        recursive: program === 'scp' && short(args, 'r'),
        windows: program === 'bitsadmin'
      }
    case 'host':
      return { network: args.length > 0, readOnly: args.length === 0 }
    case 'certutil':
      return { network: lower.some((word) => word.startsWith('-urlcache') || word.startsWith('-verifyctl')), windows: true }
    case 'rsync': {
      const remote = args.some((word) => /^[\w.-]+@?[\w.-]*:/.test(word) && !/^[A-Za-z]:/.test(word)) || args.some((word) => word.startsWith('rsync://'))
      return { network: remote, destructive: args.some((word) => word.startsWith('--delete') || word === '--remove-source-files'), recursive: true }
    }
    case 'tee':
    case 'touch':
    case 'mkdir':
    case 'md':
    case 'cp':
    case 'copy':
    case 'mv':
    case 'move':
    case 'ren':
    case 'rename':
    case 'ln':
    case 'mklink':
    case 'install':
    case 'zip':
    case 'unzip':
    case 'tar':
    case '7z':
    case 'setx':
    case 'start':
    case 'open':
    case 'xdg-open':
      return {
        recursive:
          ['tar', '7z'].includes(program) ||
          (['cp', 'zip', 'scp'].includes(program) && (short(args, 'r') || short(args, 'R') || short(args, 'a') || has(args, '--recursive'))),
        windows: WINDOWS_PROGRAMS.has(program)
      }
    case 'eval':
    case 'source':
    case '.':
    case 'call':
    case 'wsl':
    case 'exec':
      return { opaque: true, nested: program === 'eval' ? [{ line: args.join(' '), shell: 'posix' }] : [] }
    case 'find':
      return findKind(args)
  }

  if (READING.has(program)) return readingKind(program, args)
  if (context.shell === 'cmd' && ['for', 'if'].includes(program)) return { opaque: true }
  return {}
}

/** Programs that read, unless an option makes them write, and whose first word may be a pattern rather than a path. */
function readingKind(program: string, args: readonly string[]): Kind {
  const kind: Kind = { readOnly: true }
  const first = positionals(args, ['-e', '-f', '-m', '-A', '-B', '-C', '-d', '-D', '-g', '-t', '-T', '--glob', '--type', '--include', '--exclude'])[0]
  switch (program) {
    case 'grep':
    case 'egrep':
    case 'fgrep':
    case 'rg':
    case 'ag':
    case 'ack':
    case 'findstr': {
      // The first word is the pattern, unless one was given with `-e` or `-f`; globs given to an option are patterns too.
      const notPaths = new Set<number>()
      for (const [index, word] of args.entries())
        if (['-e', '-g', '--glob', '-t', '--type', '--include', '--exclude', '--regexp'].includes(word)) notPaths.add(index + 1)
      if (first && !has(args, '-e', '-f', '--regexp', '--file') && program !== 'findstr') notPaths.add(first.index)
      if (program === 'findstr' && first) notPaths.add(first.index)
      kind.notPaths = notPaths
      kind.recursive = ['rg', 'ag', 'ack'].includes(program) || short(args, 'r') || short(args, 'R') || has(args, '--recursive', '/s', '/S')
      kind.windows = program === 'findstr'
      return kind
    }
    case 'sed':
      kind.readOnly = !args.some((word) => /^-[A-Za-z]*i/.test(word) || word.startsWith('--in-place'))
      if (first && !has(args, '-e', '-f', '--expression', '--file')) kind.notPaths = new Set([first.index])
      return kind
    case 'awk':
    case 'gawk':
    case 'mawk': {
      const script = has(args, '-f') ? '' : (first?.word ?? '')
      // Writing to a file or running a command from inside the script.
      kind.readOnly = !/system\s*\(|\|\s*getline|print[f]?[^;}]*>\s*["$\w]|\|\s*"/.test(script) && !args.some((word) => word.startsWith('-i'))
      if (first && !has(args, '-f')) kind.notPaths = new Set([first.index])
      return kind
    }
    case 'jq':
    case 'yq':
      kind.readOnly = !args.some((word) => /^-[A-Za-z]*i/.test(word) || word === '--inplace')
      if (first) kind.notPaths = new Set([first.index])
      return kind
    case 'sort':
      kind.readOnly = !has(args, '-o', '--output') && !args.some((word) => word.startsWith('--output=') || /^-o./.test(word))
      return kind
    case 'uniq':
      // A second file is where it writes.
      kind.readOnly = positionals(args, ['-f', '-s', '-w']).length < 2
      return kind
    case 'xxd':
      kind.readOnly = positionals(args, ['-c', '-g', '-l', '-s', '-o']).length < 2
      return kind
    case 'date':
      kind.readOnly = !has(args, '-s', '--set')
      return kind
    case 'hostname':
      kind.readOnly = positionals(args).length === 0
      return kind
    case 'echo':
    case 'printf':
      // What it prints is no path: what it writes to, after `>`, is checked as one.
      kind.notPaths = new Set(args.keys())
      return kind
    case 'ls':
    case 'dir':
    case 'tree':
    case 'du':
      kind.recursive = program === 'tree' || program === 'du' || short(args, 'R') || has(args, '--recursive', '/s', '/S')
      kind.windows = program === 'dir' || program === 'tree'
      return kind
    case 'diff':
      kind.recursive = short(args, 'r') || has(args, '--recursive')
      return kind
    case 'fd':
    case 'fdfind':
      kind.recursive = true
      kind.readOnly = !has(args, '-x', '-X', '--exec', '--exec-batch')
      if (first) kind.notPaths = new Set([first.index])
      return kind
    case 'env':
      kind.readOnly = true
      return kind
  }
  return kind
}

/** `find`: its starting points are its paths, and what it runs with `-exec` is a command of its own. */
function findKind(args: readonly string[]): Kind {
  const onlyPaths = new Set<number>()
  let at = 0
  while (at < args.length && !/^[-(!)]/.test(args[at] as string)) onlyPaths.add(at++)
  const nested: { line: string; shell: Shell }[] = []
  let readOnly = true
  let destructive = false
  for (let index = at; index < args.length; index++) {
    const word = args[index] as string
    if (['-newer', '-samefile', '-anewer', '-cnewer', '-fprint', '-fprint0', '-fprintf', '-fls'].includes(word)) onlyPaths.add(index + 1)
    if (['-fprint', '-fprint0', '-fprintf', '-fls'].includes(word)) readOnly = false
    if (word === '-delete') {
      readOnly = false
      destructive = true
    }
    if (['-exec', '-execdir', '-ok', '-okdir'].includes(word)) {
      readOnly = false
      const end = args.findIndex((other, after) => after > index && (other === ';' || other === '+' || other === '\\;'))
      const command = args.slice(index + 1, end < 0 ? args.length : end).filter((part) => part !== '{}')
      nested.push({ line: command.map(quoted).join(' '), shell: 'posix' })
      index = end < 0 ? args.length : end
    }
  }
  return { readOnly, destructive, recursive: true, onlyPaths, nested }
}

/** A word written back into a line, quoted so the shell reads it as the one word it was. */
const quoted = (word: string) => (/^[\w./~:=@%+-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`)

/** `bash -c "…"`, `powershell -Command …`, `cmd /c …`: the line given is read with that shell; a script given is not. */
function nestedShell(program: string, shell: Shell, args: readonly string[]): Kind {
  if (shell === 'posix') {
    const at = args.findIndex((word) => /^-[A-Za-z]*c[A-Za-z]*$/.test(word))
    if (at >= 0) return { launcher: true, nested: [{ line: args[at + 1] ?? '', shell }], notPaths: new Set([at + 1]) }
    // A script file, or code read from what it is fed.
    return { opaque: true }
  }
  if (shell === 'cmd') {
    const at = args.findIndex((word) => /^\/[ck]$/i.test(word))
    if (at >= 0) return { launcher: true, nested: [{ line: args.slice(at + 1).join(' '), shell }], notPaths: new Set(args.keys()), windows: true }
    return { opaque: true, windows: true }
  }
  // PowerShell: options that take a value, then the command, an encoded command, or a file.
  const takesValue = [
    '-executionpolicy',
    '-ep',
    '-ex',
    '-windowstyle',
    '-w',
    '-outputformat',
    '-of',
    '-inputformat',
    '-if',
    '-version',
    '-v',
    '-workingdirectory',
    '-wd',
    '-configurationname',
    '-settingsfile'
  ]
  for (let at = 0; at < args.length; at++) {
    const word = (args[at] as string).toLowerCase().replace(/^\//, '-')
    if (/^-(c|co|com|comm|comma|comman|command)$/.test(word)) {
      const rest = args.slice(at + 1)
      if (rest.length === 1 && rest[0] === '-') return { opaque: true }
      return { launcher: true, nested: [{ line: rest.join(' '), shell }], notPaths: new Set(args.keys()) }
    }
    if (/^-(e|ec|en|enc|enco|encod|encode|encoded|encodedc|encodedcommand)$/.test(word)) return { opaque: true, notPaths: new Set([at + 1]) }
    if (/^-(f|fi|fil|file)$/.test(word)) return { opaque: true }
    if (takesValue.includes(word)) {
      at++
      continue
    }
    if (word.startsWith('-')) continue
    // A first word that is no option: `powershell` reads it as the command, `pwsh` as a script file.
    if (program === 'pwsh' || /\.ps1$/i.test(word)) return { opaque: true }
    return { launcher: true, nested: [{ line: args.slice(at).join(' '), shell }], notPaths: new Set(args.keys()) }
  }
  // Commands read from what it is fed.
  return { opaque: true }
}

/** What a PowerShell command does: by its name, then its parameters. `name` is its full name, in its own capitals. */
function powershellKind(name: string, args: readonly string[]): Kind {
  const lower = name.toLowerCase()
  const text = args.join(' ')
  const kind: Kind = {}
  if (POWERSHELL_READING.has(lower) || (READING_VERBS.test(lower) && !POWERSHELL_NETWORK.has(lower))) kind.readOnly = true
  if (POWERSHELL_NETWORK.has(lower)) kind.network = true
  if (POWERSHELL_DESTROYING.has(lower)) kind.destructive = true
  if (POWERSHELL_OPAQUE.has(lower)) kind.opaque = true
  if (lower === 'stop-process') kind.destructive = parameter(args, 'force')
  // The machine's own registry.
  if (/^(set-itemproperty|new-itemproperty|new-item|set-item|copy-item|move-item|rename-item)$/.test(lower) && /\bHKLM:|HKEY_LOCAL_MACHINE/i.test(text))
    kind.destructive = true
  if (lower === 'foreach-object' || lower === 'where-object') {
    // A method or property named instead of a script block, `% Delete`, runs what cannot be read here.
    kind.readOnly = args.every((word) => word.startsWith('-') || word === '{…}') || lower === 'where-object'
  }
  if (lower === 'start-process' && parameter(args, 'verb', 2)) kind.opaque = true
  kind.recursive = parameter(args, 'recurse', 2) || parameter(args, 'depth', 2)
  if (lower === 'get-childitem' && parameter(args, 'recurse')) kind.recursive = true
  if (lower === 'write-output' || lower === 'write-host') kind.notPaths = new Set(args.keys())
  if (lower === 'select-string') {
    const pattern = args.findIndex((word) => parameter([word], 'pattern', 2))
    if (pattern >= 0) kind.notPaths = new Set([pattern + 1])
  }
  return kind
}

// ---------------------------------------------------------------- one stage

/** The program a word names: its last part, in lower case, without `.exe`. A path is a program only when it is a known one. */
function programOf(word: string): { name: string; path: boolean; script: boolean } {
  const path = /[\\/]/.test(word)
  const last = word.split(/[\\/]/).at(-1) ?? word
  // `mkfs.ext4` is `mkfs`.
  const name = last
    .toLowerCase()
    .replace(/\.(exe|com)$/, '')
    .replace(/^mkfs\..*$/, 'mkfs')
  const script = /\.(sh|bash|zsh|ps1|psm1|py|pyw|js|mjs|cjs|ts|rb|pl|php|bat|cmd|vbs|wsf|jar|lua|r)$/i.test(last)
  return { name, path, script }
}

function readStage(stage: Stage, context: Context): void {
  const { reading } = context
  let words = [...stage.words]

  // Files it is redirected to or from are named whatever they look like; writing to one is a change.
  for (const redirect of stage.redirects) {
    name(redirect.target, context, { always: true })
    if (redirect.writes && !NOWHERE.test(textOf(redirect.target).trim())) reading.readOnly = false
  }

  // What the line sets for itself: `x=…` in the POSIX shell, `$x = …` in PowerShell, `set x=…` in cmd.
  if (context.shell === 'posix') {
    while (words[0] && /^[A-Za-z_]\w*\+?=/.test(firstText(words[0]))) {
      const assigned = words.shift() as Word
      context.bound.add(firstText(assigned).replace(/\+?=.*$/, ''))
      const value = assignedValue(assigned)
      if (value) name(value, context)
    }
  } else if (context.shell === 'powershell' && words[1] && textOf(words[1]) === '=') {
    const target = words[0]?.pieces[0]
    if (target?.kind === 'variable') context.bound.add(target.name)
    words = words.slice(2)
    // A value given to it is named, as it is wherever it is used next.
    if (words[0]?.pieces[0]?.kind === 'text' && (words[0].pieces[0] as { quoted: boolean }).quoted) name(words[0], context)
  }

  // Keywords around commands: `if`, `then`, `do`, `!`, `time`.
  const keywords = context.shell === 'posix' ? POSIX_KEYWORDS : context.shell === 'powershell' ? POWERSHELL_KEYWORDS : new Set<string>()
  while (words[0] && isPlain(words[0])) {
    const keyword = textOf(words[0])
    if (keywords.has(context.shell === 'powershell' ? keyword.toLowerCase() : keyword) || (context.shell === 'posix' && keyword === 'time')) words.shift()
    else break
  }
  if (words.length === 0) return

  const head = textOf(words[0] as Word)
  if (context.shell === 'posix' && (head === 'for' || head === 'select')) {
    // `for f in a b c`: the words it goes through are named; the name it sets is the line's own.
    context.bound.add(textOf(words[1] ?? { pieces: [] }))
    for (const word of words.slice(3)) name(word, context)
    return
  }
  if (context.shell === 'posix' && (head === 'case' || head === 'function' || head === 'coproc')) {
    reading.opaque = true
    return
  }
  if (context.shell === 'cmd' && head.startsWith('@')) (words[0] as Word).pieces = [{ kind: 'text', text: head.slice(1), quoted: false }]

  // PowerShell's call operator, `& "C:\…\tool.exe" args`; dot-sourcing runs a script in the shell itself.
  const called = context.shell === 'powershell' && (head === '&' || head === '.')
  if (called) {
    if (head === '.') reading.opaque = true
    words = words.slice(1)
    if (words.length === 0) return
  }

  // Programs that run another one: `sudo`, `env`, `xargs`, `timeout 5`.
  let elevated = false
  for (;;) {
    const program = programOf(textOf(words[0] as Word)).name
    const wrapper = context.shell === 'posix' ? WRAPPERS[program] : undefined
    if (!wrapper || !isPlain(words[0] as Word)) break
    if (program === 'sudo' || program === 'doas') elevated = true
    let at = 1
    while (at < words.length) {
      const word = textOf(words[at] as Word)
      if (program === 'env' && /^[A-Za-z_]\w*=/.test(word)) {
        at++
        continue
      }
      if (!word.startsWith('-') || word === '-') break
      if (word === '--') {
        at++
        break
      }
      at += wrapper.values.includes(word) ? 2 : 1
    }
    // `timeout 5 cmd`, `nice 10 cmd`: a duration before the command.
    if (program === 'timeout' && at < words.length) at++
    if (program === 'watch') {
      readLine(words.slice(at).map(textOf).join(' '), { ...context, depth: context.depth + 1 })
      reading.commands.push(command('watch', 'watch', [], { readOnly: true }))
      return
    }
    if (program === 'xargs') {
      for (const value of words.slice(1, at)) name(value, context)
    }
    if (at >= words.length) {
      // Alone, `env` lists the variables and `command -v` finds a program: both only read.
      reading.commands.push(command(program, program, words.slice(1).map(textOf), { readOnly: program !== 'sudo' && program !== 'doas' && program !== 'exec' }))
      return
    }
    words = words.slice(at)
  }

  const programWord = words[0] as Word
  const args = words.slice(1)
  const argTexts = args.map(textOf)

  // In PowerShell, a stage that starts with a value is an expression: `$x`, `"done"`, `(Get-Item a).Length -gt 5`.
  // The commands in it were read on their own; calling a method on what it holds can do anything.
  const first = programWord.pieces[0]
  if (context.shell === 'powershell' && !called && (first?.kind === 'variable' || first?.kind === 'inner' || (first?.kind === 'text' && first.quoted))) {
    const calls = words.some((word) => word.pieces.some((piece) => piece.kind === 'inner' && piece.call))
    reading.commands.push(command('$', '$', [], { readOnly: !calls, opaque: calls }))
    return
  }

  // A program only the shell knows: a variable, or the output of another command.
  if (!isPlain(programWord) || programWord.pieces.length === 0) {
    reading.opaque = true
    reading.commands.push(command(textOf(programWord), textOf(programWord), argTexts, { opaque: true }))
    for (const word of args) name(word, context)
    return
  }

  const written = textOf(programWord)
  // .NET from PowerShell (`[IO.File]::Delete(…)`) can do anything.
  if (context.shell === 'powershell' && (written.startsWith('[') || /::/.test(written))) {
    reading.opaque = true
    reading.commands.push(command(written, written, argTexts, { opaque: true }))
    for (const word of args) name(word, context)
    return
  }
  if (context.shell === 'powershell' && args.some((word) => word.pieces.some((piece) => piece.kind === 'inner' && piece.call))) reading.opaque = true

  const found = programOf(written)
  const alias = context.shell === 'powershell' ? (ALIASES[found.name] ?? (/^[a-z]+-[a-z]+$/i.test(written) ? written : undefined)) : undefined

  // A script run by its path, or a program given by its path: the path is named too.
  if (found.path) name(programWord, context, { always: true })
  if (
    found.script ||
    (found.path &&
      !alias &&
      !READING.has(found.name) &&
      !SHELLS[found.name] &&
      !INTERPRETERS.has(found.name) &&
      !WINDOWS_PROGRAMS.has(found.name) &&
      !WITH_SUBCOMMANDS.has(found.name))
  ) {
    reading.commands.push(command(written, written, argTexts, { opaque: true }))
    for (const word of args) name(word, context)
    return
  }

  const program = alias ?? found.name
  // `find` in cmd searches for text in files: its first word is what it looks for.
  const cmdFind = context.shell === 'cmd' && found.name === 'find'
  const kind = alias
    ? powershellKind(alias, argTexts)
    : cmdFind
      ? { readOnly: true, windows: true, notPaths: new Set([positionals(argTexts)[0]?.index ?? -1]) }
      : kindOf(found.name, argTexts, context)
  if (elevated) kind.readOnly = false
  // A shell or an interpreter that reads what it is fed runs code that is not read here: `curl … | sh`, `python - <<EOF`.
  if ((stage.piped || stage.fed) && (INTERPRETERS.has(found.name) || (SHELLS[found.name] && !kind.launcher))) kind.opaque = true

  // `cd somewhere`: what follows is read from there.
  if (['cd', 'pushd', 'chdir', 'set-location', 'push-location'].includes(program.toLowerCase())) {
    const target = args.find((word) => !textOf(word).startsWith('-') && !/^\/d$/i.test(textOf(word)))
    if (target === undefined) {
      if (context.shell === 'posix') context.folder = '~'
    } else {
      const path = pathOf(target, context)
      if (path === 'unknown' || textOf(target) === '-') {
        reading.unresolved = true
        context.folder = undefined
      } else if (path) {
        name(target, context, { always: true })
        context.folder = isAbsolute(path.path) || context.folder === undefined ? path.path : joined(context.folder, path.path)
      }
    }
    reading.commands.push(command(program, program, argTexts, { readOnly: true }))
    return
  }

  for (const nested of kind.nested ?? []) readLine(nested.line, { ...context, shell: nested.shell, depth: context.depth + 1 })

  for (const [index, word] of args.entries()) {
    if (kind.notPaths?.has(index)) continue
    if (kind.onlyPaths && !kind.onlyPaths.has(index)) continue
    const value = assignedValue(word)
    const options = { windowsProgram: kind.windows === true, recursive: kind.recursive === true }
    if (value) name(value, context, options)
    else if (!textOf(word).startsWith('-')) name(word, context, options)
  }

  const key = kind.sub && WITH_SUBCOMMANDS.has(found.name) ? `${program} ${kind.sub.toLowerCase()}` : program
  reading.commands.push(
    command(program, key, argTexts, {
      readOnly: (kind.readOnly === true || kind.launcher === true) && kind.network !== true && kind.destructive !== true && kind.opaque !== true,
      destructive: kind.destructive === true,
      network: kind.network === true,
      opaque: kind.opaque === true,
      recursive: kind.recursive === true
    })
  )
}

const firstText = (word: Word) => {
  const first: Piece | undefined = word.pieces[0]
  return first?.kind === 'text' && !first.quoted ? first.text : ''
}

function command(program: string, key: string, args: string[], flags: Partial<Omit<ReadCommand, 'program' | 'key' | 'args'>>): ReadCommand {
  return {
    program,
    key,
    args,
    readOnly: flags.readOnly ?? false,
    destructive: flags.destructive ?? false,
    network: flags.network ?? false,
    opaque: flags.opaque ?? false,
    recursive: flags.recursive ?? false
  }
}
