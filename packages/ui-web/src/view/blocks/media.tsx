import type { BlockProps } from '@repo/catalog'
import { SliderControl, SliderIndicator, Slider as SliderRoot, SliderThumb, SliderTrack } from '@ui-sdk/react/slider'
import { useEffect, useMemo, useState } from 'react'
import type { MediaSource } from '../../media/player.ts'
import { usePlayer, usePlayerState, useVideoSurface } from '../../media/player-provider.tsx'
import { Button } from '../../primitives/button.tsx'
import { cn } from '../../primitives/cn.ts'
import { PauseGlyph, PlayGlyph, VolumeGlyph } from '../../primitives/icons.tsx'
import { useViewActions } from '../context.ts'

/** Minutes and seconds, or hours too: 3:07, 1:02:45. */
function duration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  const [hours, minutes, rest] = [Math.floor(whole / 3600), Math.floor((whole % 3600) / 60), whole % 60]
  const two = (value: number) => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${two(minutes)}:${two(rest)}` : `${minutes}:${two(rest)}`
}

/** Sound or video, played by the app's one player. Several blocks may show the same source: they all show its state. */
export function Media({ props }: { props: BlockProps<'Media'> }) {
  const player = usePlayer()
  const state = usePlayerState()
  const { autoplay } = useViewActions()
  const source = useMemo<MediaSource>(
    () => ({ url: props.url, kind: props.kind, title: props.title, subtitle: props.subtitle, artwork: props.artwork, live: props.live }),
    [props.url, props.kind, props.title, props.subtitle, props.artwork, props.live]
  )
  const held = state.source?.url === props.url
  const status = held ? state.status : 'idle'
  const going = status === 'playing' || status === 'loading'
  const sounding = status === 'playing' && !state.buffering
  const surface = useVideoSurface(source, held)

  // Shown because the person asked to play it: it starts as it appears, once.
  useEffect(() => {
    if (autoplay) player.autoplay(autoplay, source)
  }, [autoplay, player, source])

  const label =
    status === 'failed' ? 'Unavailable' : going && (state.buffering || status === 'loading') ? 'Tuning in' : going ? 'Playing' : held ? 'Paused' : 'Ready'

  return (
    <div className="@container grid min-w-[min(15rem,100%)] gap-2.5">
      {props.kind === 'video' && (
        <div className="relative aspect-video w-full overflow-hidden bg-black">
          {/* While this source plays, the player's element is drawn here; otherwise its picture, if any. */}
          <div ref={surface} className="absolute inset-0" />
          {!held && props.artwork && (
            <img src={props.artwork} alt="" referrerPolicy="no-referrer" className="absolute inset-0 size-full object-cover opacity-60" />
          )}
          {!going && (
            <button
              type="button"
              aria-label={`Play ${props.title}`}
              onClick={() => player.play(source)}
              className="absolute inset-0 m-auto flex size-11 items-center justify-center bg-text text-ground transition-colors duration-(--duration-quick) ease-soft hover:bg-text/85 [&_svg]:size-5"
            >
              <PlayGlyph />
            </button>
          )}
        </div>
      )}

      <div className="flex min-w-0 items-center gap-3">
        <Artwork url={props.artwork} sounding={sounding} />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <div className="flex items-center gap-1.5">
            {props.live && <Live on={sounding} />}
            <span className={cn('caps', status === 'failed' ? 'text-danger' : going ? 'text-accent' : 'text-text-soft')}>{label}</span>
          </div>
          <p className="truncate font-medium text-[0.8125rem] leading-snug">{props.title}</p>
          {props.subtitle && <p className="truncate text-text-soft text-xs">{props.subtitle}</p>}
        </div>
        <button
          type="button"
          aria-label={going ? `Pause ${props.title}` : `Play ${props.title}`}
          onClick={() => player.toggle(source)}
          // Playing, it is a line to pause; else a plane of the ink, the one thing to press.
          className={cn(
            'flex size-9 shrink-0 items-center justify-center transition-colors duration-(--duration-quick) ease-soft [&_svg]:size-4',
            going
              ? 'text-text shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-text/[0.08] active:bg-text/[0.14]'
              : 'bg-text text-ground hover:bg-text/85 active:bg-text/70'
          )}
        >
          {going ? <PauseGlyph /> : <PlayGlyph />}
        </button>
      </div>

      {held && !props.live && state.duration !== undefined && (
        <div className="caps flex items-center gap-2.5 text-text-soft tabular-nums">
          <span>{duration(state.position)}</span>
          <Slider
            label="Position"
            value={state.duration > 0 ? state.position / state.duration : 0}
            onChange={(at) => player.seek(at * (state.duration ?? 0))}
          />
          <span>{duration(state.duration)}</span>
        </div>
      )}

      {status === 'failed' ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-line border-t pt-2">
          <p className="flex items-center gap-2 text-danger text-xs">
            <span aria-hidden="true" className="size-2 shrink-0 bg-danger" />
            {state.problem}
          </p>
          <Button size="sm" kind="quiet" onClick={() => player.play(source)}>
            Try again
          </Button>
        </div>
      ) : (
        held && (
          <div className="hidden items-center gap-2.5 @[16rem]:flex">
            <button
              type="button"
              aria-label={state.muted ? 'Unmute' : 'Mute'}
              onClick={() => player.setMuted(!state.muted)}
              className="text-text-faint transition-colors hover:text-text [&_svg]:size-3.5"
            >
              <VolumeGlyph muted={state.muted || state.volume === 0} />
            </button>
            <Slider label="Volume" value={state.muted ? 0 : state.volume} onChange={(volume) => player.setVolume(volume)} className="max-w-32" />
            {state.ducked && <span className="caps truncate text-text-faint">Lowered while speaking</span>}
          </div>
        )
      )}

      {held && state.queue.length > 0 && (
        <div className="flex items-center justify-between gap-2 border-line border-t pt-2 text-xs">
          <p className="min-w-0 truncate text-text-faint">
            <span className="caps mr-1.5">Next</span>
            <span className="text-text-soft">{state.queue[0]?.title}</span>
            {state.queue.length > 1 && ` and ${state.queue.length - 1} more`}
          </p>
          <Button size="sm" kind="quiet" className="shrink-0" onClick={() => player.next()}>
            Skip
          </Button>
        </div>
      )}
    </div>
  )
}

/** The picture of what plays, or, with none, a square of the ink's wash whose bars, in the accent, move with the sound. */
function Artwork({ url, sounding }: { url: string | undefined; sounding: boolean }) {
  const [broken, setBroken] = useState(false)
  if (url && !broken) {
    return <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-11 shrink-0 object-cover" />
  }
  return (
    <div className="flex size-11 shrink-0 items-end justify-center gap-[2px] overflow-hidden bg-text/[0.06] pb-3">
      {[0.5, 0.85, 0.65, 1, 0.55].map((height, index) => (
        <span
          key={index}
          className={cn('w-[2px] origin-bottom bg-accent', sounding && 'animate-level')}
          style={{ height: `${height * 40}%`, animationDelay: `${index * -0.23}s`, opacity: sounding ? 1 : 0.45 }}
        />
      ))}
    </div>
  )
}

/** "Live", after a square in the accent while it is heard. */
function Live({ on }: { on: boolean }) {
  return (
    <span className={cn('caps flex items-center gap-1.5', on ? 'text-accent' : 'text-text-faint')}>
      <span className="size-2 bg-current" />
      Live
    </span>
  )
}

/**
 * A square track to set a level or a position, from 0 to 1, by the pointer or the arrow keys: the ink fills it from
 * the start over a hairline base, and its square knob shows under the pointer.
 */
function Slider({ label, value, onChange, className }: { label: string; value: number; onChange(value: number): void; className?: string }) {
  return (
    <SliderRoot<number> value={value} onValueChange={onChange} min={0} max={1} step={0.01} className={cn('group relative min-w-0 flex-1', className)}>
      <SliderControl className="flex h-4 cursor-pointer items-center">
        <SliderTrack className="h-1.5 w-full shadow-[inset_0_-1px_0_var(--color-line-strong)]">
          <SliderIndicator className="bg-text" />
          <SliderThumb
            aria-label={label}
            className="pointer-events-none size-2.5 bg-text opacity-0 transition-opacity duration-(--duration-quick) ease-soft group-hover:opacity-100"
          />
        </SliderTrack>
      </SliderControl>
    </SliderRoot>
  )
}
