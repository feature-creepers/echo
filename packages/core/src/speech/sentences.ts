/**
 * Cuts a reply into sentences as its text arrives, so the first sentence can be spoken while the rest is
 * still being written.
 */
export interface SentenceCutter {
  /** Feed the next piece of text. Returns the sentences it completes, in order. */
  push(text: string): string[]
  /** The reply is over: returns what is left, if anything. */
  flush(): string[]
}

/** Short words that end with a full stop without ending a sentence, in English and French. */
const ABBREVIATIONS = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'vs', 'etc', 'no', 'approx', 'm', 'mme', 'mlle', 'e.g', 'i.e', 'cf', 'env'])

/**
 * The end of a sentence: its closing mark, any closing quote or bracket after it, then the space that follows. The
 * space must have arrived, so a mark at the very end of what arrived ("..." dot by dot) waits for what follows.
 */
const BOUNDARY = /([.!?…]+["'”’»)\]*_]*)(\s+)|(\n+)/g

export function createSentenceCutter(): SentenceCutter {
  let pending = ''

  /** Whether the full stop ending `upTo` belongs to an abbreviation, an initial or a numbered item, not to the end of a sentence. */
  const continues = (upTo: string, mark: string): boolean => {
    if (mark !== '.') return false
    const word = /([\p{L}\p{N}.]+)$/u.exec(upTo)?.[1] ?? ''
    if (word === '') return false
    if (/^\p{Lu}$/u.test(word)) return true // An initial: J. K. Rowling.
    if (/^\d+$/.test(word) && /(^|\n)\s*\d+$/.test(upTo)) return true // A numbered item at the start of a line.
    return ABBREVIATIONS.has(word.toLowerCase())
  }

  const take = (): string[] => {
    const sentences: string[] = []
    let start = 0
    BOUNDARY.lastIndex = 0
    for (let match = BOUNDARY.exec(pending); match; match = BOUNDARY.exec(pending)) {
      const mark = match[1]
      if (mark !== undefined && continues(pending.slice(start, match.index), mark)) continue
      const sentence = pending.slice(start, match.index + (mark?.length ?? 0)).trim()
      if (sentence) sentences.push(sentence)
      start = match.index + match[0].length
    }
    pending = pending.slice(start)
    return sentences
  }

  return {
    push(text) {
      pending += text
      return take()
    },
    flush() {
      const rest = pending.trim()
      pending = ''
      return rest ? [rest] : []
    }
  }
}

/**
 * A sentence as a voice should read it: what a model may write for the eye is removed. The speech contract
 * asks for plain spoken language already; this is for the times a model forgets.
 */
export function speakable(sentence: string): string {
  return sentence
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*[#>*-]+\s+/, '')
    .replace(/(\*\*|__|\*|_)(?=\S)([^*_]+?)(?<=\S)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim()
}
