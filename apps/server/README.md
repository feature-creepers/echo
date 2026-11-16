# @repo/server

The core as a process. The desktop app starts it and connects to it; a remote server will run the same program.

It is the composition root: `src/compose.ts` is the only file in the repository that knows both the core and the adapters it runs on.

- **Runs in:** Node
- **May import:** `@repo/core`, the contracts and every adapter

## Running it

```bash
ASSISTANT_CORE_TOKEN=<token> pnpm --filter @repo/server start
```

Once it accepts connections it prints one line on standard output saying where it listens:

```json
{ "type": "ready", "endpoint": "/tmp/core-ab12cd/core.sock" }
```

Everything else it prints goes to standard error. A client then connects to that endpoint and says hello with the token (see `@repo/protocol`).

| Option                | Meaning                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| `--listen <endpoint>` | Where to listen: a Unix socket path, or a named pipe on Windows. Left out, it picks a fresh one |
| `--exit-with-parent`  | Stop when standard input closes. An app that starts the core as its child passes it             |

`pnpm --filter @repo/server build` bundles it into one file, `dist/main.js`, which is what the desktop app ships.
