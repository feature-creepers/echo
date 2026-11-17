import { AnimatePresence, motion } from 'motion/react'
import { cn } from '../primitives/cn.ts'
import { CloseGlyph, PauseGlyph, PlayGlyph } from '../primitives/icons.tsx'
import { usePlayer, usePlayerState } from './player-provider.tsx'

/**
 * What plays, in the title row, whatever is on screen: the views that started it may be long gone. It stays
 * small: a level that moves with the sound, the title, play or pause, and stop.
 */
export function NowPlaying() {
  const player = usePlayer()
  const state = usePlayerState()
  const { source, status } = state
  const going = status === 'playing' || status === 'loading'
  const sounding = status === 'playing' && !state.buffering

  return (
    <AnimatePresence initial={false}>
      {source && (
        <motion.div
          key="now-playing"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="no-drag mr-2 flex h-7 max-w-80 items-center gap-2 rounded-full border border-line-strong bg-raised/80 pr-1 pl-3 backdrop-blur-md"
          aria-label="Now playing"
          role="group"
        >
          <span className="flex h-3 items-end gap-[2px]" aria-hidden="true">
            {[0.55, 1, 0.7].map((height, index) => (
              <span
                key={index}
                className={cn('w-[2px] origin-bottom rounded-full', status === 'failed' ? 'bg-danger' : 'bg-accent', sounding && 'animate-level')}
                style={{ height: `${height * 100}%`, animationDelay: `${index * -0.31}s`, opacity: sounding ? 1 : 0.5 }}
              />
            ))}
          </span>
          <span className="min-w-0 truncate text-xs">
            <span className="text-text">{source.title}</span>
            {status === 'failed' ? (
              <span className="text-danger"> · unavailable</span>
            ) : source.subtitle ? (
              <span className="text-text-faint"> · {source.subtitle}</span>
            ) : null}
          </span>
          <button
            type="button"
            aria-label={going ? 'Pause' : 'Play'}
            onClick={() => player.toggle(source)}
            className="flex size-5 shrink-0 items-center justify-center rounded-full text-text-soft transition hover:bg-overlay hover:text-text [&_svg]:size-3.5"
          >
            {going ? <PauseGlyph /> : <PlayGlyph />}
          </button>
          <button
            type="button"
            aria-label="Stop"
            onClick={() => player.stop()}
            className="flex size-5 shrink-0 items-center justify-center rounded-full text-text-faint transition hover:bg-overlay hover:text-text [&_svg]:size-3"
          >
            <CloseGlyph />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
