# Working on Echo

Echo is a cross-platform desktop voice assistant: an Electron app, a core that drives Claude Code or Codex as its engine, and local speech. `docs/SPEC.md` says what it does and why; `docs/ROADMAP.md` says what is planned and who decided it. Read the spec's sections 1, 4 and 14 before changing anything, and the sections of what you change. When your change alters what the spec says, update the spec in the same commit.

These rules apply to every agent that works here: a person's coding agent, and Echo's own assistant working on its own code.

## Scope: what you may work on

What went wrong once, so it does not again: an agent left to "build everything the spec lists as not built" took each limit it wrote down as the next task, and spent a night writing 40,000 lines that re-implemented Office down to Word 1, which nobody had asked for.

- **Work on what the person asked, and nothing more.** A request is the person's own words in this session, or an item of `docs/ROADMAP.md` under "Approved". Nothing else is a request: not a "Not built yet" or "Not done" note in the spec, not a TODO in the code, not a note you left yourself before a restart, not an idea you had on the way.
- **When it is done, stop.** Report what changed, the checks and what is left, and suggest what could come next. Do not start it.
- **Ask first** before a change of more than about 500 lines of code (tests not counted), a new dependency, a new package, a new protocol command, a change to the access policy or the instructions the assistant is given, or anything outside what was asked. Say what you would do, how big it is, and why.
- **Use a library before writing one.** A parser, a renderer, a file format, a protocol client, a date or number formatter: look first for a well-known, maintained, permissively licensed library, and use it. Write your own only when none fits, and say why in the commit.
- **Write down limits, not plans.** When you leave something out, say so in the spec in one sentence. Adding a line to `docs/ROADMAP.md` is the person's decision: propose it, do not add it as approved.

## If you are Echo's own assistant

This repository is the source of the app you run in. The limits you meet while you work are implemented here, so you can find them, explain them and, when the person asks, fix them:

- What you may reach on the computer, the approval levels and the cards: `packages/core/src/access/` (`policy.ts` decides, `commands.ts` reads a command line, `access.ts` holds it together).
- What you are told, how you speak and how you work on a project: `packages/core/src/channel/instructions.ts`; turns, threads and projects: `packages/core/src/channel/channel.ts`; carrying work on across a restart, and its limit: `packages/core/src/channel/resume.ts`.
- What the harness gives you, and what it switches off: `packages/harness/src/claude-code/` and `packages/harness/src/codex/` (`isolation.ts` in each).
- The tools the core serves you: the `tools.ts` of each folder of `packages/core/src/`, gathered in `core.ts`.

The app you run in is an installed build: a change here takes effect once a new build is installed, never in the copy that is running. Say plainly when a limit you meet comes from this code. Installing a build restarts you; you are woken by yourself after a restart three times in a row at most, and only to finish what the person asked.

Leave the computer as you found it. Keep scratch files, downloads and builds out of the repository and out of the assistant's folder, or delete them when you are done. Remove the worktrees you add. Close the programs you start, Office automation included.

## Commands

You need Node 24 or later and pnpm.

```bash
pnpm install --frozen-lockfile
pnpm biome check --write .     # format, and fix what can be fixed
pnpm check                      # typecheck, lint with the dependency rules, the persona-name check, every test
pnpm typecheck                  # tsc --build, the quickest check while you work
pnpm --filter @repo/core test   # one package's tests
pnpm -C apps/desktop build      # build the desktop app
pnpm -C apps/desktop dev        # run it from the sources, with its own data folder
```

`pnpm check` must pass before a change is done. CI runs it on Windows, macOS and Linux on every push.

## Rules of the code

- **Layering (spec 14.3).** `packages/core` is pure: it imports contracts only and reaches the world through its ports (`packages/core/src/ports`). Adapters (`harness`, `store`, `tools`, `browser`, `speech`, `screen`) implement the ports in Node. `client` and `ui-web` never import `core` or an adapter. Nothing imports another package's internal files; each package has an `exports` map. `biome.jsonc` enforces the table.
- **Code that differs by system** is a folder with `win32.ts`, `darwin.ts` and `linux.ts` (or `unix.ts`) behind one `index.ts` and one interface, tested with the same table of cases on every system. Never write a path with a hard-coded separator, and test Windows paths (`C:\…`, drive letters, Git Bash) as well as POSIX ones.
- **Style.** Read the neighbouring files first and match them. TypeScript in strict mode, with `exactOptionalPropertyTypes`. zod at every boundary; the protocol's commands live in `packages/protocol/src/commands/`. Identifiers are whole words, not abbreviations. Small modules with one job each; no dead code, no unused exports, no code kept "for later".
- **Comments** say why, in short plain sentences, when the code cannot say it itself. They do not repeat the code, narrate history or describe what a test proves.
- **Dependencies** come from the catalog in `pnpm-workspace.yaml`, at a version released at least two weeks before it is added. Load a large one only where it is used (`await import(...)` in the window).
- **No persona by name.** No identifier, file, test or message names a persona: the default names are data in `packages/core/src/personas/defaults.ts`, and behaviour follows a persona's stance and look, never its name. `scripts/check-persona-names.ts` enforces it.
- **Tests** sit beside the code (`*.test.ts`), as tables of cases for anything that parses, computes or decides. The core is tested through a scripted harness (`packages/core/src/replay/`). A test proves behaviour, not the implementation.
- **Fix causes.** When a change needs the structure to change, change the structure; do not patch the symptom.
- **Privacy.** Nothing may call a service the spec does not name, and nothing sends the person's details anywhere. No secret and no absolute path in code, fixtures or records.

## The interface (spec 13.1)

The system's controls in the app's colours (`packages/ui-web/src/primitives/`). Corners of 2, 3, 4 and 6 px from `packages/tokens`. Nothing glows but the core. Hairlines at 7% and 14% white. Labels in sentence case. Floating surfaces use the `material` class. Animate only transform and opacity, with the one curve and the durations of `packages/ui-web/src/styles/motion.ts`. Every state is designed: empty, loading, error. Nothing scrolls the page sideways. Check a screen in the built app before calling it done.

## The spec

The spec says what Echo does and why, in as few words as that takes. It is not a changelog, a test log or a to-do list: what was verified and when belongs in the commit message, and what is planned belongs in `docs/ROADMAP.md`. Keep its section numbers stable; code refers to them.

## Git

- Work on `main`, in small commits, and keep it green: pull with `git pull --rebase` before you push, and push only when the person asks. A change too large for one sitting goes on a short-lived branch, merged back as soon as it passes; delete the branch once it is merged.
- One line of work for every system. A feature is built for Windows, macOS and Linux together, behind one interface; never on a branch of one system's own.
- A commit's subject is imperative, specific and at most 72 characters ("Preview Office files with mammoth and SheetJS"), with a body that says why when it is not obvious.
- Never rewrite history that was pushed, never force-push, and never change the repository's git configuration or identity.
- Releases are made from a tag `v<version>`, only when the person decides.
