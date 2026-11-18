import { describe, expect, it } from 'vitest'
import { hostName, hostsOf, isLocalNetwork, isLoopback, listedHost } from './hosts.ts'

describe('hostsOf', () => {
  it.each<[string, string[], string[]]>([
    ['curl', ['-fsSL', 'https://Example.com/install.sh'], ['example.com']],
    ['curl', ['-o', 'out.zip', 'example.com/file.zip'], ['example.com']],
    ['curl', ['-O', 'https://cdn.example.org/a.tar.gz'], ['cdn.example.org']],
    ['curl', ['-H', 'Host: x.y', 'http://192.168.1.20:8080/status'], ['192.168.1.20']],
    ['curl', ['localhost:3000/health'], ['localhost']],
    ['wget', ['-O', 'page.html', 'https://a.example.com', 'https://b.example.com'], ['a.example.com', 'b.example.com']],
    ['git', ['clone', 'git@github.com:org/repo.git'], ['github.com']],
    ['git', ['push', 'origin', 'main'], []],
    ['ssh', ['-p', '2222', '-i', 'key.pem', 'ada@nas'], ['nas']],
    ['ssh', ['server.example.com', 'uptime'], ['server.example.com']],
    ['scp', ['notes.txt', 'ada@[fe80::1]:/tmp/'], ['fe80::1']],
    ['ping', ['-c', '4', '10.0.0.1'], ['10.0.0.1']],
    ['ping', ['-n', '4', 'printer'], ['printer']],
    ['nc', ['-zv', 'db.internal', '5432'], ['db.internal']],
    ['Invoke-WebRequest', ['-Uri', 'https://api.github.com/repos', '-OutFile', 'repos.json'], ['api.github.com']],
    ['Test-NetConnection', ['-ComputerName', 'fileserver', '-Port', '445'], ['fileserver']],
    ['npm', ['install', 'left-pad'], []]
  ])('%s %j names %j', (program, args, hosts) => {
    expect(hostsOf(program, args)).toEqual(hosts)
  })
})

describe('kinds of hosts', () => {
  it.each([
    ['localhost', true, false],
    ['127.0.0.1', true, false],
    ['[::1]', true, false],
    ['app.localhost', true, false],
    ['192.168.1.20', false, true],
    ['10.2.3.4', false, true],
    ['172.20.0.1', false, true],
    ['172.32.0.1', false, false],
    ['169.254.10.10', false, true],
    ['fd00::1', false, true],
    ['nas', false, true],
    ['printer.local', false, true],
    ['router.home.arpa', false, true],
    ['github.com', false, false],
    ['8.8.8.8', false, false]
  ])('%s: this computer %s, the local network %s', (host, loopback, local) => {
    expect(isLoopback(host)).toBe(loopback)
    expect(isLocalNetwork(host)).toBe(local)
  })

  it.each([
    ['Example.COM.', 'example.com'],
    ['example.com:8080', 'example.com'],
    ['[fe80::1]', 'fe80::1'],
    ['fe80::1', 'fe80::1']
  ])('names %s as %s', (host, name) => {
    expect(hostName(host)).toBe(name)
  })

  it.each([
    ['api.github.com', ['github.com'], true],
    ['github.com', ['*.github.com'], true],
    ['notgithub.com', ['github.com'], false],
    ['192.168.1.20', ['192.168.1.20'], true],
    ['example.org', [], false]
  ])('%s is under %j: %s', (host, list, listed) => {
    expect(listedHost(host, list)).toBe(listed)
  })
})
