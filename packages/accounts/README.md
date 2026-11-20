# @repo/accounts

The adapter for the person's accounts at their providers. `createAccounts` implements the core's `Accounts` port: signing in, in the system's browser, with OAuth 2.0's authorisation code and PKCE, coming back to this computer's loopback address (RFC 8252), through [openid-client](https://github.com/panva/openid-client). A refresh token is kept in the vault it is given, never in the store; an access token in memory only. What the assistant may read, and when, is the core's to decide.

- **Runs in:** Node
- **May import:** `@repo/core`
- **Entry points:** `@repo/accounts`

The import rule is enforced by `biome.jsonc` (docs/SPEC.md, section 14.3).

Each provider is one module of `src/providers/`, listed in `known.ts`: its sign-in, the hosts it may call, and its calls. Nothing outside that folder names a provider's hosts, scopes or calls, and every request goes through `requests.ts`, held to the provider's hosts over https, never following a redirect. A provider's app registration is the build's configuration, given to `createAccounts`; a provider without one is not offered, and says why.

## Tests

```bash
pnpm --filter @repo/accounts test
```

No test reaches a provider: `test/fake-provider.ts` plays Google and Microsoft from a server on the loopback address.
