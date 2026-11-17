import type { BlockProps } from '@repo/catalog'
import { useEffect, useMemo, useState } from 'react'
import type { MediaSource } from '../../media/player.ts'
import { usePlayer, usePlayerState, useVideoSurface } from '../../media/player-provider.tsx'
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
    <div className="@container grid min-w-[min(18rem,100%)] gap-4 rounded-lg border border-line bg-surface/70 p-4 backdrop-blur-sm">
      {props.kind === 'video' && (
        <div className="relative aspect-video w-full overflow-hidden rounded-md border border-line bg-black">
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
              className="absolute inset-0 m-auto flex size-16 items-center justify-center rounded-full bg-accent text-accent-ink shadow-[0_0_40px_-6px_var(--accent)] transition hover:brightness-110 [&_svg]:size-6"
            >
              <PlayGlyph />
            </button>
          )}
        </div>
      )}

      <div className="flex min-w-0 items-center gap-4">
        <Artwork url={props.artwork} sounding={sounding} />
        <div className="grid min-w-0 flex-1 gap-1">
          <div className="flex items-center gap-2">
            {props.live && <Live on={sounding} />}
            <span className={cn('font-mono text-label uppercase', status === 'failed' ? 'text-danger' : going ? 'text-accent' : 'text-text-faint')}>
              {label}
            </span>
          </div>
          <p className="truncate font-medium text-[1.0625rem] leading-snug">{props.title}</p>
          {props.subtitle && <p className="truncate text-sm text-text-soft">{props.subtitle}</p>}
        </div>
        <button
          type="button"
          aria-label={going ? `Pause ${props.title}` : `Play ${props.title}`}
          onClick={() => player.toggle(source)}
          className={cn(
            'flex size-12 shrink-0 items-center justify-center rounded-full transition duration-150 ease-soft active:scale-95 [&_svg]:size-5',
            going
              ? 'border border-line-strong bg-raised text-text hover:bg-overlay'
              : 'bg-accent text-accent-ink shadow-[0_0_28px_-6px_var(--accent)] hover:brightness-110'
          )}
        >
          {going ? <PauseGlyph /> : <PlayGlyph />}
        </button>
      </div>

      {held && !props.live && state.duration !== undefined && (
        <div className="flex items-center gap-3 font-mono text-[0.6875rem] text-text-faint tabular-nums">
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
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-danger/30 bg-danger/8 px-3 py-2">
          <p className="text-danger text-sm">{state.problem}</p>
          <button type="button" onClick={() => player.play(source)} className="font-mono text-label text-text-soft uppercase hover:text-text">
            Try again
          </button>
        </div>
      ) : (
        held && (
          <div className="hidden items-center gap-3 @[18rem]:flex">
            <button
              type="button"
              aria-label={state.muted ? 'Unmute' : 'Mute'}
              onClick={() => player.setMuted(!state.muted)}
              className="text-text-faint transition hover:text-text"
            >
              <VolumeGlyph muted={state.muted || state.volume === 0} />
            </button>
            <Slider label="Volume" value={state.muted ? 0 : state.volume} onChange={(volume) => player.setVolume(volume)} className="max-w-40" />
            {state.ducked && <span className="font-mono text-label text-text-faint uppercase">Lowered while speaking</span>}
          </div>
        )
      )}
    </div>
  )
}

/** The picture of what plays, or, with none, a tile in the accent whose bars move with the sound. */
function Artwork({ url, sounding }: { url: string | undefined; sounding: boolean }) {
  const [broken, setBroken] = useState(false)
  if (url && !broken) {
    return (
      <img
        src={url}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className="size-16 shrink-0 rounded-md border border-line object-cover @md:size-20"
      />
    )
  }
  return (
    <div className="flex size-16 shrink-0 items-end justify-center gap-[3px] overflow-hidden rounded-md border border-accent/30 bg-[radial-gradient(120%_120%_at_30%_0%,color-mix(in_oklab,var(--accent)_35%,transparent),transparent_70%)] pb-4 @md:size-20">
      {[0.5, 0.85, 0.65, 1, 0.55].map((height, index) => (
        <span
          key={index}
          className={cn('w-[3px] origin-bottom rounded-full bg-accent', sounding && 'animate-level')}
          style={{ height: `${height * 40}%`, animationDelay: `${index * -0.23}s`, opacity: sounding ? 1 : 0.45 }}
        />
      ))}
    </div>
  )
}

/** "Live", with a dot that glows while it is heard. */
function Live({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        'flex items-center gap-1.5 rounded-sm border px-1.5 py-px font-mono text-[0.625rem] uppercase tracking-[0.12em]',
        on ? 'border-danger/50 text-danger' : 'border-line-strong text-text-faint'
      )}
    >
      <span className={cn('size-1.5 rounded-full', on ? 'animate-pulse bg-danger shadow-[0_0_8px_var(--color-danger)]' : 'bg-text-faint/60')} />
      Live
    </span>
  )
}

/** A thin bar to set a level or a position, from 0 to 1. A range input does the work; the bar is drawn over it. */
function Slider({ label, value, onChange, className }: { label: string; value: number; onChange(value: number): void; className?: string }) {
  return (
    <div className={cn('group relative flex h-4 min-w-0 flex-1 items-center', className)}>
      <div className="h-1 w-full overflow-hidden rounded-full bg-line-strong">
        <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <div
        className="pointer-events-none absolute size-2.5 -translate-x-1/2 rounded-full bg-text opacity-0 shadow transition group-hover:opacity-100"
        style={{ left: `${value * 100}%` }}
      />
      <input
        type="range"
        aria-label={label}
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      />
    </div>
  )
}
