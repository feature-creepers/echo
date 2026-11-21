import { encodeBase64 } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import type { Answer, Question } from '../access/approvals.ts'
import { manualTimers } from '../replay/manual-timers.ts'
import { memoryWorkspace } from '../replay/memory-workspace.ts'
import { createDeviceActs } from './acts.ts'
import { createCameraControl, PICTURE_WAIT_MS } from './camera.ts'

const showing = () => ({ thread: 't', turn: 'turn' })
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9])

function setup({ answers = [], available = true }: { answers?: Answer[]; available?: boolean } = {}) {
  const asked: Question[] = []
  const recorded: { decision: string; reason: string }[] = []
  const requests: { request: string; camera: string | undefined }[] = []
  const timers = manualTimers()
  const workspace = memoryWorkspace()
  let made = 0
  const acts = createDeviceActs({
    ask: async (question) => {
      asked.push(question)
      return { answer: answers.shift() ?? 'no', pressed: false }
    },
    // The level lets everything run without asking: the camera is asked all the same.
    level: () => 'auto',
    uses: {
      record: (use) => {
        recorded.push({ decision: use.decision, reason: use.reason })
        return `use${recorded.length}`
      },
      report: () => undefined
    }
  })
  const camera = createCameraControl({
    acts,
    available: () => available,
    request: (request, name) => void requests.push({ request, camera: name }),
    newId: () => `picture${++made}`,
    timers,
    workspace,
    stamp: () => '2026-11-18 23.52.10'
  })
  const capture = (input: unknown = {}) => {
    const tool = camera.tools(showing).find((one) => one.definition.name === 'camera_capture')
    if (!tool) throw new Error('No camera tool')
    return tool.run(input)
  }
  return { camera, capture, asked, recorded, requests, timers, workspace }
}

/** Let the promises under way settle: the card's answer, then the request to the device. */
const settled = async () => {
  for (let round = 0; round < 10; round++) await Promise.resolve()
}

describe('the camera', () => {
  it('is offered only once a connected device declared one', () => {
    expect(setup({ available: false }).camera.tools(showing)).toEqual([])
    expect(
      setup()
        .camera.tools(showing)
        .map((tool) => tool.definition.name)
    ).toEqual(['camera_capture'])
  })

  it('is asked every time, whatever the level, never for the session, and the picture is seen and kept', async () => {
    const { camera, capture, asked, recorded, requests, workspace } = setup({ answers: ['yes', 'yes'] })
    for (let round = 1; round <= 2; round++) {
      const taking = capture({ camera: 'front' })
      await settled()
      expect(requests.at(-1)).toEqual({ request: `picture${round}`, camera: 'front' })
      camera.answer({ request: `picture${round}`, picture: { data: encodeBase64(JPEG), mime: 'image/jpeg', width: 640, height: 480, camera: 'Front camera' } })
      const result = await taking
      expect(result.ok).toBe(true)
      expect(result.images).toEqual([{ data: encodeBase64(JPEG), mime: 'image/jpeg' }])
      expect(result.text).toContain('taken with Front camera')
    }
    expect(asked).toHaveLength(2)
    expect(asked[0]).toMatchObject({ heading: 'Take a picture with your camera?', allow: 'Take it' })
    expect(asked[0]?.session).toBeUndefined()
    expect(recorded).toEqual([
      { decision: 'approved', reason: 'said' },
      { decision: 'approved', reason: 'said' }
    ])
    expect(workspace.files.get('camera/Picture 2026-11-18 23.52.10.jpg')).toEqual(JPEG)
    expect(workspace.files.get('camera/Picture 2026-11-18 23.52.10 (2).jpg')).toEqual(JPEG)
  })

  it('turns nothing on when the person says no', async () => {
    const { capture, requests, recorded } = setup({ answers: ['no'] })
    expect(await capture()).toMatchObject({ ok: false })
    expect(requests).toEqual([])
    expect(recorded).toEqual([{ decision: 'refused', reason: 'declined' }])
  })

  it('says why there is no picture: the device’s reason, no answer in time, or everything stopped', async () => {
    const told = setup({ answers: ['yes'] })
    const taking = told.capture()
    await settled()
    told.camera.answer({ request: 'picture1', problem: 'This computer has no camera.' })
    expect(await taking).toEqual({ ok: false, text: 'This computer has no camera.' })

    const silent = setup({ answers: ['yes'] })
    const waiting = silent.capture()
    await settled()
    silent.timers.advance(PICTURE_WAIT_MS)
    expect((await waiting).text).toContain('No camera answered in time')
    // An answer that comes after is dropped.
    silent.camera.answer({ request: 'picture1', picture: { data: encodeBase64(JPEG), mime: 'image/jpeg', width: 1, height: 1 } })

    const stopped = setup({ answers: ['yes'] })
    const held = stopped.capture()
    await settled()
    stopped.camera.stop()
    expect((await held).text).toContain('Stopped')
  })

  it('ignores an answer to a request nobody made', async () => {
    const { camera, capture } = setup({ answers: ['yes'] })
    const taking = capture()
    await settled()
    camera.answer({ request: 'someone-else', problem: 'no' })
    camera.answer({ request: 'picture1', picture: { data: encodeBase64(JPEG), mime: 'image/jpeg', width: 2, height: 2 } })
    expect(await taking).toMatchObject({ ok: true })
  })
})
