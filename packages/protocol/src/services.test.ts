import { describe, expect, it } from 'vitest'
import { isWithin } from './services.ts'

describe('an address among those a widget declared', () => {
  it.each([
    ['https://api.github.com/repos/a/b/actions/runs', 'https://api.github.com/', true],
    ['https://api.github.com/repos', 'https://api.github.com', true],
    ['https://api.example.com/v1', 'https://api.example.com/v1', true],
    ['https://api.example.com/v1/items?page=2', 'https://api.example.com/v1', true],
    ['https://api.example.com/v10', 'https://api.example.com/v1', false],
    ['https://api.github.com.evil.net/repos', 'https://api.github.com/', false],
    ['https://api.github.com:8443/repos', 'https://api.github.com/', false],
    ['http://api.github.com/repos', 'https://api.github.com/', false],
    ['https://token@api.github.com/repos', 'https://api.github.com/', false],
    ['https://api.example.com/v1/../admin', 'https://api.example.com/v1', false],
    ['https://api.example.com/v1/%2e%2e/admin', 'https://api.example.com/v1', false],
    ['https://api.example.com\\v1', 'https://api.example.com/', false],
    ['https://API.GitHub.com/repos', 'https://api.github.com/', true],
    ['not an address', 'https://api.github.com/', false]
  ])('%s within %s: %s', (address, start, within) => {
    expect(isWithin(address, start)).toBe(within)
  })
})
