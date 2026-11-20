import { useEffect, useRef, useState } from 'react'
import { copyText } from '../files/file-actions.ts'

/** How long a button says whether its text was copied, in milliseconds. */
const SAID_MS = 1600

/** Copy a text to the clipboard, and say for a moment whether it was copied: undefined until then, and after. */
export function useCopy(text: string): { copied: boolean | undefined; copy(): void } {
  const [copied, setCopied] = useState<boolean>()
  const timer = useRef<number>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const copy = () =>
    void copyText(text).then((done) => {
      setCopied(done)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(undefined), SAID_MS)
    })
  return { copied, copy }
}
