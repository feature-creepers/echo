import { useActions } from '@json-render/react'
import { type Answer, answered, answerWords, type BlockProps, sentOnPick } from '@repo/catalog'
import { FieldControl, FieldLabel, Field as FieldRoot } from '@ui-sdk/react/field'
import { Listbox, ListboxItem } from '@ui-sdk/react/listbox'
import { type FormEvent, type KeyboardEvent, useId, useState } from 'react'
import { Button as AppButton } from '../../primitives/button.tsx'
import { cn } from '../../primitives/cn.ts'
import { Eyebrow } from '../../primitives/eyebrow.tsx'
import { Kbd } from '../../primitives/kbd.tsx'

/** A line to type in, 28 px high: a line round a plane, in the full ink while it has the keyboard. */
const TYPED =
  'h-7 min-w-0 border border-line-strong bg-surface px-3 text-[0.8125rem] transition-colors duration-(--duration-quick) ease-soft placeholder:text-text-faint focus-visible:border-text focus-visible:outline-none disabled:opacity-45'

/** Say something to the assistant on the person's behalf, through the renderer's actions. */
function useSay() {
  const { execute } = useActions()
  return (text: string) => void execute({ action: 'say', params: { text } }).catch(() => undefined)
}

/** A button that says its words to the assistant at each press. */
export function Button({ props }: { props: BlockProps<'Button'> }) {
  const say = useSay()
  return (
    <AppButton kind={props.emphasis === 'primary' ? 'primary' : 'secondary'} size="sm" className="w-fit" onClick={() => say(props.say)}>
      {props.label}
    </AppButton>
  )
}

type Question = BlockProps<'Questions'>['questions'][number]

/**
 * Questions to answer by picking (docs/SPEC.md, section 9.5): each a list the arrow keys, typing and an answer's
 * number move through, with a line to type another answer. One question with one answer to pick is sent as soon as it
 * is picked; otherwise Send sends every answer at once, once each question has one. Answered, it stays as it was
 * answered.
 */
export function Questions({ props }: { props: BlockProps<'Questions'> }) {
  const say = useSay()
  const { questions } = props
  const [answers, setAnswers] = useState<Answer[]>(() => questions.map(() => ({ picked: [], typed: '' })))
  const [sent, setSent] = useState(false)
  const onPick = sentOnPick(questions)
  const ready = questions.every((_, index) => answered(answers[index]))

  const send = (given: readonly Answer[]) => {
    if (sent) return
    setSent(true)
    say(answerWords(questions, given))
  }
  const change = (index: number, answer: Answer, picked: boolean) => {
    const next = answers.map((one, at) => (at === index ? answer : one))
    setAnswers(next)
    if (onPick && picked && answer.picked.length > 0) send(next)
  }
  // Picking sends at once; words typed instead still need Send.
  const sendable = !onPick || (answers[0]?.typed.trim() ?? '') !== ''

  return (
    <form
      className="grid"
      onSubmit={(event) => {
        event.preventDefault()
        if (ready) send(answers)
      }}
    >
      {questions.map((question, index) => (
        <QuestionAnswers
          key={index}
          question={question}
          answer={answers[index] ?? { picked: [], typed: '' }}
          sent={sent}
          onChange={(answer, picked) => change(index, answer, picked)}
        />
      ))}
      {(sendable || sent) && (
        <div className="flex h-[3.25rem] items-center justify-end gap-3 border-line border-t">
          <AppButton type="submit" kind="primary" disabled={sent || !ready}>
            {sent ? 'Sent' : 'Send'}
          </AppButton>
          {!sent && <Kbd>↵</Kbd>}
        </div>
      )}
    </form>
  )
}

/**
 * One question: its answers to pick, one to a row under a rule of the ink, the advised one marked, and a line to type
 * another. Each row says the number that picks it.
 */
