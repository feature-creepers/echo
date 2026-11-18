/**
 * SHA-256 of a text, as lowercase hexadecimal (FIPS 180-4). The core is pure and reaches no library of the system,
 * so the activity's chain (docs/SPEC.md, section 12.2, the signed log) hashes with this one. It reads the text as
 * UTF-8, and is quick enough for records of a few kilobytes, which is all it is given.
 */

const ROUND = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74,
  0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d,
  0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e,
  0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
])

const START = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]

const rotate = (value: number, by: number) => (value >>> by) | (value << (32 - by))

export function sha256(text: string): string {
  const bytes = new TextEncoder().encode(text)
  // The message, a 1 bit, zeros, and its length in bits on the last 8 bytes, to a whole number of 64-byte blocks.
  const length = Math.ceil((bytes.length + 9) / 64) * 64
  const padded = new Uint8Array(length)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  const bits = bytes.length * 8
  view.setUint32(length - 8, Math.floor(bits / 0x1_0000_0000))
  view.setUint32(length - 4, bits >>> 0)

  const state = [...START]
  const words = new Uint32Array(64)
  for (let block = 0; block < length; block += 64) {
    for (let index = 0; index < 16; index++) words[index] = view.getUint32(block + index * 4)
    for (let index = 16; index < 64; index++) {
      const early = words[index - 15] as number
      const late = words[index - 2] as number
      const small0 = rotate(early, 7) ^ rotate(early, 18) ^ (early >>> 3)
      const small1 = rotate(late, 17) ^ rotate(late, 19) ^ (late >>> 10)
      words[index] = ((words[index - 16] as number) + small0 + (words[index - 7] as number) + small1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = state as [number, number, number, number, number, number, number, number]
    for (let index = 0; index < 64; index++) {
      const big1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)
      const choose = (e & f) ^ (~e & g)
      const first = (h + big1 + choose + (ROUND[index] as number) + (words[index] as number)) >>> 0
      const big0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const second = (big0 + majority) >>> 0
      h = g
      g = f
      f = e
      e = (d + first) >>> 0
      d = c
      c = b
      b = a
      a = (first + second) >>> 0
    }
    const next = [a, b, c, d, e, f, g, h]
    for (let index = 0; index < 8; index++) state[index] = ((state[index] as number) + (next[index] as number)) >>> 0
  }
  return state.map((word) => word.toString(16).padStart(8, '0')).join('')
}
