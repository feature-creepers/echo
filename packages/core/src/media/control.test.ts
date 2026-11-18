import { describe, expect, it } from 'vitest'
import { mediaControlOf } from './control.ts'

describe('the media tool, read', () => {
  it.each([
    [{ action: 'pause' }, { action: 'pause' }],
    [
      { action: 'volume', level: 30 },
      { action: 'volume', level: 0.3 }
    ],
    [
      { action: 'volume', level: 250 },
      { action: 'volume', level: 1 }
    ],
    [
      { action: 'volume', step: -20 },
      { action: 'volume', step: -0.2 }
    ],
    [
      { action: 'seek', to: 90 },
      { action: 'seek', to: 90 }
    ],
    [
      { action: 'seek', by: -30 },
      { action: 'seek', by: -30 }
    ],
    [
      { action: 'queue', url: 'https://example.org/a.mp3', title: 'A' },
      { action: 'queue', source: { url: 'https://example.org/a.mp3', title: 'A', kind: 'audio', live: false } }
    ],
    [{ action: 'next' }, { action: 'next' }],
    [{ action: 'clear-queue' }, { action: 'clear-queue' }]
  ])('reads %j', (input, control) => {
    expect(mediaControlOf(input)).toEqual(control)
  })

  it.each([[{ action: 'louder' }], [{ action: 'volume' }], [{ action: 'seek' }], [{ action: 'queue', url: 'not an address', title: 'A' }], [undefined]])(
    'says what is wrong with %j',
    (input) => {
      expect(typeof mediaControlOf(input)).toBe('string')
    }
  )
})
