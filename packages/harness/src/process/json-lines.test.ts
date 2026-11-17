import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { readJsonLines, writeJsonLine } from './json-lines.ts'

function reading() {
  const stream = new PassThrough()
  const messages: unknown[] = []
  readJsonLines(stream, (message) => messages.push(message))
  return { stream, messages, settled: () => new Promise((resolve) => setImmediate(resolve)) }
}

describe('JSON lines', () => {
  it('gives each line as a value, however the stream cuts them', async () => {
    const { stream, messages, settled } = reading()
    stream.write('{"a":1}\n{"b"')
    stream.write(':2}\n\n  {"c":3}  \n')
    await settled()

    expect(messages).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }])
  })

  it('keeps a character whole when its bytes arrive in two chunks', async () => {
    const { stream, messages, settled } = reading()
    const bytes = Buffer.from('{"text":"café ✓"}\n', 'utf8')
    const cut = bytes.indexOf(0xc3) + 1
    stream.write(bytes.subarray(0, cut))
    stream.write(bytes.subarray(cut))
    await settled()

    expect(messages).toEqual([{ text: 'café ✓' }])
  })

  it('drops a line that is not JSON and goes on', async () => {
    const { stream, messages, settled } = reading()
    stream.write('Warning: something\n{"a":1}\n')
    await settled()

    expect(messages).toEqual([{ a: 1 }])
  })

  it('waits for the end of a line', async () => {
    const { stream, messages, settled } = reading()
    stream.write('{"a":1}')
    await settled()
    expect(messages).toEqual([])

    stream.write('\n')
    await settled()
    expect(messages).toEqual([{ a: 1 }])
  })

  it('writes one value as one line, and nothing to a closed stream', async () => {
    const stream = new PassThrough()
    const written: string[] = []
    stream.setEncoding('utf8').on('data', (chunk: string) => written.push(chunk))
    writeJsonLine(stream, { text: 'two\nlines' })
    await new Promise((resolve) => setImmediate(resolve))
    expect(written).toEqual(['{"text":"two\\nlines"}\n'])

    stream.end()
    expect(() => writeJsonLine(stream, { late: true })).not.toThrow()
    expect(() => writeJsonLine(undefined, { nowhere: true })).not.toThrow()
  })
})
