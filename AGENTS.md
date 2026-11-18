# Working on Echo

Echo is a cross-platform desktop voice assistant: Electron, a core that drives Claude Code or Codex as its engine, and local speech. `docs/SPEC.md` is the source of truth for what it does and why. Read its sections 1, 4 and 14 before changing anything, and the sections of what you change. When your change alters what the spec says, update the spec in the same change.

## If you are Echo's own assistant

This repository is the source of the app you run in. The limits you meet while you work are implemented here, so you can find them, explain them and, when the person asks, fix them:

- What you may reach on the computer, the approval levels and the cards: `packages/core/src/access/` (`policy.ts` decides, `commands.ts` reads a command line, `access.ts` holds it together).
- What you are told, how you speak and how you work on a project: `packages/core/src/channel/instructions.ts`; turns, threads and projects: `packages/core/src/channel/channel.ts`.
- What the harness gives you, and what it switches off: `packages/harness/src/claude-code/` and `packages/harness/src/codex/` (`isolation.ts` in each).
- The tools the core serves you: the `tools.ts` of each folder of `packages/core/src/`, gathered in `core.ts`.

The app you run in is an installed build: a change here takes effect once a new build is installed, never in the copy that is running. Say plainly when a limit you meet comes from this code.

## Commands

You need Node 24 or later and pnpm.

```bash
pnpm install --frozen-lockfile
pnpm biome check --write .     # format and fix what can be fixed
pnpm check                      # typecheck, lint with the dependency rules, the persona-name check, every test
pnpm typecheck                  # tsc --build, the quickest check while you work
pnpm --filter @repo/core test   # one package's tests
pnpm -C apps/desktop build      # build the desktop app
pnpm -C apps/desktop dev        # run it from the sources, with its own data folder
```

`pnpm check` must pass before a change is done. CI runs it on Windows, macOS and Linux on every push.

## Rules of the code

- **Layering (spec 14.3).** `packages/core` is pure: it imports contracts only and reaches the world through its ports (`packages/core/src/ports`). Adapters (`harness`, `store`, `tools`, `browser`, `speech`) implement the ports in Node. `client` and `ui-web` never import `core` or an adapter. Nothing imports another package's internal files; each package has an `exports` map. `biome.jsonc` enforces the table.
- **Code that differs by system** is a folder with `win32.ts`, `darwin.ts` and `linux.ts` (or `unix.ts`) behind one `index.ts` and one interface, tested with the same table of cases on every system. Never write a path with a hard-coded separator, and test Windows paths (`C:\…`, drive letters, Git Bash) as well as POSIX ones.
- **Style.** Read the neighbouring files first and match them. TypeScript in strict mode, with `exactOptionalPropertyTypes`. zod at every boundary; the protocol's commands live in `packages/protocol/src/commands/`. Identifiers have no abbreviations. Comments are full sentences that say why, in the product's voice ("the person", "the assistant").
- **No persona by name.** No identifier, file, test or message names a persona: the default names are data in `packages/core/src/personas/defaults.ts`, and behaviour follows a persona's stance and look, never its name. `scripts/check-persona-names.ts` enforces it.
- **Tests** sit beside the code (`*.test.ts`), as tables of cases for anything that parses, computes or decides. The core is tested through a scripted harness (`packages/core/src/replay/`).
- **Fix causes.** When a change needs the structure to change, change the structure; do not patch the symptom.
- **Privacy.** Nothing may call a service the spec does not name, and nothing sends the person's details anywhere. No secret and no absolute path in code, fixtures or records.

## The interface (spec 13.1)

The system's controls in the app's colours (`packages/ui-web/src/primitives/`). Corners of 2, 3, 4 and 6 px from `packages/tokens`. Nothing glows but the core. Hairlines at 7% and 14% white. Labels in sentence case. Floating surfaces use the `material` class. Animate only transform and opacity, with the one curve and the durations of `packages/ui-web/src/styles/motion.ts`. Every state is designed: empty, loading, error. Nothing scrolls the page sideways. Check a screen in the built app before calling it done.

## Git

- Work on `main`, in small commits, and keep it green: pull with `git pull --rebase` before you push, and push only when the person asks. A change too large for one sitting goes on a short-lived branch, merged back as soon as it passes.
- One line of work for every system. A feature is built for Windows, macOS and Linux together, behind one interface; never on a branch of one system's own.
- A commit's subject is imperative and says what the product now does ("Ask before publishing at every level"), with a body when the why is not obvious.
- Never rewrite history that was pushed, never force-push, and never change the repository's git configuration or identity.
- Releases are made from a tag `v<version>`, only when the person decides.
