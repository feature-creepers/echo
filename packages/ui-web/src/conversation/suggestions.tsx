import { motion } from 'motion/react'

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
    <div className="flex max-w-2xl flex-wrap justify-center gap-2">
      {SUGGESTIONS.map((suggestion, index) => (
        <motion.button
          key={suggestion}
          type="button"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 + index * 0.06, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          onClick={() => onSay(suggestion)}
          className="rounded-full border border-line bg-surface/70 px-3.5 py-1.5 text-sm text-text-soft backdrop-blur-sm transition hover:border-accent/50 hover:text-text"
        >
          {suggestion}
        </motion.button>
      ))}
    </div>
  )
}
