import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ANSWER_BYTES, CallFailed, caller, MAIL_BYTES } from '../src/requests.ts'

const PIECE = 64 * 1024
const OK = new TextEncoder().encode('{"ok":true}')

/** An answer of `size` bytes, spaces then `{"ok":true}`, sent in pieces as a network does; and how much of it was sent. */
function answer(size: number, { told = false, status = 200 } = {}) {
  const spaces = new Uint8Array(PIECE).fill(0x20)
  const sent = { bytes: 0 }
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const left = size - OK.byteLength - sent.bytes
      if (left <= 0) {
        controller.enqueue(OK)
        sent.bytes += OK.byteLength
        controller.close()
        return
      }
      const piece = spaces.subarray(0, Math.min(PIECE, left))
      sent.bytes += piece.byteLength
      controller.enqueue(piece)
    }
  })
  const response = new Response(body, { status, headers: told ? { 'content-length': String(size) } : {} })
  return { response, sent }
}

const call = (response: Response) => caller(async () => response, 'token', new AbortController().signal)

describe('an answer', () => {
  it.each([
    ['within the bound of an answer', ANSWER_BYTES - 1024, false, undefined, undefined],
    ['past the bound of an answer, its length untold', ANSWER_BYTES + 1, false, undefined, 'more than 4 MB'],
    ['past the bound of an answer, its length told', ANSWER_BYTES + 1, true, undefined, 'more than 4 MB'],
    ['of a mail read whole, past the bound of other answers', ANSWER_BYTES * 2, false, MAIL_BYTES, undefined],
    ['of a mail read whole, past its own bound', MAIL_BYTES + 1, false, MAIL_BYTES, 'more than 16 MB']
  ])('%s', async (_case, size, told, most, refused) => {
    const { response, sent } = answer(size, { told })
    const read = call(response)('https://mail.example/m1', z.object({ ok: z.boolean() }), most === undefined ? {} : { most })

    if (refused === undefined) {
      expect(await read).toEqual({ ok: true })
      return
    }
    await expect(read).rejects.toThrow(new CallFailed(`mail.example answered ${refused}, more than this app reads.`))
    // Past its bound, the rest of an answer is never read.
    expect(sent.bytes).toBeLessThanOrEqual((most ?? ANSWER_BYTES) + 2 * PIECE)
  })

  it('refused, is said in a few words however long the provider’s explanation', async () => {
    const { response, sent } = answer(MAIL_BYTES * 4, { status: 500 })
    await expect(call(response)('https://mail.example/m1', z.object({}))).rejects.toThrow('The provider answered 500.')
    expect(sent.bytes).toBeLessThan(ANSWER_BYTES)
  })
})
