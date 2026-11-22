import type { KeptCopy } from '@repo/protocol'
import { lastPart } from '../changes/words.ts'
import { sizeWords } from '../files/words.ts'

/**
 * A copy of a repository as its row says it (docs/SPEC.md, section 7.11): whose it is and of which project, then its
 * branch and the room it takes. A folder no thread names is said by its own name.
 */
export function copyWords(copy: KeptCopy): { title: string; under: string } {
  const title = copy.thread ? `${lastPart(copy.thread.project)} · ${copy.thread.title}` : lastPart(copy.folder)
  const facts = [copy.thread ? copy.thread.branch : 'No thread uses it', copy.size === undefined ? undefined : sizeWords(copy.size)]
  return { title, under: facts.filter((fact) => fact !== undefined).join(' · ') }
}

/** What removing a copy loses and what stays, said before it is removed. */
export function removalWords(copy: KeptCopy): string {
  const stays = copy.thread ? ` What was committed stays on the branch ${copy.thread.branch}.` : ''
  return copy.holds === undefined ? `Nothing is lost.${stays}` : `This loses ${copy.holds}.${stays}`
}
