# Architecture

How a call travels through `@astermd-hq/checkoutchamp-client`, why the pieces
are split the way they are, and where to extend it.

---

## The constraint that shapes the design

**Checkout Champ authenticates with `loginId` and `password` as URL query
string parameters, and every other request parameter travels with them.**

Most API clients can treat the URL as non-sensitive: credentials go in a
header, the URL identifies a resource, and logging it verbatim is both safe
and useful. Here that assumption is inverted. The URL carries the account
password, the customer's details and, on the billing endpoints, the card
number.

Almost every design decision below follows from that one fact.

---

## Layers

```
        ┌──────────────────────────────────────────────────┐
        │  API                    facade + method dispatch  │
        └───────────────────────┬──────────────────────────┘
                                │ resolves a method name to a resource
        ┌───────────────────────▼──────────────────────────┐
        │  Order  Campaign  Customer                       │
        │  Transaction  Landers              resources     │
        └───────────────────────┬──────────────────────────┘
                                │ set section, method, fields → sendPost()
        ┌───────────────────────▼──────────────────────────┐
        │  CheckoutChamp     URL + credentials, PendingCall │
        └───────────────────────┬──────────────────────────┘
                                │ returns, unsent
        ┌───────────────────────▼──────────────────────────┐
        │  PendingCall / CallResult   per-call state, decode│
        └──────┬────────────────────────────────┬──────────┘
               │ Request                        │ Request + Response
    ┌──────────▼──────────┐          ┌──────────▼──────────┐
    │ HttpClientInterface │          │    DebugLogger      │
    │      HttpsClient    │          │  Redactor, FileSink │
    └─────────────────────┘          └─────────────────────┘
```

Two rules hold it together:

1. **Everything that reaches the network goes through `HttpClientInterface`.**
   No `node:https` call exists outside `Http/HttpsClient`.
2. **Logging is a read-only observer.** It receives immutable `Request` and
   `Response` objects and returns a string. It cannot alter what is sent or
   what the caller receives.

---

## The lifecycle of one call

Take `await api.importOrder({ sessionId: 's1' }).getInObject()`.

**1. Dispatch.** `importOrder` is a declared method on `API`, so no lookup is
needed to find it — but `API` also keeps `METHOD_MAP`, a compile-time constant
mapping all 14 resource methods to their resource, for `API.call()` and
`API.supportedMethods()`. An unknown name passed to `call()` throws
`CheckoutChampError` before anything else happens.

**2. Resource resolution.** `API`'s constructor builds one instance of each of
the five resources up front, handing each the shared `ClientConfig`,
`HttpClientInterface` and `DebugLogger`. A proxy queued by `withProxy()` is
applied to the resource now, synchronously, then cleared.

**3. The resource describes the request.** `Order.importOrder()` calls
`sendPost('order', 'import', params, options)`. Resource classes hold no HTTP
knowledge whatsoever — that is the whole reason they are thin.

**4. `CheckoutChamp` assembles the request, but returns before sending
anything.** The path becomes `order/import/`, joined to
`ClientConfig.getBaseUrl()`. Credentials are merged into the query **last**:

```ts
const query = buildQuery({
  ...fields,
  loginId: this.config.loginId,
  password: this.config.password,
});
```

Order matters. Spreading them last means a caller who passes a `password` key
in `params` cannot shadow the configured credential — the real assignment
overwrites theirs. There is a test for exactly that.

At the same moment, the credential-_free_ snapshot is taken for
`getPayloadInfo()`: the endpoint without its query string, plus the caller's
own fields. That is the only payload view a consumer ever sees.

**5. `sendPost()` returns a `PendingCall`, unsent.** This is new relative to
the Composer package this was ported from, and it exists because Node has no
equivalent of PHP's request-per-process model: `PendingCall` packages the
frozen `Request`, the transport and the logger together, and does nothing with
them until it is asked to.

**6. The first accessor fires the exchange exactly once.** Calling `await`,
`.then()`, `.get()`, `.getInObject()` or `.getPayloadInfo()` on a `PendingCall`
all route through the same internal `run()`, which creates and caches the
in-flight promise on first use. Every later accessor on that same object,
whichever one it is, returns the cached promise instead of sending again —
which is what lets a caller read both `getInObject()` and `getPayloadInfo()`
off one call while only one HTTP request happens.

**7. A `Request` value object is built** and handed to the transport. It is
immutable, which is what makes the logging guarantee in rule 2 structural
rather than a matter of discipline. Body is `null` and headers are empty —
this API wants everything in the query string, and the client does not invent
a shape the provider was not observed to accept.

**8. `HttpsClient` sends it.** TLS peer and host verification are on, with no
option to disable them — non-negotiable when the password is in the URL. A
transport failure is _not_ thrown; it is returned as `Response.transportError`,
so the logger can still record the attempt.

**9. `DebugLogger.log()` observes.** No-op unless `debug` is on. Otherwise it
renders the entry — with the URL, headers and body redacted unless you opted
out — and hands the string to the sink. Any failure inside logging is
swallowed.

