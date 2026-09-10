# @astermd-hq/checkoutchamp-client

A small, dependency-free Node.js client for the Checkout Champ API — orders,
leads, upsales, campaigns, customers, transactions and lander clicks — with
opt-in request logging that is redacted by default.

> **Unofficial.** This is an independent client library. It is not the official
> Checkout Champ Node.js SDK and is not affiliated with, endorsed by or
> supported by Checkout Champ. "Checkout Champ" and related marks belong to
> their owner, <https://checkoutchamp.com/>. The name is used here only to
> identify the API this library talks to. See [LICENSE](LICENSE) for the full
> notice.

API reference: **<https://apidocs.checkoutchamp.com/>**

## Requirements

- **Node.js 22 or newer**, server-side only.

No runtime dependencies. CI runs the full gate on Node 22 and 24.

## Installation

```bash
npm install @astermd-hq/checkoutchamp-client
```

## Quick start

```ts
import { API } from '@astermd-hq/checkoutchamp-client';

const api = new API(loginId, password); // host defaults to api.checkoutchamp.com

const { response } = await api.orderQuery({ orderId: '123' }).getInObject();

if (response.result === 'SUCCESS') {
  // …
}
```

The login ID and password are **required arguments**. This package ships no
default credentials and reads none from the environment.

## ⚠️ Credentials travel in the URL

The Checkout Champ API authenticates by taking `loginId` and `password` as
**query string parameters**. That is the provider's design, and this client
follows it — but it means your account password appears in the URL of every
request.

Before deploying, read the [security policy](SECURITY.md). In short: anything
between your application and the internet that records outbound request URLs —
a forward proxy, an egress gateway, an APM agent, a TLS-inspecting appliance —
will record your password in cleartext. Audit that path first.

What this package does about it:

- TLS certificate verification is always on, with no option to disable it.
- Debug logging **masks credentials in the logged URL** rather than writing it
  verbatim (see below).
- `getPayloadInfo()` never returns credentials.

## Configuration

```ts
const api = new API(loginId, password, {
  host: 'api.checkoutchamp.com',
  basePath: '',
  timeout: 30,
  connectTimeout: 10,
  debug: false,
  debugRedact: true,
  debugFile: undefined,
  debugRetentionDays: 7,
  debugTimezone: 'UTC',
  debugSink: undefined,
});
```

| Option               | Type                                       | Default                 | Purpose                                                                                              |
| -------------------- | ------------------------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `host`               | `string`                                   | `api.checkoutchamp.com` | **Bare hostname only.** A scheme, path, query, userinfo or backslash is rejected.                    |
| `basePath`           | `string`                                   | `''`                    | Optional path prefix below the host.                                                                 |
| `timeout`            | `number`                                   | `30`                    | Transfer timeout in seconds.                                                                         |
| `connectTimeout`     | `number`                                   | `10`                    | Connection timeout in seconds.                                                                       |
| `debug`              | `boolean`                                  | `false`                 | Master switch for request/response logging.                                                          |
| `debugRedact`        | `boolean`                                  | `true`                  | Mask credentials and sensitive fields in the logged URL, headers and body.                           |
| `debugFile`          | `string`                                   | —                       | Base path for the built-in dated file sink. Required when `debug` is on and no `debugSink` is given. |
| `debugRetentionDays` | `number`                                   | `7`                     | Days of log history to keep. `0` keeps everything.                                                   |
| `debugTimezone`      | `string`                                   | `UTC`                   | IANA timezone for log timestamps and dated filenames.                                                |
| `debugSink`          | `(entry: string) => void \| Promise<void>` | —                       | Replaces the file sink entirely.                                                                     |

If your account is issued a different hostname, pass it — the client treats
every host identically and applies no environment branching of its own:

```ts
const api = new API(loginId, password, { host: 'crm-host-from-your-account' });
```

`host` accepts a **bare hostname** matched against a strict allowlist:
dot-separated labels of ASCII letters, digits and hyphens, with an optional
numeric `:port`. Anything else — a scheme, a path, a query string, userinfo
(`@`), or a backslash — is rejected outright, so the scheme and path assembly
stay inside the client:

```ts
new API(id, pw, { host: 'https://api.checkoutchamp.com' }); // throws
new API(id, pw, { host: 'api.checkoutchamp.com/v1' }); // throws
new API(id, pw, { host: 'api.checkoutchamp.com', basePath: 'v1' }); // correct
```

## Reading a response

