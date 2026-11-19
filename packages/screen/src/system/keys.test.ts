import { describe, expect, it } from 'vitest'
import { readKey } from '../keys.ts'
import { systems } from './index.ts'
import { busCall, playersIn, playerToDrive, soundPrograms, statusIn } from './linux.ts'

const read = (written: string) => {
  const combination = readKey(written)
  if ('problem' in combination) throw new Error(combination.problem)
  return combination
}

describe('a key as each system presses it', () => {
  it.each([
    { written: 'Enter', win32: { modifiers: [], key: 0x0d, character: '' }, darwin: { code: 36, character: '', using: [] }, linux: 'Return' },
    {
      written: 'Control+S',
      win32: { modifiers: [0x11], key: 0x53, character: '' },
      darwin: { code: null, character: 's', using: ['control down'] },
      linux: 'ctrl+s'
    },
    {
      written: 'Meta+Shift+ArrowLeft',
      win32: { modifiers: [0x5b, 0x10], key: 0x25, character: '' },
      darwin: { code: 123, character: '', using: ['command down', 'shift down'] },
      linux: 'super+shift+Left'
    },
    {
      written: 'Alt+F4',
      win32: { modifiers: [0x12], key: 0x73, character: '' },
      darwin: { code: 118, character: '', using: ['option down'] },
      linux: 'alt+F4'
    },
    { written: 'é', win32: { modifiers: [], key: 0, character: 'é' }, darwin: { code: null, character: 'é', using: [] }, linux: 'U00E9' }
  ])('presses "$written"', ({ written, win32, darwin, linux }) => {
    expect(systems.win32.keys(read(written))).toEqual(win32)
    expect(systems.darwin.keys(read(written))).toEqual(darwin)
    expect(systems.linux.keys(read(written))).toEqual(linux)
  })
})

describe('a key of the whole system as each system presses it', () => {
  it.each([
    { key: 'MediaPlayPause', win32: 0xb3, darwin: 16, linux: { player: 'PlayPause' } },
    { key: 'MediaNext', win32: 0xb0, darwin: 17, linux: { player: 'Next' } },
    { key: 'MediaPrevious', win32: 0xb1, darwin: 18, linux: { player: 'Previous' } },
    { key: 'MediaStop', win32: 0xb2, darwin: null, linux: { player: 'Stop' } },
    { key: 'VolumeUp', win32: 0xaf, darwin: 0, linux: { sound: 'up' } },
    { key: 'VolumeDown', win32: 0xae, darwin: 1, linux: { sound: 'down' } },
    { key: 'VolumeMute', win32: 0xad, darwin: 7, linux: { sound: 'mute' } }
  ] as const)('presses $key', ({ key, win32, darwin, linux }) => {
    expect(systems.win32.systemKeys[key]).toBe(win32)
    expect(systems.darwin.systemKeys[key]).toBe(darwin)
    expect(systems.linux.systemKeys[key]).toEqual(linux)
  })
})

describe("on Linux, the desktop's own keys", () => {
  it('finds the players on the bus and their state', () => {
    expect(playersIn("(['org.freedesktop.DBus', ':1.2', 'org.mpris.MediaPlayer2.spotify', 'org.mpris.MediaPlayer2.firefox.instance_1_42'],)")).toEqual([
      'org.mpris.MediaPlayer2.spotify',
      'org.mpris.MediaPlayer2.firefox.instance_1_42'
    ])
    expect(playersIn("(['org.freedesktop.DBus', ':1.2'],)")).toEqual([])
    expect(statusIn("(<'Playing'>,)")).toBe('Playing')
    expect(statusIn('()')).toBeUndefined()
  })

  it.each([
    { players: [], driven: undefined },
    { players: [{ name: 'a', status: 'Stopped' }], driven: 'a' },
    {
      players: [
        { name: 'a', status: 'Paused' },
        { name: 'b', status: 'Playing' }
      ],
      driven: 'b'
    },
    {
      players: [
        { name: 'a', status: undefined },
        { name: 'b', status: 'Paused' }
      ],
      driven: 'b'
    }
  ])('drives the player playing, else one paused, else the first: $driven', ({ players, driven }) => {
    expect(playerToDrive(players)).toBe(driven)
  })

  it.each([
    { change: 'up', times: 1, programs: ['wpctl set-volume --limit 1.0 @DEFAULT_AUDIO_SINK@ 5%+', 'pactl set-sink-volume @DEFAULT_SINK@ +5%'] },
    { change: 'down', times: 3, programs: ['wpctl set-volume @DEFAULT_AUDIO_SINK@ 15%-', 'pactl set-sink-volume @DEFAULT_SINK@ -15%'] },
    { change: 'mute', times: 1, programs: ['wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle', 'pactl set-sink-mute @DEFAULT_SINK@ toggle'] },
    { change: 'mute', times: 2, programs: [] }
  ] as const)('changes the sound $change, $times times', ({ change, times, programs }) => {
    expect(soundPrograms(change, times).map((program) => [program.command, ...program.args].join(' '))).toEqual(programs)
  })

  it('calls the bus with gdbus', () => {
    expect(busCall('org.mpris.MediaPlayer2.spotify', '/org/mpris/MediaPlayer2', 'org.mpris.MediaPlayer2.Player.Next')).toEqual({
      command: 'gdbus',
      args: [
        'call',
        '--session',
        '--dest',
        'org.mpris.MediaPlayer2.spotify',
        '--object-path',
        '/org/mpris/MediaPlayer2',
        '--method',
        'org.mpris.MediaPlayer2.Player.Next'
      ]
    })
  })
})
