# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.1] - 2026-09-08

First release.

### Added

- `API` client covering 14 Checkout Champ endpoints across orders, leads,
  upsales, campaigns, customers, transactions and lander clicks, each
  returning a thenable call object read with `get()` or `getInObject()`.
- The provider's response is returned as-is; the package adds no envelope of
  its own. Transport failures surface as `curlError` from `getInObject()` and
  as the bare failure message from `get()`; a non-JSON response raises
  `CheckoutChampError`.
- `getPayloadInfo()`, exposing the endpoint and the caller's own parameters
  with the _configured_ `loginId`/`password` deliberately excluded — that is
  the whole guarantee. On `importOrder`, `preauth` and `importUpsale` it still
  echoes back whatever cardholder data the caller passed in, so the same PCI
  handling documented for the request URL applies to this value there too.
- `headerRequired` per-call option wrapping a response as `{ content, header }`
  with cURL-shaped transport info (`http_code`, `url`, `content_type`,
  `total_time`, `redirect_count`). `header.url` always has its query string
  removed — that is where `loginId`, `password` and cardholder data ride — so
  only scheme, host and path are ever returned there.
- Credentials supplied entirely by the caller: login ID and password are
  required constructor arguments. The package ships no defaults and reads no
  environment variables. Caller parameters cannot shadow them.
- `host` and `basePath` options taking a bare hostname, defaulting to
  `api.checkoutchamp.com`; `host` is checked against a strict allowlist, so a
  full URL, a path, or a value carrying userinfo is rejected and the scheme
  and path assembly stay inside the client.
- `timeout` and `connectTimeout` options, defaulting to 30 and 10 seconds.
- TLS peer and host verification, always on, with no option to disable it —
  which matters especially here, since this API carries credentials in the URL.
- Opt-in debug logging that is redacted by default. Because Checkout Champ
  transmits credentials, personal data and cardholder data as query string
  parameters, redaction covers the **URL** as well as headers and bodies:
  `loginId`, `password`, card numbers, CVV, expiry, bank and government
  identifiers are masked, while the scheme, host, path and ordinary parameters
  stay readable. URL fragments are masked wholesale.
- Card numbers additionally caught by shape — any 13–19 digit value passing a
  Luhn check is masked wherever it appears, including in the URL.
- Redaction proven by test not to alter the real request or response.
- `debugRedact: false` escape hatch for verbatim local debugging, documented
  as never-in-production.
- A built-in file sink writing one file per day from a caller-supplied base
  path, with a retention setting (default 7 days, `0` keeps everything).
  Pruning matches only the package's own dated filenames, reads the date from
  the filename rather than the mtime, and runs once per process.
- A `debugSink` option accepting a synchronous or asynchronous function that
  replaces the file sink entirely, as the vendor-neutral extension point for
  any external log destination, with its own writes serialized so a slow
  destination cannot interleave two entries.
- `await api.flushDebugLog()`, to drain queued asynchronous log writes before
  a short-lived process exits.
- `HttpClientInterface` transport seam with an `HttpsClient` default built on
  `node:https`/`node:http`, so requests can be routed through a consumer's own
  HTTP stack and the test suite can run without touching the network.
- `withProxy()` for per-call HTTP proxy routing, including `CONNECT`-tunnelled
  proxying of `https` destinations.
- `CheckoutChampError` as the single exception type, extending `Error`.
- `API.supportedMethods()` listing every dispatchable resource method, and
  `API.call()` for dispatching a method chosen at runtime.
- Every resource call returns a `PendingCall`, a thenable object that performs
  its exchange at most once regardless of how many of its accessors are read,
  and that owns its own state — concurrent calls on one client are safe.
- Documentation: README, integration guide, architecture notes, security
  policy, and contributor conventions.
- Dual ESM and CJS build output with generated type declarations, verified by
  a `publint --strict` check and interop tests that import the built package
  from a plain `.mjs` file and a plain `.cjs` file.
- ESLint (`strictTypeChecked`), TypeScript strict mode, and a Vitest suite
  covering every public method and asserting the URL, HTTP method, headers and
  query parameters, running on Node 22 and 24 in CI.

[0.0.1]: https://github.com/astermd/npm-checkoutchamp-client/releases/tag/v0.0.1