Every resource method returns a call object that has not been sent yet.
Awaiting it, or any of its accessors, performs the request exactly once — the
accessors below all read the same cached result, so calling more than one of
them on the same call object never issues a second request. This package adds
no envelope of its own; what comes back is the provider's own response:

```ts
await api.orderQuery().get(); // raw JSON string
await api.orderQuery().getInObject(); // decoded to a value
```

There is no `getInArray()` in this port. The Composer package's `getInArray()`
and `getInObject()` differed only in whether PHP's `json_decode` produced an
associative array or a `stdClass` object; `JSON.parse` in Node produces exactly
one shape, so there is exactly one decoding accessor. See
[Migrating from the PHP package](#migrating-from-the-php-package) below.

Pass `true` to also receive the endpoint and the parameters you sent:

```ts
await api.orderQuery({ orderId: '123' }).getInObject(true);
```

```ts
{
  response: { /* the provider's body, verbatim */ },
  payload: {
    endPoint: 'https://api.checkoutchamp.com/order/query/',
    orderId: '123',
  },
}
```

`payload` never contains your _configured_ `loginId` or `password` — that is
the whole guarantee. It otherwise echoes back whatever you passed in
`params`, verbatim, so on `importOrder`, `preauth` and `importUpsale` it is
the full cardholder object you supplied: treat it with the same care you'd
give the request URL on those endpoints. A `password` key you (not the
client) put in `params` also survives into `payload` even though it never
reaches the wire — the configured credential silently overwrites it there.

If the request never reached the provider, `getInObject()` returns
`{ curlError: '...' }` instead, and `get()` returns the bare failure message
string in place of a body. The `curlError` key name is kept for parity with
the Composer package this was ported from, even though nothing here uses
cURL. A response that is not valid JSON raises a `CheckoutChampError`.

## Available methods

Consult the [Checkout Champ API reference](https://apidocs.checkoutchamp.com/)
for the fields each endpoint accepts. Every call is a `POST`, and the
parameters object is sent as query string parameters.

### Orders, leads and upsales

| Method                  | Request                |
| ----------------------- | ---------------------- |
| `orderQuery(params?)`   | `POST /order/query/`   |
| `importLeads(params?)`  | `POST /leads/import/`  |
| `updateOrder(params?)`  | `POST /order/update/`  |
| `preauth(params?)`      | `POST /order/preauth/` |
| `importOrder(params?)`  | `POST /order/import/`  |
| `importUpsale(params?)` | `POST /upsale/import/` |
| `confirm(params?)`      | `POST /order/confirm/` |
| `qa(params?)`           | `POST /order/qa/`      |

### Campaigns

| Method                   | Request                 |
| ------------------------ | ----------------------- |
| `campaignQuery(params?)` | `POST /campaign/query/` |

### Customers

| Method                   | Request                   |
| ------------------------ | ------------------------- |
| `customerQuery(params?)` | `POST /customer/query/`   |
| `addnote(params?)`       | `POST /customer/addnote/` |

### Transactions

| Method                       | Request                     |
| ---------------------------- | --------------------------- |
| `transactionsQuery(params?)` | `POST /transactions/query/` |

### Landers

| Method                   | Request                             |
| ------------------------ | ----------------------------------- |
| `importClick(params?)`   | `POST /landers/clicks/import/`      |
| `confirmPaypal(params?)` | `POST /transactions/confirmPaypal/` |

Every method also accepts a second, optional argument of per-call settings —
see [`headerRequired`](#headerrequired) below.

Examples:

```ts
await api
  .importLeads({
    campaignId: '7',
    emailAddress: 'buyer@example.test',
  })
  .getInObject();

await api.importOrder({ sessionId: 'sess_1', product1_id: '9' }).getInObject();

await api.qa({ orderId: '123', qaStatus: 'APPROVED' }).getInObject();
```

Parameters you supply cannot shadow the credentials — they are appended last,
so a `password` key in `params` is overridden by the configured value.

### `headerRequired`

Pass `{ headerRequired: true }` as the second argument to any resource method
to wrap the decoded response with its transport metadata as
`{ content, header }`, instead of the bare body:

```ts
const { response } = await api.orderQuery({ orderId: '123' }, { headerRequired: true }).getInObject();
// response = {
//   content: { result: 'SUCCESS', ... },
//   header: { http_code: 200, url: 'https://api.checkoutchamp.com/order/query/', redirect_count: 0, total_time: 0.2, content_type: 'application/json' },
// }
```

`header.url` carries scheme, host and path only — its query string is always
removed, deliberately, since that is where `loginId`, `password` and, on the
billing endpoints, cardholder data ride. Nothing else in `header` carries
request parameters.

This is a **per-call** option, not a property you set on a resource — there is
no resource object exposed to set a property on in this port.

## Errors

Everything the package raises is a `CheckoutChampError`, which extends
`Error`:

```ts
import { CheckoutChampError } from '@astermd-hq/checkoutchamp-client';

try {
  const { response } = await api.orderQuery({ orderId: id }).getInObject();
} catch (e) {
  if (e instanceof CheckoutChampError) {
    // empty credentials, non-bare host, unknown method, or a non-JSON response
  }
}
```

Provider-side rejections come back in the response body as the provider's own
`result` / `message` fields, and transport failures come back as `curlError`
(from `getInObject()`) or the bare message string (from `get()`) — neither is
an exception.

## Debug logging

Logging is off unless you turn it on. When on, entries are redacted by default
and written as copy-pasteable cURL commands with the response beneath.

```ts
const api = new API(loginId, password, {
  debug: true,
  debugFile: '/var/log/checkoutchamp/client.log',
  debugRetentionDays: 7,
});
```

Which produces `/var/log/checkoutchamp/client-2026-08-16.log` containing:

```
[2026-08-16 09:14:02.481000 UTC]
curl --location --request POST 'https://api.checkoutchamp.com/order/import/?sessionId=sess_1&cardNumber=[REDACTED]&cvv=[REDACTED]&loginId=[REDACTED]&password=[REDACTED]'

# Response: HTTP 200
{"result":"SUCCESS","message":{"orderId":"123"}}
```

The timestamp's fractional part carries millisecond precision, zero-padded to
six digits to keep the same width as the Composer package's true microseconds
(`.481000`, not `.481930`) — Node has no finer-grained wall clock to read from.
This is a documented fidelity loss against the PHP original, not a bug.

Because logging is asynchronous, **call `await api.flushDebugLog()`** before a
short-lived process exits — a script, a CLI command, a serverless handler —
so a queued write is not lost when the process ends. It resolves immediately
when logging is off.

### The URL is redacted, not logged verbatim

This is a deliberate departure from how most API clients log. Because Checkout
Champ puts **everything** in the query string — credentials, customer details
and cardholder data alike — logging the URL verbatim would write your account
password and full card numbers to disk on every call.

So redaction covers the URL too:

- **Masked:** `loginId`, `password`, and every sensitive field name — card
  number, CVV/CVC, expiry, bank account and routing numbers, IBAN, SSN, tax ID,
  date of birth, and every `*_token`.
- **Also masked by shape:** any 13–19 digit value that passes a Luhn check, so a
  card number is caught even under an unexpected parameter name.
- **URL fragments are masked wholesale.** Any fragment with content — anything
  after a `#` — becomes `#[REDACTED]` regardless of what it looks like, because
  a fragment has no defined internal structure to mask selectively.
- **Preserved:** the scheme, host and path, plus every parameter that is not
  sensitive. You can always see which endpoint was called with which order ID.

Headers and response bodies are redacted by the same field rules.

**Redaction never changes what is sent or what you receive.** The logger reads
from immutable request and response objects and produces a string; the wire
request and the value returned to your code are untouched. The test suite
asserts this directly.

### Turning redaction off

```ts
const api = new API(loginId, password, {
  debug: true,
  debugRedact: false, // writes your password and full card numbers to disk
  debugFile: '/tmp/checkoutchamp-debug.log',
});
```

Local debugging only. **Never enable it in production.**

### File rotation and retention

The built-in sink writes one file per calendar day, deriving the name from your
base path: `/var/log/checkoutchamp/client.log` becomes
`client-2026-08-16.log`, `client-2026-08-17.log`, and so on.

Pruning removes files older than `debugRetentionDays` (default 7; `0` keeps
everything). It only ever matches this package's own dated filename pattern for
your base path — other files in the directory are never touched — and it reads
the age from the filename rather than the modification time, so an appended-to
or restored file keeps its true age. It runs once per process, not once per
request.

`debugRetentionDays: N` in fact retains **`N + 1` calendar dates**, not `N`: a
file dated exactly `N` days before the current date is kept, so a window of 7
keeps today's file plus the seven days before it — eight dates in total. This
matches the Composer package's own cutoff arithmetic exactly, so the same
configuration keeps the same files under either client.

### Sending logs somewhere else

Supply a function and the file sink is replaced entirely. The package then
writes no files, and retention becomes your responsibility:

```ts
const api = new API(loginId, password, {
  debug: true,
  debugSink: async (entry: string): Promise<void> => {
    await myLogger.debug(entry);
  },
});
```

The function receives the finished entry, already redacted unless you opted
out, and may be asynchronous — the logger awaits it on its own serialized
chain so a slow destination cannot interleave two entries. This is the
extension point for any external destination — a structured logger, a queue, a
log shipper, an object store. A failure inside your sink is caught and
discarded: logging must never break an API call.

### Logs stay sensitive after redaction

A redacted entry still records which account touched which order, customer and
transaction, and when. Store logs on encrypted volumes, restrict read access,
ship them only to systems cleared for that data, and apply a retention period
at least as strict as the rest of your order data.

## Proxy support

```ts
await api.withProxy('proxy.example.test:8080', 'user', 'password').orderQuery({ orderId: '123' }).getInObject();
```

The setting applies to the next call only.

`proxyUrl` is a bare `host:port`, with no scheme — like `host` on `ClientConfig`,
it is not a URL. Passing `http://proxy.example.test:8080` fails with a DNS
lookup error for the literal host `http` (`getaddrinfo ENOTFOUND http`),
since the whole string is parsed as `host:port`.

A proxy is supported for **`https` targets only** — every URL this client
builds is `https://`, so this is not a practical limitation, but a `Request`
built by hand against a non-`https` target with a proxy set returns a
transport error rather than being silently sent direct.

## Custom transport

Pass anything implementing `HttpClientInterface` as the fourth constructor
argument to route requests through your own stack, or to test without a
network:

```ts
import { API, type HttpClientInterface, type Request, Response } from '@astermd-hq/checkoutchamp-client';

class MyTransport implements HttpClientInterface {
  async send(request: Request): Promise<Response> {
    console.log(request.method, request.url);
    return new Response(200, '{"result":"SUCCESS"}', { http_code: 200 });
  }
}

const api = new API(loginId, password, {}, new MyTransport());
```

The default implementation is `HttpsClient`, built on `node:https` — there is
no `CurlClient` in this port, since there is no cURL. An implementation
**must not throw** on transport failure; report it through
`Response.transportError` instead, so the debug logger can still record the
attempt and the caller receives the documented `curlError` shape rather than
an unhandled exception.

## Further documentation

- [Integration guide](docs/INTEGRATION_GUIDE.md) — setup, error handling,
  production logging, troubleshooting.
- [Architecture](docs/ARCHITECTURE.md) — how a call flows through the package
  and where to extend it.
- [Security policy](SECURITY.md) — private disclosure and credential handling.
- [Changelog](CHANGELOG.md)

## Migrating from the PHP package

| PHP                                                            | Node                                                           |
| -------------------------------------------------------------- | -------------------------------------------------------------- |
| `$api->orderQuery([...])->getInArray()`                        | `await api.orderQuery({...}).getInObject()`                    |
| `$api->orderQuery([...])->getInObject()`                       | `await api.orderQuery({...}).getInObject()`                    |
| `$api->get()` / `getInArray()` / `getInObject()` on the client | the accessors live on the returned call                        |
| `$resource->headerRequired = true`                             | `api.orderQuery(params, { headerRequired: true })`             |
| `CurlClient`                                                   | `HttpsClient`                                                  |
| —                                                              | `await api.flushDebugLog()` before a short-lived process exits |

## Development

```bash
npm ci
npm run gate # lint → typecheck → test → build → interop tests → publint
```

See [CLAUDE.md](CLAUDE.md) for the conventions the gate enforces and
[CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute. No test in this
suite makes a network call.

## Support

Email **admin@astermd.com**, or open an issue at
<https://github.com/astermd/npm-checkoutchamp-client/issues>.

Report security issues privately — see [SECURITY.md](SECURITY.md). Do not open
a public issue for a vulnerability.

## Compliance

Using this package does not by itself make your application PCI DSS, HIPAA or
GDPR compliant. It is one component in your system. Scoping, encryption at
rest, access control, audit logging, breach procedures and your agreements
with Checkout Champ and your payment processors remain your responsibility.

Note in particular that `importOrder`, `preauth` and `importUpsale` transmit
cardholder data as query parameters. Determine with your assessor whether that
places the systems handling those requests — and anything that logs their
URLs — inside your PCI DSS scope.

## License

MIT — see [LICENSE](LICENSE), including the trademark and affiliation notice.
