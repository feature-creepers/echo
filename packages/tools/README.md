# @repo/tools

The tool server a harness calls, and the gate that checks scope and approval at every call. Built so far: the server.

Reply text is speech; tool calls are the screen and every action. `serveTools` serves the tools of a `ToolHost` (a port of `@repo/core`) to harnesses on this machine and carries every call to it. The server knows nothing about what the tools do.

```ts
const tools = await serveTools(host, { version, log })
tools.url // http://127.0.0.1:53124/mcp, given to a harness with the token of its session
await tools.close()
```

## What it speaks

MCP over HTTP ("streamable HTTP") in its simplest form: each POST to `/mcp` carries one JSON-RPC message, or a batch, and gets its whole answer as JSON. There is no stream of server events and no session to keep, so GET and DELETE are answered 405. It answers `initialize`, `ping`, `tools/list` and `tools/call`, accepts notifications, and answers any other method with "method not found".

- **Who is calling** is the bearer token of the request. The host says which tools that token may see; a token it does not know is answered 401, whatever was asked.
- **A result** is one text, marked as an error when the host said the call failed. A tool the session does not have, or a host that throws, is also answered as a failed call, which a model reads and corrects.
- **A call may take as long as it needs**, a question to the user for instance: the server never gives up on one. The harness has its own limit, which its adapter must raise.
- **Revisions** of the protocol from 2024-11-05 to 2025-11-25, all with the `initialize` handshake. A harness that also speaks a later revision, with no handshake, tries it first (Claude Code does) and is sent back to the handshake by a plain 400.

## Who it keeps out

Any program on the machine, and any web page open in a browser, can reach a loopback port.

- It listens on `127.0.0.1` only, on a port the system picks.
- A request whose `Host` is not that address and port is refused: this is what a web page obtains by pointing a name of its own at the machine (DNS rebinding).
- A request with an `Origin` is refused: only browsers send one.
- A request body is at most 1 MiB.
- Comparing tokens safely is the host's business.

## Tests

`pnpm --filter @repo/tools test` runs the tests beside the source, against a real server and a host made for the test.

`test/claude-code.test.ts` starts the installed Claude Code against the server and checks that a call from the model reaches the host. It needs the program signed in and asks the cheapest model one short question, so it runs only when asked for:

```bash
REAL_HARNESS=1 pnpm --filter @repo/tools test
```

- **Runs in:** Node
- **May import:** `@repo/core`, `@repo/catalog`
- **Entry points:** `@repo/tools`

The import rule is enforced by `biome.jsonc` and explained in [docs/SPEC.md](../../docs/SPEC.md), section 14.3.
