/**
 * A model set: the files one engine needs, downloaded once and kept in a model folder: the device's for speech, the
 * core's for the memory's embeddings. The catalogue lists the sets that exist; an engine asks for one by its identifier.
 */
export interface ModelFile {
  /** Where the file goes inside the set's folder. */
  path: string
  /** Where it is downloaded from. */
  url: string
  /** Its size in bytes, to report progress and to tell a whole file from a partial one. */
  bytes: number
  /** Its SHA-256, in hexadecimal, checked after download. */
  sha256: string
}

/** A licence models are published under, and what it asks of the person who downloads one. */
export interface Licence {
  /** Its short name: "CC BY 4.0". */
  name: string
  /** Where its full text is. */
  url: string
  /** What it asks, in a sentence for the person, to follow the licence's name. */
  asks: string
  /** The uses it forbids, in its own words, when it forbids any. */
  restrictions?: { lead: string; uses: readonly string[] }
}

export interface ModelSet {
  /** Identifies the set, and names its folder. */
  id: string
  /** What it is for. */
  purpose: 'recognition' | 'voice' | 'speech-detection' | 'embedding'
  /** What the user reads while it downloads. */
  name: string
  /** The model as its makers publish it: the credit its licence asks for, with `changes` and `source`. */
  model: {
    name: string
    maker: string
    /** The makers' page for it. */
    page: string
    /** Their copyright notice, as they wrote it, when they give one. */
    copyright?: string
  }
  /** The licence its files are published under. */
  licence: Licence
  /** How these files differ from the makers' own, which the licences ask to be said. Left out, they are the makers' own. */
  changes?: string
  /** Where the files come from: their repository, at the commit they are fetched from. */
  source: string
  files: ModelFile[]
}

/** A set the speech engines need. */
export type SpeechSet = ModelSet & { purpose: 'recognition' | 'voice' | 'speech-detection' }

/** How far a download has got. */
export interface DownloadProgress {
  set: string
  /** Bytes on disk so far, over all the files of the set. */
  received: number
  total: number
}
