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

export interface ModelSet {
  /** Identifies the set, and names its folder. */
  id: string
  /** What it is for. */
  purpose: 'recognition' | 'voice' | 'speech-detection' | 'embedding'
  /** What the user reads while it downloads. */
  name: string
  /** The licence its files are published under. */
  licence: string
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
