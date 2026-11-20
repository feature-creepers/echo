# @repo/harness

Adapters that drive an AI agent program (Claude Code, Codex) as an engine for the core. Each implements the `Harness` port of `@repo/core`: a live session that streams its reply and calls the core's tools, a single question with no tools, where the program stands on this machine, and its sign-in. The program is the user's own, run with their own sign-in; their credentials are never read.

- **Runs in:** Node
- **May import:** `@repo/core`
- **Entry points:** `@repo/harness`

The import rule is enforced by `biome.jsonc` (docs/SPEC.md, section 14.3).

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

`createHarnesses` gives Claude Code and Codex, each working in a folder of its own inside `folder`; `createClaudeCode` and `createCodex` give one. Nothing is started or written until a harness is used.

| Option    | Meaning                                                                                                                                                         |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `folder`  | A folder the adapter owns. Sessions run in it, and the files a session hands to its CLI are written there and removed when it closes. It must hold nothing else |
| `log`     | Where the adapter reports what the user is not told: a CLI that starts with more than it was given, the detail of an error                                      |
| `models`  | The model a role runs on, in place of the adapter's choice, by harness id                                                                                       |
| `command` | The command that starts the CLI, in place of the program found on this machine. For tests                                                                       |
| `env`     | The environment the CLI starts from, in place of this process's. For tests                                                                                      |

## What a session promises

- **`text`** events are the reply as it is written, in order. Blocks of text around tool calls are separated by a blank line.
- **`tool`** events name a tool as the core serves it (`ui_render`, not `mcp__core__ui_render`), for the core's tools only. Every `started` has an `ended`, also when the turn is interrupted.
- **`turn-end`** comes when everything sent has been answered. What is sent while a turn runs is taken into that turn or answered right after it, and the turn ends once.
- **`failed`** is the last event. The session is closed by it: its process is stopped and its files removed.
- Events that happen before `onEvent` is called are kept and delivered.

A harness is an engine: a session has the instructions and the tools the core gave it, and nothing else (docs/SPEC.md, section 6.2). `claude-code/isolation.ts` and `codex/isolation.ts` hold every switch, with what each is for. A session given a `Reach` from the core may use the CLI's own tools for files and commands within what the person granted, and every use is checked and put to the core first (docs/SPEC.md, section 12.2).

| Role           | Claude Code | Codex                                                                                      |
| -------------- | ----------- | ------------------------------------------------------------------------------------------ |
| `orchestrator` | `haiku`     | `gpt-6-luna`, when Codex lists it for the user                                             |
| `thread`       | `haiku`     | the Terra model of Codex's own list (`gpt-6.1-terra` without the list), else its first one |
| `utility`      | `haiku`     | `gpt-6-luna`, when Codex lists it for the user                                             |

A request can name its model in place of its role's: that is how the person's choice reaches the CLI.

## Tests

```bash
pnpm --filter @repo/harness test                    # no CLI needed
REAL_HARNESS=1 pnpm --filter @repo/harness test     # also against the signed-in Claude Code
```

The first starts stand-ins for the two CLIs (`test/fake-claude.ts`, `test/fake-codex.ts`), Node scripts that speak each CLI's protocol. The second spends a few short requests of the signed-in account's allowance.
