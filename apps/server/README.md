# @repo/server

The core as a process: it opens the user's data, wires the adapters into the core, and listens for clients on this machine. The desktop app builds it into its own bundle and starts it as an Electron utility process.

`src/compose.ts` is the only file in the repository that knows both the core and the adapters.

- **Runs in:** Node
- **May import:** `@repo/core`, the contracts and every adapter
- **Entry points:** `@repo/server/main` (`src/main.ts`)

The import rule is enforced by `biome.jsonc` (docs/SPEC.md, section 14.3).

## Running it

```bash
ASSISTANT_CORE_TOKEN=<token> pnpm --filter @repo/server start --data <folder>
```

| Option               | Meaning                                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| `--data <folder>`    | Required. The folder that holds the user's data, created when missing. Only one core may use it at a time |
| `--exit-with-parent` | Stop when standard input closes, so a core started as a child never outlives its parent                   |

The token a client must present is read from `ASSISTANT_CORE_TOKEN`, then removed from the environment, so no program the core starts inherits it. Once the core accepts connections it prints one line on standard output saying where it listens, a Unix socket in a new private folder or a named pipe with a random name:

```json
{ "type": "ready", "endpoint": "/tmp/core-ab12cd/core.sock" }
```

Everything else goes to standard error. A client connects to that endpoint and says hello with the token; once admitted it sends commands, gets one result for each, and receives every event (`@repo/protocol`). The core exits with code 2 when it was started wrongly, and with code 1 when it could not open the user's data, for instance because a more recent version wrote it.

## Tests

```bash
pnpm --filter @repo/server test                    # the process, the listener and the public web reader
REAL_HARNESS=1 pnpm --filter @repo/server test     # also the whole core against the signed-in Claude Code
```

The second spends a few calls of the user's allowance.
