import { AnimatePresence, motion } from 'motion/react'
import { cn } from '../primitives/cn.ts'
import { CloseGlyph, PauseGlyph, PlayGlyph } from '../primitives/icons.tsx'
import { EASE } from '../styles/motion.ts'
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
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.22, ease: EASE }}
          className="no-drag mr-1.5 flex h-6 max-w-80 items-center gap-2 rounded-md bg-white/[0.06] pr-0.5 pl-2 shadow-[inset_0_0_0_0.5px_rgb(255_255_255/0.08)]"
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
          <span className="min-w-0 truncate text-[0.6875rem]">
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
            className="flex size-5 shrink-0 items-center justify-center rounded-sm text-text-soft transition-colors hover:bg-white/[0.06] hover:text-text [&_svg]:size-3"
          >
            {going ? <PauseGlyph /> : <PlayGlyph />}
          </button>
          <button
            type="button"
            aria-label="Stop"
            onClick={() => player.stop()}
            className="flex size-5 shrink-0 items-center justify-center rounded-sm text-text-faint transition-colors hover:bg-white/[0.06] hover:text-text [&_svg]:size-3"
          >
            <CloseGlyph />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
