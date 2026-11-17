/**
 * Text to bytes and back: part of every JavaScript runtime the core runs in (Node, browsers, the phone's
 * engine), though not of the language itself, so the compiler is told about the little the core uses.
 */
declare global {
  class TextEncoder {
    encode(text: string): Uint8Array
  }

  class TextDecoder {
    decode(bytes: Uint8Array): string
  }
}

export {}
