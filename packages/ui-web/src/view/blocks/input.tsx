import { useActions } from '@json-render/react'
import { type Answer, answered, answerWords, type BlockProps, sentOnPick } from '@repo/catalog'
import { FieldControl, FieldLabel, Field as FieldRoot } from '@ui-sdk/react/field'
import { Listbox, ListboxItem } from '@ui-sdk/react/listbox'
import { type FormEvent, useId, useState } from 'react'
import { Button as AppButton } from '../../primitives/button.tsx'
import { cn } from '../../primitives/cn.ts'
import { Eyebrow } from '../../primitives/eyebrow.tsx'

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
 * Questions to answer by picking (docs/SPEC.md, section 9.6): each a list the arrow keys and typing move through, with
 * a line to type another answer. One question with one answer to pick is sent as soon as it is picked; otherwise Send
 * sends every answer at once, once each question has one. Answered, it stays as it was answered.
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
      className="grid gap-4"
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
        <AppButton type="submit" kind="primary" size="sm" className="w-fit" disabled={sent || !ready}>
          {sent ? 'Sent' : 'Send'}
        </AppButton>
      )}
    </form>
  )
}

/** One question: its answers to pick, the advised one marked, and a line to type another. */
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
  const items = question.options.map((option, place) => {
    const chosen = answer.picked.includes(place)
    return (
      <ListboxItem
        key={place}
        value={String(place)}
        label={option.label}
        className={cn(
          'flex items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-colors duration-(--duration-quick) ease-soft',
          chosen
            ? 'border-accent/60 bg-accent/10'
            : sent
              ? 'border-line bg-white/[0.018] opacity-45'
              : 'cursor-pointer border-line bg-white/[0.018] hover:border-line-strong hover:bg-white/[0.04]'
        )}
      >
        <span
          aria-hidden="true"
          className={cn('mt-0.5 size-3.5 shrink-0 border', several ? 'rounded-xs' : 'rounded-full', chosen ? 'border-accent bg-accent' : 'border-line-strong')}
        />
        <span className="grid min-w-0 gap-0.5">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
            {option.label}
            {option.recommended && <span className="rounded-xs bg-accent/15 px-1.5 text-[0.6875rem] text-accent">Recommended</span>}
          </span>
          {option.detail && <span className="text-text-soft text-xs">{option.detail}</span>}
        </span>
      </ListboxItem>
    )
  })
  const named = question.question ? { 'aria-labelledby': `${id}-question` } : { 'aria-label': 'Answers' }
  return (
    <div className="grid gap-2">
      {question.question && (
        <p id={`${id}-question`} className="font-medium text-sm">
          {question.question}
        </p>
      )}
      {several ? (
        <Listbox multiple activation="manual" {...named} value={answer.picked.map(String)} readOnly={sent} onValueChange={pick} className="grid gap-1">
          {items}
        </Listbox>
      ) : (
        <Listbox
          activation="manual"
          {...named}
          value={answer.picked[0] === undefined ? null : String(answer.picked[0])}
          readOnly={sent}
          onValueChange={pick}
          className="grid gap-1"
        >
          {items}
        </Listbox>
      )}
      {question.other !== false && (
        <input
          type="text"
          aria-label={question.question ? `Another answer to: ${question.question}` : 'Another answer'}
          placeholder="Other answer…"
          value={answer.typed}
          disabled={sent}
          autoComplete="off"
          onChange={(event) => onChange({ picked: several ? answer.picked : [], typed: event.target.value }, false)}
          className="h-8 min-w-0 rounded-md border border-line-strong bg-black/25 shadow-[inset_0_1px_1px_rgb(0_0_0/0.25)] px-2.5 text-sm transition-colors duration-(--duration-quick) placeholder:text-text-faint disabled:opacity-60"
        />
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
      <FieldRoot className="grid gap-1">
        <FieldLabel>
          <Eyebrow>{props.label}</Eyebrow>
        </FieldLabel>
        <div className="flex gap-1.5">
          <FieldControl
            value={value}
            disabled={sent}
            onChange={(event) => setValue(event.target.value)}
            placeholder={props.placeholder}
            className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-black/25 shadow-[inset_0_1px_1px_rgb(0_0_0/0.25)] px-2.5 text-sm transition-colors duration-(--duration-quick) placeholder:text-text-faint disabled:opacity-60"
          />
          <AppButton type="submit" kind="primary" disabled={sent || value.trim() === ''}>
            {sent ? 'Sent' : 'Send'}
          </AppButton>
        </div>
      </FieldRoot>
    </form>
  )
}
