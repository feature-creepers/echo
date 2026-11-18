/**
 * Where on the network a command line goes, as far as it says (docs/SPEC.md, section 12.2): the web addresses it
 * names, the `user@host` of ssh and git, and the host given to a program that connects. What a program works out
 * once it runs (a package manager's registry, the remote a git repository already knows) is not named on the line;
 * the network policy reads such a line as going somewhere it cannot tell.
 */

/** `scheme://user@host:port/…`: the host, an IPv6 address in its brackets. */
const ADDRESS = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]+\]|[^:/?#]+)/i
/** `git@github.com:org/repo`, `ada@nas:/backups`: a user, a host, and a path after a colon. */
const REMOTE_PATH = /^[^@/\s:]+@(\[[^\]]+\]|[a-z0-9.-]+):/i
/** `ada@nas`: ssh's own way of naming who connects where. */
const USER_AT_HOST = /^[^@/\s]+@(\[[^\]]+\]|[a-z0-9.-]+)$/i
/** A name a program fetches with no scheme: `example.com`, `api.example.com/v1`, `example.com:8080`. */
const DOTTED_NAME = /^((?:[a-z0-9-]+\.)+[a-z]{2,}|\d{1,3}(?:\.\d{1,3}){3}|localhost)(?::\d+)?(?:[/?#].*)?$/i
/** A host as such a program is given it: a name, with or without dots, or an address. */
const HOST_WORD = /^(\[[0-9a-f:.]+\]|[a-z0-9][a-z0-9.-]*|[0-9a-f:]+:[0-9a-f:]*)$/i

/** Programs whose first plain word is the host they connect to. */
const CONNECTING = new Set([
  'ssh',
  'sftp',
  'ftp',
  'tftp',
  'telnet',
  'nc',
  'ncat',
  'netcat',
  'ping',
  'traceroute',
  'tracert',
  'mosh',
  'whois',
  'nslookup',
  'host'
])
/** PowerShell's, by the name the reading gives them. */
const CONNECTING_CMDLETS = new Set(['test-connection', 'test-netconnection', 'resolve-dnsname'])
/** Programs that fetch an address given with no scheme. */
const FETCHING = new Set(['curl', 'wget', 'aria2c', 'http', 'https', 'xh', 'invoke-webrequest', 'invoke-restmethod'])
/** The options of a program that connects that take a value, so the value is not taken for the host. */
const CONNECTING_VALUED = new Set([
  '-p',
  '-i',
  '-l',
  '-o',
  '-F',
  '-J',
  '-L',
  '-R',
  '-D',
  '-b',
  '-c',
  '-E',
  '-e',
  '-m',
  '-O',
  '-Q',
  '-S',
  '-W',
  '-w',
  '-n',
  '-s',
  '-t',
  '-P',
  '-q'
])
/** The options of a program that fetches that take a value: a file to write, a header, data to send. */
const FETCHING_VALUED = new Set([
  '-o',
  '-O',
  '-d',
  '-H',
  '-u',
  '-X',
  '-A',
  '-e',
  '-b',
  '-c',
  '-T',
  '-F',
  '-x',
  '-K',
  '-w',
  '-m',
  '-P',
  '-U',
  '--output',
  '--output-document',
  '--directory-prefix',
  '--data',
  '--data-raw',
  '--data-binary',
  '--data-urlencode',
  '--header',
  '--user',
  '--request',
  '--user-agent',
  '--referer',
  '--cookie',
  '--cookie-jar',
  '--upload-file',
  '--form',
  '--proxy',
  '--config',
  '--write-out',
  '--max-time',
  '-outfile',
  '-method',
  '-headers',
  '-body',
  '-infile',
  '-contenttype',
  '-useragent',
  '-proxy',
  '-timeoutsec'
])

/** A host as it is compared: lower case, with no brackets, port or final dot. */
export function hostName(host: string): string {
  const lower = host.trim().toLowerCase()
  if (lower.startsWith('[')) return lower.slice(1, lower.indexOf(']') > 0 ? lower.indexOf(']') : undefined)
  // A name or an IPv4 address with a port; an IPv6 address has several colons and no port without brackets.
  const bare = (lower.match(/:/g) ?? []).length === 1 ? (lower.split(':')[0] ?? lower) : lower
  return bare.replace(/\.$/, '')
}

/** The hosts one command names, each once, in order. */
export function hostsOf(program: string, args: readonly string[]): string[] {
  const name = program.toLowerCase()
  const connects = CONNECTING.has(name) || CONNECTING_CMDLETS.has(name)
  const found: string[] = []
  const fetches = FETCHING.has(name)
  let hostSeen = false
  /** The word before was an option that takes a value: this word is that value, unless it is an address. */
  let value = false
  for (const word of args) {
    const address = ADDRESS.exec(word) ?? REMOTE_PATH.exec(word)
    if (address?.[1]) {
      found.push(address[1])
      value = false
      continue
    }
    if (value) {
      value = false
      continue
    }
    if (word.startsWith('-')) {
      value = (connects && CONNECTING_VALUED.has(word)) || (fetches && (FETCHING_VALUED.has(word) || FETCHING_VALUED.has(word.toLowerCase())))
      continue
    }
    if (connects && !hostSeen) {
      const named = USER_AT_HOST.exec(word)?.[1] ?? (HOST_WORD.test(word) && !/^\d+$/.test(word) ? word : undefined)
      if (named) {
        hostSeen = true
        found.push(named)
      }
      continue
    }
    if (fetches) {
      const fetched = DOTTED_NAME.exec(word)?.[1]
      if (fetched) found.push(fetched)
    }
  }
  return [...new Set(found.map(hostName))]
}

const ipv4 = (host: string): number[] | undefined => {
  const parts = host.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return undefined
  const numbers = parts.map(Number)
  return numbers.every((number) => number <= 255) ? numbers : undefined
}

/** This computer itself: `localhost`, 127.0.0.0/8, `::1`. A command reaching it reaches no network. */
export function isLoopback(host: string): boolean {
  const name = hostName(host)
  if (name === 'localhost' || name.endsWith('.localhost') || name === '::1' || name === '0.0.0.0') return true
  return ipv4(name)?.[0] === 127
}

/** Endings of names that only a local network answers. */
const LOCAL_ENDINGS = ['.local', '.lan', '.home', '.home.arpa', '.internal', '.intranet', '.localdomain', '.corp']

/**
 * A device of the local network: a private or link-local address, a name only a local network answers, or a name
 * with no dot at all, which only a local network's own names resolve ("nas", "printer").
 */
export function isLocalNetwork(host: string): boolean {
  const name = hostName(host)
  if (isLoopback(name)) return false
  const v4 = ipv4(name)
  if (v4) {
    const [a = 0, b = 0] = v4
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)
  }
  if (name.includes(':')) return /^f[cd]/.test(name) || /^fe[89ab]/.test(name)
  return !name.includes('.') || LOCAL_ENDINGS.some((ending) => name.endsWith(ending))
}

/** Whether a host is one of a list: the same name or address, or a name under one listed ("api.github.com" under "github.com"). */
export function listedHost(host: string, list: readonly string[]): boolean {
  const name = hostName(host)
  return list.some((entry) => {
    const listed = hostName(entry).replace(/^\*?\./, '')
    return listed !== '' && (name === listed || name.endsWith(`.${listed}`))
  })
}
