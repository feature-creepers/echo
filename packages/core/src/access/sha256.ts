import { sha256 as digest } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

/**
 * SHA-256 of a text read as UTF-8, as lowercase hexadecimal: what the activity's chain hashes with (docs/SPEC.md,
 * section 12.2, the signed log). @noble/hashes is audited and pure JavaScript, so the core stays free of any system API.
 */
export const sha256 = (text: string): string => bytesToHex(digest(utf8ToBytes(text)))
