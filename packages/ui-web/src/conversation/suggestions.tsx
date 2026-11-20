import { motion } from 'motion/react'
import { DURATION, EASE } from '../styles/motion.ts'

/**
 * What a first-time user can try, shown under the core while nothing has been said yet. They show the range
 * of the product in plain words; pressing one says it.
 */
const SUGGESTIONS = [
  'What is the weather this weekend?',
  'Plan a dinner for six, one of them vegetarian',
  'Write a letter asking my landlord to fix the heating',
  'Compare three cities I could move to'
]

export function Suggestions({ onSay }: { onSay(text: string): void }) {
  return (
    <div className="mt-3 flex max-w-[45rem] flex-wrap justify-center gap-1.5">
      {SUGGESTIONS.map((suggestion, index) => (
        <motion.button
          key={suggestion}
          type="button"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12 + index * 0.05, duration: DURATION.calm, ease: EASE }}
          onClick={() => onSay(suggestion)}
          className="h-7 rounded-md border border-line bg-surface/80 px-2.5 text-[0.8125rem] text-text-soft transition-colors duration-(--duration-quick) hover:border-line-strong hover:bg-raised hover:text-text"
        >
          {suggestion}
        </motion.button>
      ))}
    </div>
  )
}
