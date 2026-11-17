# Echo

A personal assistant you talk to. It answers with a short spoken sentence and with interface elements it composes on screen. One assistant, one conversation, on Windows, macOS and Linux.

The assistant has personalities, and you call it by the name of the one in use. Two come with it, named Jarvis and HAL until you rename them: the first goes along with you, the second questions you before a risky move.

## What it does

- **Talk or type.** Ctrl+Space in the window (Cmd on a Mac), keys of your choice from any app, or the microphone button; it stops listening when you pause. It answers aloud, sentence by sentence, while the rest is still being written.
- **It shows what is better seen than heard.** The assistant composes each view itself from generic building blocks (metrics, tables, charts, steps, timelines, its own drawings, documents to download). Nothing is made in advance for any subject.
- **One conversation, hidden threads.** Topics are worked on in threads you never have to manage. "By the way" questions open asides beside the current topic. An answer that finishes while you moved on waits, marked ready.
- **Two personalities, named by you.** One goes along with you; the other questions a risky move with a decision card, and complies if you insist.
- **Your own AI.** It runs on Claude Code or Codex, signed in with your own account. Speech runs on your computer: your voice never leaves it.
- **It remembers.** Every word is kept, and while it sleeps it works out what matters about you; settings show what it knows, to correct or forget.
- **Set it your way.** The microphone and speakers, the voice's pace or text only, the model it answers with (Haiku by default, Sonnet or Opus; Codex's own models), the shortcuts, opening at login and waiting in the tray. It keeps itself up to date.
- **For the curious.** A side panel shows the transcript, the threads, and every raw event (Ctrl+T).

## Status

Early, and working. See [docs/SPEC.md](docs/SPEC.md), section 14.8, for what is built and what is not yet . The original proof of concept, called JARVIS, is on the `main` branch.

Packages for Windows, macOS and Linux are built by CI on every push: open the latest run under Actions and download the one for your system from its Artifacts. Releases are on the Releases page, and installed copies update from them (see [apps/desktop/README.md](apps/desktop/README.md)). Nothing is signed yet, so your system will warn before the first start.

## Working on it

You need Node 24 or later and pnpm.

```bash
pnpm install
pnpm check                           # typecheck, lint (including the dependency rules), formatting, tests
pnpm build
pnpm --filter @repo/desktop dev      # run the desktop app
pnpm --filter @repo/desktop package  # package it for this system, into apps/desktop/release
```

Each app and package has a README of its own.

## Layout

```
apps/        programs that are built and shipped
packages/    libraries: contracts, the core, adapters, client side
tooling/     shared compiler and lint configuration
docs/        the spec
```

Which package may import which is declared in `biome.jsonc` and enforced by `pnpm lint`.
