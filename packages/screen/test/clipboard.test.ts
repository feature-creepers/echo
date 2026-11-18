import { describe, expect, it } from 'vitest'
import { createClipboard } from '../src/clipboard/clipboard.ts'

// The real clipboard of this computer, only when asked; what the person copied is put back after.
describe.runIf(process.env.ASSISTANT_DESKTOP === '1')('the real clipboard', () => {
  it('keeps any character through a write and a read', async () => {
    const clipboard = createClipboard()
    const theirs = await clipboard.read()
    const text = 'Héllo, 世界 🎙\nsecond line'
    try {
      await clipboard.write(text)
      expect(await clipboard.read()).toBe(text)
    } finally {
      if (theirs.length > 0) await clipboard.write(theirs)
    }
  })
})