**10. `CallResult` records the outcome.** A transport error surfaces as the
message string from `get()` and as `{ curlError }` from `getInObject()`;
otherwise the provider's body is decoded and returned verbatim. No envelope is
added. When `headerRequired` is set, the body is wrapped as
`{ content, header }`; `header.url` is built by `HttpsClient` with its query
string already stripped before `CallResult` ever sees it, since that query is
where `loginId`, `password` and cardholder data ride and this value is handed
back to the caller unredacted — trimming it to scheme, host and path is the
only safe option, not a redaction of the query.

**11. The caller reads.** `getInObject()` decodes the provider's body.
`getPayloadInfo()` returns the snapshot taken in step 4. Both are safe to call
more than once, and both share the one cached exchange from step 6.

There is no state-reset step here at all — a Composer resource instance is
reused across calls and must clear `section`/`method`/`fields` after each one,
but a `PendingCall` is a one-shot object built fresh for every call, so there is
nothing to reset it back to.

---

## Class responsibilities

| Class                            | Owns                                                                     | Never does                                |
| -------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------- |
| `API`                            | Method dispatch, resource construction, `withProxy()`, `flushDebugLog()` | HTTP, URL building                        |
| `ClientConfig`                   | Credentials, host validation, base URL, timeouts                         | Anything mutable — frozen at construction |
| `CheckoutChamp`                  | URL assembly, credential injection, per-request proxy latch              | Direct network calls                      |
| `Order`…`Landers`                | Route shape only                                                         | HTTP, encoding                            |
| `PendingCall`                    | Per-call state, deferred send, single-flight caching                     | Redaction, decoding                       |
| `CallResult`                     | Decoding, the `curlError`/message asymmetry, `getPayloadInfo()`          | Sending anything                          |
| `Http/Request` / `Http/Response` | Immutable descriptions of one exchange                                   | Behaviour                                 |
| `Http/HttpsClient`               | The only `node:https`/`node:http` use in the package                     | Throwing on transport failure             |
| `Logging/DebugLogger`            | Entry formatting, sink dispatch, `flush()`                               | Mutating anything                         |
| `Logging/Redactor`               | Masking copies of the URL, headers and bodies                            | Touching the real request                 |
| `Logging/FileSink`               | Dated files, retention, pruning, its own write chain                     | Throwing                                  |
| `messages.ts`                    | Every message string the package raises                                  | Runtime configuration                     |
| `support/build-query.ts`         | `http_build_query`-compatible query encoding                             | Anything credential-aware                 |
| `CheckoutChampError`             | Every error the package raises                                           | —                                         |

---

## Design decisions worth knowing

### The URL is redacted, not logged verbatim

This is the package's signature departure from convention, and it exists
because of the constraint at the top of this document.

`Redactor.redactUrl()` splits the query string, masks any parameter whose name
matches the sensitive list — `loginId`, `password`, card number, CVV, expiry,
bank and government identifiers, every `*_token` — and additionally masks any
value that looks like a card number by shape (13–19 digits passing a Luhn
check, catching a PAN under an unexpected parameter name).

The scheme, host and path survive, as does every non-sensitive parameter. A log
entry still tells you which endpoint was called with which order ID; it just
does not tell you the password.

Values are masked in place rather than percent-encoded, because the result is a
log line, not a URL to be re-issued.

A query key that is itself bracket-nested — `card[number]`, `card[cvv]`, or a
deeper `a[card][cvv]`, the shape `support/build-query.ts` produces for a
nested parameter object — is split into its key path first, so the leaf and
its immediate parent get the same sensitivity check `redactBody` already
applies to a parsed JSON object's nested keys. Comparing the bracketed string
whole against the sensitive-key lists, as an earlier version of this method
did, never matches: `card[number]` is not `number`.

The redactor inspects one flat level of query parameters. A sensitive value
nested inside a percent-encoded URL parameter — a `redirectUrl` whose own query
string carries a `token` — is not decoded and masked recursively; see
[`SECURITY.md`](../SECURITY.md) for why this is a deliberate limitation, not an
oversight.

### Credentials are appended last, and stripped from payload info

`ClientConfig` holds them; `CheckoutChamp.sendPost()` is the only place they
are read. They are merged into the query after the caller's fields so they
cannot be shadowed, and the snapshot kept for `getPayloadInfo()` is taken
before they are added.

Keeping the credential on exactly one path is what makes a leak through
`getPayloadInfo()` structurally impossible rather than a bug waiting to
reappear.

### A bare host, not a URL

`ClientConfig` accepts only a bare hostname: dot-separated labels of ASCII
letters, digits and hyphens, with an optional numeric `:port`, matched against
an allowlist rather than a list of forbidden characters. A denylist only ever
rejects the delimiters its author thought of; a host string that merely avoids
`/`, whitespace and `://` can still resolve to a different host once
`https://` is prepended and the result is parsed as a URL, because userinfo
(`@`) and, for a special scheme, `\` and `#` are all authority terminators a
denylist is easy to miss. The allowlist has no such gaps: anything that is not
a validated label-and-port sequence is rejected, full stop.

