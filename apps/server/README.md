# @repo/server

The core as a process: it opens the user's data, wires the adapters into the core, and listens for clients on this machine. The desktop app builds it into its own bundle and starts it as an Electron utility process.

`src/compose.ts` is the only file in the repository that knows both the core and the adapters. What the core reads itself, live figures and map shapes, goes through `src/web/public-web.ts`: https only, from public addresses only, each name checked by the addresses it leads to and connected to one of those, at every redirect.

- **Runs in:** Node
- **May import:** `@repo/core`, the contracts and every adapter
- **Entry points:** `@repo/server/main` (`src/main.ts`)

The import rule is enforced by `biome.jsonc` (docs/SPEC.md, section 14.3).

## Running it

```bash
printf '%s\n' "$TOKEN" | node src/main.ts --data <folder>
```

| Option               | Meaning                                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| `--data <folder>`    | Required. The folder that holds the user's data, created when missing. Only one core may use it at a time |
| `--exit-with-parent` | Stop when standard input closes, so a core started as a child never outlives its parent                   |

The token a client must present is read before anything else is done: the first line of standard input, or, when the desktop app runs the core as an Electron utility process, the answer to the `token-wanted` message the core sends on the port between them (`@repo/protocol`, `launch.ts`). It is never read from the environment, which the person's other programs can read for as long as the core runs (`/proc/<pid>/environ` on Linux, `ps -E` on macOS). With no token within 15 seconds, or an empty one, the core exits with code 2. With `--exit-with-parent`, standard input is watched for its end once the token is read. Once the core accepts connections it prints one line on standard output saying where it listens, a Unix socket in a new private folder or a named pipe with a random name:

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
