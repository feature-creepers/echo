import { describe, expect, it } from 'vitest'
import { folderName, fromFolder, inFolder, partsFrom } from './folders.ts'

describe('inFolder and folderName', () => {
  it.each([
    ['/home/ada/echo', 'AGENTS.md', '/home/ada/echo/AGENTS.md'],
    ['/home/ada/echo/', 'AGENTS.md', '/home/ada/echo/AGENTS.md'],
    ['C:\\dev\\echo', 'AGENTS.md', 'C:\\dev\\echo\\AGENTS.md'],
    ['C:\\dev\\echo\\', 'CLAUDE.md', 'C:\\dev\\echo\\CLAUDE.md']
  ])('puts %s and %s together as %s', (folder, name, path) => {
    expect(inFolder(folder, name)).toBe(path)
  })

  it.each([
    ['/home/ada/echo', 'echo'],
    ['/home/ada/echo/', 'echo'],
    ['C:\\dev\\my project', 'my project']
  ])('names %s %s', (folder, name) => {
    expect(folderName(folder)).toBe(name)
  })
})

describe('partsFrom', () => {
  it.each([
    ['/p', '/p/src/a.ts', ['src', 'a.ts']],
    ['/p/', '/p/a.ts', ['a.ts']],
    ['/p', '/p', []],
    ['/p', '/pp/a.ts', undefined],
    ['/p', '/q/a.ts', undefined],
    ['C:\\dev\\echo', 'C:\\dev\\echo\\src\\a.ts', ['src', 'a.ts']],
    ['C:\\dev\\echo', 'c:\\Dev\\Echo\\a.ts', ['a.ts']],
    ['C:\\dev\\echo', 'C:\\dev\\echoes\\a.ts', undefined],
    ['/Users/ada/Echo', '/Users/ada/echo/a.ts', undefined]
  ] as const)('reads %s and %s as %j', (folder, path, parts) => {
    expect(partsFrom(folder, path)).toEqual(parts)
  })
})

describe('fromFolder', () => {
  it.each([
    ['/p', '/p/src/a.ts', 'src/a.ts'],
    ['/p', '/p', '.'],
    ['C:\\dev\\echo', 'C:\\dev\\echo\\src\\a.ts', 'src\\a.ts'],
    ['/p', '/elsewhere/a.ts', undefined]
  ])('writes %s from %s as %s', (folder, path, written) => {
    expect(fromFolder(folder, path)).toBe(written)
  })
})