`basePath` exists for a version prefix and is the only supported way to add a
path.

### No response envelope

The provider's body is returned unchanged. This package deliberately does not
wrap it in a `success` / `message` / `data` envelope of its own, because
Checkout Champ was not observed to return one and inventing a shape would
misrepresent what the provider actually sends. Consult their reference for the
`result` / `message` contract.

### The transport is an interface

Three things fall out: the entire test suite runs without a network, consumers
can route calls through their own HTTP stack, and the details of one transport
implementation stay in one small class. `Response` carries transport errors as
data rather than throwing, so a failure is observable by the logger before
anyone decides what to do about it.

### Retention reads the filename, not the mtime

Appending to a log file updates its mtime, so mtime-based pruning keeps a
month-old file alive indefinitely as long as something writes to it. The date
in the filename is the file's real age. Pruning also matches only this
package's own dated pattern for the configured base path, so it can never
delete a neighbouring file, and it runs once per process rather than once per
request.

### Fourteen declared methods, not a Proxy

The Composer package this was ported from reaches its fourteen endpoints
through PHP's `__call`, a `METHOD_MAP` constant, and `@method` docblocks for
editor support — the language has no typed equivalent of a magic method.
TypeScript could imitate the same runtime shape with a `Proxy` wrapping a
generic `call(method, params)`, but a `Proxy` has no way to declare, per
property name, what parameters it accepts or what it returns: every access
would have to be typed as some generic `(params: Params) => PendingCall`,
erasing exactly the per-method signature information a TypeScript port exists
to preserve. Declaring every method by hand costs fourteen small,
near-identical bodies and buys compile-time checking, grep-ability, and editor
autocomplete for every one of them. `METHOD_MAP` still exists, because
`API.supportedMethods()` and the dynamic `API.call()` need one place that
lists every dispatchable name — but it is consulted, not relied on to
synthesize the typed surface.

### Why `node:https` and not `fetch`

Two things this package documents as supported features `fetch` cannot express
without pulling in a dependency:

- **Proxy support.** Routing a request through an HTTP proxy — a `CONNECT`
  tunnel for an `https:` destination — has no representation in `fetch` or the
  underlying platform proxy configuration; it has to be built by hand on
  `node:http`'s `CONNECT` support and `node:tls`.
- **A connection timeout distinct from a transfer timeout.** `timeout` and
  `connectTimeout` are two separate budgets — one for establishing the
  connection, one for the whole exchange once it is open — and
  `AbortSignal.timeout()` gives `fetch` only a single deadline for the entire
  call, with no way to distinguish "never connected" from "connected but slow
  to respond."

Both are documented, load-bearing behaviours of this client, so `HttpsClient`
is built directly on `node:http` and `node:https` instead — still native,
still zero-dependency, and able to express both.

### Per-call state

The Composer package's client-level `get()` / `getInArray()` / `getInObject()`
accessors read state left behind by whichever call the resource made most
recently. That is safe only under a request-per-process model, where exactly
one call is ever in flight on a given instance at a time — which is how PHP
web applications typically run, and is not an assumption Node shares. Two
calls issued concurrently against one `API` instance are ordinary in Node, and
carrying "last call" state on the client would silently let one concurrent
call's result clobber another's before either caller read it.

`PendingCall` is what removes the hazard rather than documenting around it:
every call gets its own instance, holding its own request, its own cached
promise and its own result. Nothing about one call's state is visible to, or
mutable by, another. Issuing several calls concurrently against one client is
therefore safe by construction, not by convention.

### No runtime dependencies

Consumers install this package alongside their own framework; adding a runtime
dependency needs a strong argument. `messages.ts` is a frozen object literal
rather than a lookup abstraction over some other data source, exactly because
a string table needs no machinery beyond itself.

---

## Extension points

| You want to                                             | Do this                                                                                                                                                        |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route calls through your own HTTP stack                 | Implement `HttpClientInterface`, pass it as the fourth constructor argument                                                                                    |
| Send logs to a structured logger, queue or object store | Supply a `debugSink` function; it replaces the file sink entirely                                                                                              |
| Change log retention                                    | `debugRetentionDays` (`0` keeps everything), or take it over with your own sink                                                                                |
| Support a new endpoint                                  | Add the method to its resource class and to `API` (delegating to it), register it in `API.METHOD_MAP`, document it in the README, test path + method + query   |
| Add a redaction rule                                    | Extend the key lists in `Redactor`, and add both tests: the log is masked, the real request and response are not                                               |
| Move credentials out of the URL                         | `CheckoutChamp.sendPost()` is the only place the query is built — but confirm with Checkout Champ that a form body is accepted before changing the wire format |

Anything requiring a change to `CheckoutChamp`, `HttpsClient` or
`Redactor.redactUrl()` is worth a second look: those three hold the invariants
everything else depends on.