function QuestionAnswers({
  question,
  answer,
  sent,
  onChange
}: {
  question: Question
  answer: Answer
  sent: boolean
  onChange(answer: Answer, picked: boolean): void
}) {
  const id = useId()
  const several = question.multiple === true
  const pick = (value: string | readonly string[] | null) => {
    const picked = (value === null ? [] : typeof value === 'string' ? [value] : value).map(Number)
    // One answer to pick: a pick replaces what was typed. Several: what was typed is one more.
    onChange({ picked, typed: several ? answer.typed : '' }, true)
  }
  // An answer's number picks it, or with several to pick, picks it or puts it back.
  const pickByNumber = (event: KeyboardEvent) => {
    if (sent || event.ctrlKey || event.metaKey || event.altKey) return
    const place = Number(event.key) - 1
    if (!Number.isInteger(place) || place < 0 || place >= question.options.length) return
    event.preventDefault()
    if (!several) return pick(String(place))
    const picked = answer.picked.includes(place) ? answer.picked.filter((one) => one !== place) : [...answer.picked, place]
    pick(picked.map(String))
  }
  const items = question.options.map((option, place) => {
    const chosen = answer.picked.includes(place)
    return (
      <ListboxItem
        key={place}
        value={String(place)}
        label={option.label}
        className={(state) =>
          cn(
            'flex min-h-11 items-center gap-3 border-line border-t py-2 text-left transition-colors duration-(--duration-quick) ease-soft first:border-text first:border-t-2',
            chosen ? 'text-text' : 'text-text-soft',
            sent ? !chosen && 'opacity-45' : 'cursor-pointer hover:bg-text/[0.06] hover:text-text',
            state.highlighted && !sent && 'bg-text/[0.06]'
          )
        }
      >
        {/* The same square for one answer or several: a line, filled with the ink once chosen. */}
        <span aria-hidden="true" className={cn('size-3.5 shrink-0', chosen ? 'bg-text' : 'shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]')} />
        <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
          <span className="flex flex-wrap items-baseline gap-x-2.5 text-base leading-6">
            {option.label}
            {option.recommended && <span className="caps text-warn">Recommended</span>}
          </span>
          {option.detail && <span className="text-pretty text-[0.8125rem] text-text-faint leading-snug">{option.detail}</span>}
        </span>
        {!sent && place < 9 && (
          <span aria-hidden="true" className="shrink-0">
            <Kbd>{place + 1}</Kbd>
          </span>
        )}
      </ListboxItem>
    )
  })
  const named = question.question ? { 'aria-labelledby': `${id}-question` } : { 'aria-label': 'Answers' }
  return (
    <div className="grid not-first:mt-5">
      {question.question && (
        <p id={`${id}-question`} className="mb-2 font-medium text-[0.8125rem]">
          {question.question}
        </p>
      )}
      {several ? (
        <Listbox
          multiple
          activation="manual"
          {...named}
          value={answer.picked.map(String)}
          readOnly={sent}
          onValueChange={pick}
          onKeyDown={pickByNumber}
          className="grid"
        >
          {items}
        </Listbox>
      ) : (
        <Listbox
          activation="manual"
          {...named}
          value={answer.picked[0] === undefined ? null : String(answer.picked[0])}
          readOnly={sent}
          onValueChange={pick}
          onKeyDown={pickByNumber}
          className="grid"
        >
          {items}
        </Listbox>
      )}
      {question.other !== false && (
        <div className="border-line border-t py-2">
          <input
            type="text"
            aria-label={question.question ? `Another answer to: ${question.question}` : 'Another answer'}
            placeholder="Other answer…"
            value={answer.typed}
            disabled={sent}
            autoComplete="off"
            onChange={(event) => onChange({ picked: several ? answer.picked : [], typed: event.target.value }, false)}
            className={cn(TYPED, 'w-full')}
          />
        </div>
      )}
    </div>
  )
}

/** A line to type an answer in, sent once; its label names its input, and pressing it puts the cursor there. */
export function Field({ props }: { props: BlockProps<'Field'> }) {
  const say = useSay()
  const [value, setValue] = useState('')
  const [sent, setSent] = useState(false)
  const send = (event: FormEvent) => {
    event.preventDefault()
    if (value.trim() === '') return
    say(`${props.say} ${value.trim()}`)
    setSent(true)
  }
  return (
    <form onSubmit={send}>
      <FieldRoot className="grid gap-1.5">
        <FieldLabel>
          <Eyebrow>{props.label}</Eyebrow>
        </FieldLabel>
        <div className="flex items-center gap-2">
          <FieldControl
            value={value}
            disabled={sent}
            onChange={(event) => setValue(event.target.value)}
            placeholder={props.placeholder}
            className={cn(TYPED, 'flex-1')}
          />
          <AppButton type="submit" kind="primary" disabled={sent || value.trim() === ''}>
            {sent ? 'Sent' : 'Send'}
          </AppButton>
        </div>
      </FieldRoot>
    </form>
  )
}
