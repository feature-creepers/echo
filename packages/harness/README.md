# @repo/harness

Adapters that drive an AI agent program (Claude Code, Codex) as an engine for the core. Each implements the `Harness` port of `@repo/core`: a live session that streams its reply and calls the core's tools, a single question with no tools, where the program stands on this machine, and its sign-in.

The program is the user's own, run as it is with their own sign-in. Their credentials are never read.

- **Runs in:** Node
- **May import:** `@repo/core`
- **Entry points:** `@repo/harness`

The import rule is enforced by `biome.jsonc` and explained in [docs/SPEC.md](../../docs/SPEC.md), section 14.3.

## Use

```ts
import { createHarnesses } from '@repo/harness'

const harnesses = createHarnesses({ folder: join(data, 'harness'), log })
const claude = harnesses.find((harness) => harness.id === 'claude-code')

const session = claude.open({ role: 'orchestrator', instructions, tools: { url, token } })
session.onEvent((event) => {
  /* text, tool, turn-end, failed */
})
session.send('What is on today?')
```

`createHarnesses` gives Claude Code and Codex, each working in a folder of its own inside `folder`. `createClaudeCode` and `createCodex` give one. Nothing is started or written until a harness is used.

| Option    | Meaning                                                                                                                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `folder`  | A folder the adapter owns. Sessions run in it, and the files a session hands to its CLI are written there and removed when it closes. It must hold nothing else: a CLI reads what is around it. |
| `log`     | Where the adapter reports what the user is not told: a CLI that starts with more than it was given, the detail of an error.                                                                     |
| `models`  | The model a role runs on, in place of the adapter's choice. `createHarnesses` takes them by harness id, since model names differ from one harness to the next.                                  |
| `command` | The command that starts the CLI, in place of the program found on this machine. For tests.                                                                                                      |
| `env`     | The environment the CLI starts from, in place of this process's. For tests.                                                                                                                     |

## What a session promises

- **`text`** events are the reply as it is written, in order. A reply made of several blocks of text, around its tool calls, has a blank line between them.
- **`tool`** events name a tool as the core serves it (`ui_render`, not `mcp__core__ui_render`), for the core's tools only. Every `started` has an `ended`, also when the turn is interrupted.
- **`turn-end`** comes when everything sent has been answered. What is sent while a turn runs is taken into that turn or answered right after it, and the turn ends once, after both.
- **`failed`** is the last event. The session is closed by it: its process is stopped and its files removed.
- Events that happen before `onEvent` is called are kept and delivered.

## Roles and models

| Role           | Claude Code | Codex                                                                                      |
| -------------- | ----------- | ------------------------------------------------------------------------------------------ |
| `orchestrator` | `haiku`     | `gpt-6-luna`, when Codex lists it for the user                                             |
| `thread`       | `haiku`     | the Terra model of Codex's own list (`gpt-6.1-terra` without the list), else its first one |
| `utility`      | `haiku`     | `gpt-6-luna`, when Codex lists it for the user                                             |

A request can name its model (`SessionRequest.model`, `OneShot.model`), in place of its role's: that is how the user's choice reaches the CLI (`--model` for Claude Code, the conversation's `model` for Codex). `models()` gives the models the user can choose from for the answers, each with a plain description, and the default: Haiku, Sonnet and Opus for Claude Code; for Codex, the models it lists for the account in its own `models_cache.json`, named and described for a person.

## Isolation

A harness is an engine: the session has the instructions and the tools the core gave it, and nothing else (docs/SPEC.md, section 6.2). `claude-code/isolation.ts` and `codex/isolation.ts` hold every switch, with what each one is for.

For Claude Code this was checked on the real CLI (2.1.322, subscription sign-in): an instruction planted in `CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md`, `.claude/rules/`, `AGENTS.md` or the folder's auto-memory is not followed. The auto-memory needs a switch of its own (`CLAUDE_CODE_DISABLE_AUTO_MEMORY`, and `autoMemoryEnabled` in the settings handed over): the flags alone leave it on. A session also reads the CLI's own account of how it started, and reports through `log` anything it has that should be off.

Three things Claude Code adds cannot be switched off: a sentence before the instructions saying it is a Claude agent, a description of the machine after them (working folder, system, model, date), and the address of the signed-in account in front of the first message.

## Layout

```
src/
├── index.ts            the entry point
├── harnesses.ts        every harness at once
├── options.ts
├── process/            what both adapters share
│   ├── environment.ts  the environment a CLI starts with: the user's search path, no trace of a surrounding agent session
│   ├── cli.ts          the user's CLI on this machine: where it is, how to start it
│   ├── locate.ts       finding a program
│   ├── run.ts          starting a program, or running it to its end
│   ├── json-lines.ts   JSON, one value per line, in each direction
│   ├── events.ts       a session's events, kept until someone listens
│   ├── working-files.ts  the files a session hands to its CLI
│   ├── platform/       finding and starting a program, per system
│   └── terminal/       opening a terminal for the sign-in, per system
├── claude-code/
│   ├── adapter.ts
│   ├── session.ts      live session over stream-json
│   ├── one-shot.ts
│   ├── isolation.ts
│   ├── status.ts
│   ├── models.ts
│   └── install/        where it is usually installed, per system
└── codex/
    ├── adapter.ts
    ├── session.ts      live session over `codex app-server`
    ├── one-shot.ts     `codex exec`
    ├── isolation.ts
    ├── status.ts
    ├── models.ts
    ├── install/        where it is usually installed, per system
    └── sandbox/        the setting its sandbox needs, per system
test/                   stand-ins for the two CLIs, and what the tests share
```

Code that differs by system is in folders with one file per system and an `index.ts` that picks one. No other file asks which system is running.

## Tests

```
pnpm --filter @repo/harness test                    # no CLI needed
REAL_HARNESS=1 pnpm --filter @repo/harness test     # also against the real Claude Code
```

The first runs everywhere, CI included. It starts stand-ins for the CLIs (`test/fake-claude.ts`, `test/fake-codex.ts`), which are Node scripts speaking each CLI's protocol.

The second spends a little of the allowance of whoever is signed in: about eight short requests to the smallest model. It checks, on the real CLI, streaming, memory across turns, interruption, a single question, a tool call over MCP, and that planted instruction files are ignored.

`fake-claude.ts` was written from what the real CLI was observed to send. `fake-codex.ts` was written from the code of another app that drives the real Codex, without Codex at hand: the Codex adapter has not run against the real CLI yet.
