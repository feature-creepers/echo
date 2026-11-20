import type { MailAddress, MailAttachment } from '@repo/core'
import { convert } from 'html-to-text'
import { z } from 'zod'

/**
 * A Gmail message's parts, as `users.messages.get` gives them in its `full` format: a tree of MIME parts, each with
 * its headers and its content in base64url, in the part's own character set. Attachments carry a file name and are
 * never downloaded: they are listed by name, kind and size.
 */

export interface GmailPart {
  mimeType?: string | undefined
  filename?: string | undefined
  headers?: { name: string; value: string }[] | undefined
  body?: { size?: number | undefined; data?: string | undefined } | undefined
  parts?: GmailPart[] | undefined
}

export const gmailPartSchema: z.ZodType<GmailPart> = z.lazy(() =>
  z.object({
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    headers: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
    body: z.object({ size: z.number().optional(), data: z.string().optional() }).optional(),
    parts: z.array(gmailPartSchema).optional()
  })
)

/** A header of a part, by name, case set aside. */
export const headerOf = (part: GmailPart, name: string) => part.headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value

/** A part's content as text, in the character set its Content-Type names; UTF-8 when it names none the platform knows. */
function decoded(part: GmailPart): string {
  const bytes = Buffer.from(part.body?.data ?? '', 'base64url')
  const charset = /charset="?([^";\s]+)"?/i.exec(headerOf(part, 'Content-Type') ?? '')?.[1] ?? 'utf-8'
  try {
    return new TextDecoder(charset).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

/** Addresses as a header lists them: "Ada Lovelace <ada@example.com>, bob@example.com". */
export function addressesOf(header: string): MailAddress[] {
  const pieces: string[] = []
  let piece = ''
  let quoting = false
  let bracketed = false
  for (const character of header) {
    if (character === '"') quoting = !quoting
    else if (character === '<') bracketed = true
    else if (character === '>') bracketed = false
    if (character === ',' && !quoting && !bracketed) {
      pieces.push(piece)
      piece = ''
    } else piece += character
  }
  pieces.push(piece)
  return pieces.flatMap((one) => {
    const text = one.trim()
    if (!text) return []
    const named = /^(.*?)\s*<([^>]*)>$/.exec(text)
    if (!named) return [{ address: text }]
    const name = (named[1] ?? '').replace(/^"|"$/g, '').trim()
    return [{ address: (named[2] ?? '').trim(), ...(name ? { name } : {}) }]
  })
}

/** Text Gmail gives with its HTML entities, such as a snippet, as plain text. */
export const plainText = (html: string) => convert(html, { wordwrap: false })

/** HTML as plain text: links by their words, no pictures. */
const textOfHtml = (html: string) =>
  convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' }
    ]
  })

/** Whether a part is a file the mail carries rather than its text. */
const isAttachment = (part: GmailPart) => Boolean(part.filename) || /^\s*attachment/i.test(headerOf(part, 'Content-Disposition') ?? '')

/** The text of a part and of the parts in it, in reading order: of alternatives, the plain one when there is one. */
function textsOf(part: GmailPart): string[] {
  if (isAttachment(part)) return []
  const kind = (part.mimeType ?? '').toLowerCase()
  if (kind === 'text/plain') return [decoded(part)]
  if (kind === 'text/html') return [textOfHtml(decoded(part))]
  const children = part.parts ?? []
  if (kind === 'multipart/alternative') {
    const plain = children.find((child) => child.mimeType?.toLowerCase() === 'text/plain' && !isAttachment(child))
    const best = plain ?? children.findLast((child) => textsOf(child).length > 0)
    return best ? textsOf(best) : []
  }
  return children.flatMap(textsOf)
}

/** The files a part and the parts in it carry. */
function attachmentsOf(part: GmailPart): MailAttachment[] {
  if (isAttachment(part))
    return [{ name: part.filename || 'unnamed', kind: (part.mimeType ?? 'application/octet-stream').toLowerCase(), size: part.body?.size ?? 0 }]
  return (part.parts ?? []).flatMap(attachmentsOf)
}

/** A Gmail message's text and the files it carries. */
export function gmailContent(payload: GmailPart): { text: string; attachments: MailAttachment[] } {
  return {
    text: textsOf(payload)
      .map((text) => text.replace(/\r\n/g, '\n').trim())
      .filter(Boolean)
      .join('\n\n'),
    attachments: attachmentsOf(payload)
  }
}
