# Contributing notes for AI agents and humans

This file describes how to work in this repository. It is public; keep it that
way. Anything internal belongs in `CLAUDE.local.md`, which is gitignored.

## What this package is

A small, dependency-free Node.js client for the Checkout Champ API. It has one
job: turn a method call into a well-formed HTTP request, and hand the
provider's response back unchanged. It holds no state between calls and no
credentials of its own — every `PendingCall` owns its own state, so it is safe
to have several calls in flight on one client at once.

## The constraint that shapes everything

**Checkout Champ authenticates with `loginId` and `password` as URL query
string parameters, and every request parameter goes in the query string too.**

That single fact drives most of the design decisions here. The URL carries
credentials, personal data and cardholder data on every call, so:

- Debug logging **redacts the URL**. Do not "fix" this to log verbatim.
- `getPayloadInfo()` must never return credentials.
- TLS verification is not negotiable.

If you are changing anything in `src/logging/`, re-read that list first.

## Language and tooling

- TypeScript, strict mode, targeting Node.js **22 or newer**. CI runs the gate
  on Node 22 and 24.
- Zero runtime dependencies. Adding one needs a strong argument — consumers
  install this alongside their own framework.
- Raising the minimum Node version is a breaking change — it goes in the
  changelog and in `package.json`'s `engines.node`, never quietly.

## Style

- Formatting is Prettier's, enforced by CI; do not hand-format around it.
- ESLint runs `typescript-eslint`'s `strictTypeChecked` preset. No `any`,
  explicit return types on every exported function and method.
- TSDoc on every exported class, method, property and type, including
  `@param`, `@returns` and `@throws` where relevant. Comments explain _why_,
  not _what_.
- `TransportInfo`'s snake_case keys (`http_code`, `content_type`,
  `total_time`, `redirect_count`) are a deliberate compatibility contract with
  the Composer package's `header` wrapper output, not a naming-convention
  oversight — do not rename them to camelCase. If
  `@typescript-eslint/naming-convention` is ever broadened to cover interface
  members, that change needs an explicit exemption for `TransportInfo`, not a
  rename of its keys.

## Architecture rules

- `API` is the only entry point a consumer touches. It declares all fourteen
  resource methods explicitly (see `docs/ARCHITECTURE.md` for why this is not
  a `Proxy`), and also keeps `METHOD_MAP` for `API.call()` and
  `API.supportedMethods()`.
- Resource classes (`Order`, `Customer`, …) extend `CheckoutChamp`, call
  `sendPost(section, method, fields, options)`, and contain no HTTP logic at
  all.
- `PendingCall` owns all per-call state: the frozen `Request`, the cached
  in-flight/settled promise, and the logic that performs the exchange exactly
  once regardless of how many accessors are read. Never add state to `API` or
  a resource class that varies per call — it belongs on `PendingCall`.
- All network access goes through `HttpClientInterface`. Never call
  `node:http`/`node:https` outside `Http/HttpsClient`.
- Never accept a full URL from a consumer. `ClientConfig` takes a bare host
  and rejects anything not matching its allowlist (scheme, path, query,
  userinfo, backslash all rejected).
- Never disable TLS verification, and never add an option to.
- Logging must not be able to change behaviour. `DebugLogger` reads from
  `Request`/`Response` value objects and returns a string; it mutates nothing
  and swallows its own failures, including a rejected promise from an
  asynchronous `debugSink`.
- Adding a resource method means: adding it to the resource class, adding a
  delegating method to `API`, registering it in `API.METHOD_MAP`, documenting
  it in the README, and adding a test.

## Testing rules

- Every public method has a test.
- **No test may touch the network.** Use `test/support/mock-http-client.ts`.
- Resource tests assert the path, the HTTP method, and the decoded query
  parameters — `test/support/client-test-case.ts`'s `assertRequest()` covers
  all three, and checks the credentials are present exactly once.
- Credentials in tests are obviously fake placeholders. Never a real login,
  not even an expired one.
- New redaction rules need a test proving the real request and response are
  unchanged, alongside the test proving the log entry is masked.

## Running the gate

```bash
npm ci
npm run gate
```

which runs, in order and stopping at the first failure: `lint` → `typecheck`
→ `test` → `build` → `test:interop` → `lint:package`. All must pass on every
supported Node version before anything is tagged.
