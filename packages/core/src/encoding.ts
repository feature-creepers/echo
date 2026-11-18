/**
 * Text to bytes and back: part of every JavaScript runtime the core runs in (Node, browsers, the phone's
 * engine), though not of the language itself, so the compiler is told about the little the core uses.
 */
declare global {
  class TextEncoder {
    encode(text: string): Uint8Array
  }

  class TextDecoder {
    /** `fatal` throws on bytes that are not of the encoding, instead of putting a replacement character in. */
    constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean })
    decode(bytes: Uint8Array): string
  }
}

export {}
