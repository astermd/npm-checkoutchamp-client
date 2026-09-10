# Contributing

Thanks for taking a look. This package is small on purpose; keeping it that
way matters as much as adding to it.

## Getting set up

```bash
git clone https://github.com/astermd/npm-checkoutchamp-client.git
cd checkoutchamp-client
npm ci
```

`npm ci` rather than `npm install` — it installs exactly what
`package-lock.json` records, which is what CI does too.

## The gate

```bash
npm run gate
```

runs, in order, stopping at the first failure:

1. **`npm run format:check`** — `prettier --check .`. Prettier controls
   formatting; this is what catches an unformatted file before ESLint even
   runs.
2. **`npm run lint`** — ESLint, including `typescript-eslint`'s
   `strictTypeChecked` preset. No `any`, exhaustive checks, explicit return
   types on every exported function and method.
3. **`npm run typecheck`** — `tsc --noEmit` in strict mode.
4. **`npm run test`** — the full Vitest suite.
5. **`npm run build`** — `tsup` produces the ESM and CJS output plus type
   declarations.
6. **`npm run test:interop`** — imports the built package from a plain `.mjs`
   file and a plain `.cjs` file, so a break in the dual-format build surfaces
   here rather than after publish.
7. **`npm run lint:package`** — `publint --strict` against the built package,
   catching an `exports` map, a missing file, or a `types` condition ordered
   wrong before it ships.

All seven must pass before anything is merged or tagged. `npm run lint:fix` and
`npm run format` fix most style findings automatically.

## Test-driven development

Every public method needs a test before it is considered done — write the
test first where you reasonably can. A resource method's test should assert
the request path, the HTTP method, and the decoded query parameters it
produces; `test/support/client-test-case.ts` has the shared assertion helper
most resource tests already use.

**No test may reach Checkout Champ or any other third-party host.** Inject
`test/support/mock-http-client.ts`, or write your own
`HttpClientInterface` implementation, instead of stubbing the client itself.
A test that performs real network I/O is a bug in the test, not a feature.

## Style

- TSDoc on every exported class, method, property and type — including
  `@param`, `@returns` and `@throws` where they apply. The comment should
  explain _why_ a decision was made, not restate the signature; the codebase
  itself is full of examples of this.
- Prettier controls formatting; do not fight it by hand. `npm run format`
  applies it.
- Follow the naming and architecture rules in [CLAUDE.md](CLAUDE.md).

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/) —
`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, and so on, with an
optional scope like `fix(redactor): …`. This keeps the changelog and the git
history readable together.

## Raising the Node floor

Requiring a newer minimum Node version is a **breaking change**, never a
quiet bump. It must be recorded in `CHANGELOG.md` under a major version entry
and reflected in `package.json`'s `engines.node` field in the same change —
not left for a later release to catch up on.

## Questions

Open an issue at <https://github.com/astermd/npm-checkoutchamp-client/issues>, or
email **admin@astermd.com**. Report a security vulnerability privately instead
— see [SECURITY.md](SECURITY.md).
