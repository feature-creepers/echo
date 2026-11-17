import { describe, expect, it, vi } from 'vitest'
import { scriptedHarness } from '../replay/scripted-harness.ts'
import { createEngineRoom } from './engines.ts'

describe('the engine room', () => {
  it('runs on the first harness that is installed and signed in', async () => {
    const absent = scriptedHarness({ id: 'absent', status: { installed: false, signedIn: false, problem: 'Not found.' } })
    const signedOut = scriptedHarness({ id: 'signed-out', status: { installed: true, signedIn: false } })
    const ready = scriptedHarness({ id: 'ready' })
    const room = createEngineRoom([absent, signedOut, ready])

    expect((await room.read()).active).toBe('ready')
    expect(await room.active()).toBe(ready)
  })

  it('runs on nothing when no harness can be used', async () => {
    const room = createEngineRoom([scriptedHarness({ status: { installed: true, signedIn: false } })])
    expect((await room.read()).active).toBeUndefined()
    expect(await room.active()).toBeUndefined()
  })

  it('looks once, then remembers, until asked to look again', async () => {
    const harness = scriptedHarness()
    const status = vi.spyOn(harness, 'status')
    const room = createEngineRoom([harness])

    await room.read()
    await room.active()
    expect(status).toHaveBeenCalledOnce()

    await room.read(true)
    expect(status).toHaveBeenCalledTimes(2)
  })

  it('tells its listeners when a new look finds something different, and only then', async () => {
    const harness = scriptedHarness()
    const room = createEngineRoom([harness])
    const heard = vi.fn()
    room.onChange(heard)

    await room.read()
    await room.read(true)
    expect(heard).not.toHaveBeenCalled()

    harness.stand({ installed: true, signedIn: false })
    const engines = await room.read(true)
    expect(heard).toHaveBeenCalledExactlyOnceWith(engines)
  })

  it('reports a harness whose status cannot be read as unusable, with the reason', async () => {
    const broken = scriptedHarness({ id: 'broken' })
    vi.spyOn(broken, 'status').mockRejectedValue(new Error('It crashed.'))
    const room = createEngineRoom([broken])

    expect((await room.read()).harnesses).toEqual([{ id: 'broken', name: 'Scripted', installed: false, signedIn: false, problem: 'It crashed.' }])
  })

  it('opens the sign-in of the harness named, and rejects for one it does not have', async () => {
    const harness = scriptedHarness({ id: 'here' })
    const room = createEngineRoom([harness])

    await room.signIn('here')
    expect(harness.signIns).toBe(1)
    await expect(room.signIn('elsewhere')).rejects.toThrow('There is no harness "elsewhere".')
  })
})
