import type { EnginesState } from '@repo/client'
import type { CommandInput, PersonaId, Settings } from '@repo/protocol'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useEffect, useState } from 'react'
import type { DeviceSpeech } from '../audio/use-speech.ts'
import { VoiceSetup } from '../audio/voice-setup.tsx'
import { EngineRows } from '../conversation/engine-rows.tsx'
import { PersonasForm } from '../personas/personas-form.tsx'
import { Eye } from '../presence/eye.tsx'
import { Button } from '../primitives/button.tsx'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { Kbd } from '../primitives/kbd.tsx'
import { DURATION, EASE } from '../styles/motion.ts'

interface OnboardingProps {
  productName: string
  personas: Settings['personas']
  engines: EnginesState
  /** The device's speech. Left out, the device has none and the voice step is skipped. */
  speech?: DeviceSpeech | undefined
  setPersonas(choice: CommandInput<'personas.set'>): Promise<void>
  onPick(persona: PersonaId): void
  /** The person went through every step. */
  onDone(): void
}

const ALL_STEPS = ['welcome', 'personalities', 'voice', 'engine'] as const
type Step = (typeof ALL_STEPS)[number]

/**
 * First launch, one thing at a time: what this is, who the person will be talking to and what to call them,
 * and what the assistant thinks with.
 */
export function Onboarding({ productName, personas, engines, speech, setPersonas, onPick, onDone }: OnboardingProps) {
  const steps = ALL_STEPS.filter((name) => name !== 'voice' || speech !== undefined)
  // Someone who already named the personas, on this device or another, starts after that step.
  const [step, setStep] = useState<Step>(personas.confirmed ? 'engine' : 'welcome')
  const at = steps.indexOf(step)

  return (
    <div className="relative flex h-full flex-col">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-4 px-8 pt-7">
        <Eyebrow className="tabular-nums">
          Step {at + 1} of {steps.length}
        </Eyebrow>
        <div className="h-1.5 flex-1 shadow-[inset_0_-1px_0_var(--color-line-strong)]">
          <motion.div
            className="h-full origin-left bg-text"
            initial={false}
            animate={{ scaleX: (at + 1) / steps.length }}
            transition={{ duration: DURATION.slow, ease: EASE }}
          />
        </div>
      </div>

      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: { duration: DURATION.slow, ease: EASE } }}
            exit={{ opacity: 0, transition: { duration: DURATION.quick, ease: EASE } }}
            className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-8 py-10"
          >
            {step === 'welcome' && <Welcome productName={productName} onNext={() => setStep('personalities')} />}
            {step === 'personalities' && (
              <Section
                eyebrow="Personalities"
                title="Two ways to answer"
                lead="You call it by the name of the personality in use. Keep these names or type your own; you can change them later."
              >
                <PersonasForm
                  personas={personas.available}
                  active={personas.active}
                  submitLabel="Continue"
                  onPick={onPick}
                  onSubmit={async (choice) => {
                    await setPersonas(choice)
                    setStep(speech ? 'voice' : 'engine')
                  }}
                />
              </Section>
            )}
            {step === 'voice' && speech && (
              <Section
                eyebrow="Voice"
                title="Just talk"
                lead="To hear you and answer aloud, this computer runs its own speech models. Your voice never leaves it. The download happens once."
              >
                <VoiceSetup speech={speech} />
                <div className="mt-8 flex items-center gap-4">
                  <Button kind={speech.readiness?.ready ? 'primary' : 'secondary'} size="lg" onClick={() => setStep('engine')}>
                    {speech.readiness?.ready ? 'Continue' : speech.install.is === 'running' ? 'Continue while it downloads' : 'Later'}
                  </Button>
                </div>
              </Section>
            )}
            {step === 'engine' && (
              <Section
                eyebrow="Engine"
                title="What it thinks with"
                lead={`${productName} runs your own Claude Code or Codex, installed on this computer and signed in with your account through that program's own sign-in. ${productName} never sees, keeps or passes on your sign-in details, and adds no account of its own.`}
              >
                <EngineRows engines={engines} />
                <div className="mt-8 flex items-center gap-4">
                  <Button kind="primary" size="lg" onClick={onDone}>
                    Start
                  </Button>
                  <span className="text-text-soft text-xs">You can set this up later. Until one is ready, {productName} cannot answer.</span>
                </div>
              </Section>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

function Welcome({ productName, onNext }: { productName: string; onNext(): void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter') onNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onNext])

  return (
    <div className="flex flex-col items-center text-center">
      <Eye size={176} mood="idle" />
      <h1 className="display mt-8 text-[4rem] leading-[3.5rem]">{productName}</h1>
      <p className="mt-3 max-w-sm text-balance text-[0.9375rem] text-text-soft leading-relaxed">
        A personal assistant you talk to. It answers aloud, and shows the rest.
      </p>
      <div className="mt-8 flex items-center gap-2.5">
        <Button kind="primary" size="lg" onClick={onNext}>
          Begin
        </Button>
        <Kbd>↵</Kbd>
      </div>
    </div>
  )
}

function Section({ eyebrow, title, lead, children }: { eyebrow: string; title: string; lead: string; children: ReactNode }) {
  return (
    <section className="grid gap-7">
      <div className="grid max-w-2xl gap-2.5">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="display text-[2.5rem] leading-9">{title}</h1>
        <p className="text-[0.9375rem] text-text-soft leading-relaxed">{lead}</p>
      </div>
      <div>{children}</div>
    </section>
  )
}
