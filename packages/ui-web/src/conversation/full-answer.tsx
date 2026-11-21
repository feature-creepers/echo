import type { Exchange, Persona } from '@repo/protocol'
import { Button } from '../primitives/button.tsx'
import { BackGlyph, CheckGlyph } from '../primitives/icons.tsx'
import { accentStyle } from '../styles/accent.ts'
import { Markdown } from '../view/blocks/markdown.tsx'
import { answerFileName } from './answer-file.ts'
import { useCopy } from './use-copy.ts'

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

interface FullAnswerProps {
  /** The line whose full answer is shown. Nothing when it is no longer in the conversation. */
  exchange: Exchange | undefined
  /** What it is about: the title of the thread that wrote it. */
  title: string | undefined
  persona: Persona | undefined
  onBack(): void
}

/**
 * The full answer a thread wrote, whole, in the side sheet: what it answers, who wrote it and when, and the answer
 * itself, read as the rest of the prose is. It can be copied as Markdown or saved as a Markdown file.
 */
export function FullAnswer({ exchange, title, persona, onBack }: FullAnswerProps) {
  const about = title ?? (exchange?.said || undefined)
  return (
    <div className="flex min-h-0 flex-1 flex-col" style={accentStyle(persona?.accent)}>
      <div className="grid grid-cols-1 gap-2 border-line border-b px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="-ml-1 flex w-fit items-center gap-1 px-1 py-0.5 text-text-faint text-xs transition-colors hover:text-text"
        >
          <BackGlyph /> Transcript
        </button>
        {exchange?.written !== undefined && (
          <div className="flex items-start justify-between gap-3">
            <div className="grid min-w-0 gap-1">
              <span className="line-clamp-2 font-medium text-[0.9375rem] leading-snug [overflow-wrap:anywhere]">{about ?? 'Full answer'}</span>
              <span className="text-label text-text-faint">
                {persona?.name ?? 'Assistant'} · <time dateTime={exchange.at}>{clock.format(new Date(exchange.at))}</time>
              </span>
            </div>
            <AnswerActions text={exchange.written} about={about} />
          </div>
        )}
      </div>
      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {exchange?.written === undefined ? (
          <p className="text-sm text-text-faint">This answer is no longer in the conversation.</p>
        ) : (
          <Markdown text={exchange.written} />
        )}
      </div>
    </div>
  )
}

interface AnswerActionsProps {
  /** The answer, in Markdown. */
  text: string
  /** What it is about, to name the file it is saved to. */
  about: string | undefined
}

/**
 * Copy an answer as Markdown, or save it as a Markdown file. Saving goes through a download, so the app shows
 * the system's own dialog to choose where.
 */
export function AnswerActions({ text, about }: AnswerActionsProps) {
  const { copied, copy } = useCopy(text)
  const save = () => {
    const url = URL.createObjectURL(new Blob([text.endsWith('\n') ? text : `${text}\n`], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = answerFileName(about)
    link.click()
    // The download has its own copy once it starts; the address is let go a little later.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  return (
    <div className="-mr-1 flex shrink-0 items-center gap-0.5">
      <Button kind="quiet" size="sm" onClick={copy} aria-live="polite" className="min-w-[4.25rem] [&_svg]:size-3.5">
        {copied === true ? (
          <>
            <CheckGlyph size={14} /> Copied
          </>
        ) : copied === false ? (
          'Not copied'
        ) : (
          'Copy'
        )}
      </Button>
      <Button kind="quiet" size="sm" onClick={save}>
        Export
      </Button>
    </div>
  )
}
