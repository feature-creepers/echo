import { describe, expect, it } from 'vitest'
import { createLineDecoder, encodeEvent, encodeLine, encodeResult } from './codec.ts'

describe('line framing', () => {
  it('round-trips a message', () => {
    const decoder = createLineDecoder()
    expect(decoder.push(encodeLine({ type: 'hello', text: 'line\nbreak' }))).toEqual([{ ok: true, message: { type: 'hello', text: 'line\nbreak' } }])
  })

  it('waits for the end of a line that arrives in pieces', () => {
    const decoder = createLineDecoder()
    const line = encodeLine({ a: 1 })
    expect(decoder.push(line.slice(0, 3))).toEqual([])
    expect(decoder.push(line.slice(3))).toEqual([{ ok: true, message: { a: 1 } }])
  })

  it('returns every message of a chunk, in order, and keeps the unfinished one', () => {
    const decoder = createLineDecoder()
    expect(decoder.push(`${encodeLine(1) + encodeLine(2)}{"a"`)).toEqual([
      { ok: true, message: 1 },
      { ok: true, message: 2 }
    ])
    expect(decoder.push(':3}\n')).toEqual([{ ok: true, message: { a: 3 } }])
  })

  it('accepts lines ended the Windows way and skips empty ones', () => {
    expect(createLineDecoder().push('{"a":1}\r\n\r\n{"a":2}\r\n')).toEqual([
      { ok: true, message: { a: 1 } },
      { ok: true, message: { a: 2 } }
    ])
  })

  it('reports a line that is not JSON and carries on', () => {
    expect(createLineDecoder().push('nope\n{"a":1}\n')).toEqual([
      { ok: false, error: 'not-json' },
      { ok: true, message: { a: 1 } }
    ])
  })

  it('stops for good when a peer sends more than the limit without a line break', () => {
    const decoder = createLineDecoder(8)
    expect(decoder.push('123456789')).toEqual([{ ok: false, error: 'too-long' }])
    expect(decoder.push('\n{"a":1}\n')).toEqual([])
  })

  it('stops for good on a complete line longer than the limit', () => {
    const decoder = createLineDecoder(8)
    expect(decoder.push('"123456789"\n{"a":1}\n')).toEqual([{ ok: false, error: 'too-long' }])
    expect(decoder.push('{"a":1}\n')).toEqual([])
  })

  it.each([
    ['a result that fits is sent as it is', 'x'.repeat(10), true],
    ['a result too long is sent as a failure, on one line the client reads', 'x'.repeat(400), false]
  ])('%s', (_name, text, whole) => {
    const line = encodeResult({ type: 'result', id: 'c1', ok: true, output: { text } }, 300)
    expect(line.endsWith('\n')).toBe(true)
    const [decoded] = createLineDecoder(300).push(line)
    expect(decoded?.ok).toBe(true)
    expect(decoded?.ok && decoded.message).toMatchObject(whole ? { id: 'c1', ok: true } : { id: 'c1', ok: false, error: { code: 'failed' } })
  })

  it('drops an event too long for one line, rather than cut the link', () => {
    expect(encodeEvent({ type: 'event', name: 'a' }, 100)).toBeDefined()
    expect(encodeEvent({ type: 'event', name: 'a', text: 'x'.repeat(200) }, 100)).toBeUndefined()
  })
})
