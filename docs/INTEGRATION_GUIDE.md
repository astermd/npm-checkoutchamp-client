# Integration guide

Getting `@astermd-hq/checkoutchamp-client` into a production application, and
the decisions worth making deliberately along the way.

This guide assumes you already have Checkout Champ API credentials. For what
each endpoint accepts and returns, use the provider's own reference:
<https://apidocs.checkoutchamp.com/>.

---

## 1. Install

```bash
npm install @astermd-hq/checkoutchamp-client
```

Requires **Node.js 22 or newer**. There are no runtime dependencies, so the
package will not drag anything else into your application.

---

## 2. Read this before you deploy

The Checkout Champ API takes `loginId` and `password` as **URL query string
parameters**, and every other parameter with them. Your account password is in
the URL of every request.

That is the provider's design and this client follows it, but it changes what
"secure deployment" means for you:

| Risk                                                     | What to do                                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| A forward proxy or egress gateway logs full request URLs | Audit it. Turn URL logging off for this host, or route around it.                      |
| An APM agent captures outbound HTTP URLs                 | Check its redaction config before enabling it on these calls.                          |
| A TLS-inspecting appliance sits in the path              | It sees the password in cleartext. Confirm what it retains.                            |
| Someone sets `debugRedact: false`                        | Your password and full card numbers land on disk. Keep it off outside local debugging. |

This package always verifies TLS certificates and offers no switch to disable
that — without verification, credentials in a URL are readable by anyone on
the path.

If you can get confirmation from Checkout Champ support that the API accepts
credentials in an `application/x-www-form-urlencoded` POST body, that is a
strictly better arrangement and worth raising as a change request.

---

## 3. Supply credentials

Both credentials are **required constructor arguments that you pass in**. The
package has no credential discovery of any kind: it ships no defaults, reads no
environment variables, opens no config file, and consults no global state.
Whatever you hand the constructor is what it uses.

```ts
import { API } from '@astermd-hq/checkoutchamp-client';

const api = new API(loginId, password);
```

That is deliberate. Credentials can never arrive from somewhere you did not
intend, and nothing changes behaviour between machines because of an
environment difference.

Where _you_ get `loginId` and `password` from is entirely your decision — a
secrets manager, your application's configuration, or a per-account record in
your own database. The package neither knows nor cares.

### Multiple Checkout Champ accounts

Because credentials are constructor arguments rather than ambient
configuration, integrating several accounts is just several instances. Nothing
is shared or cached between them:

```ts
interface Account {
  loginId: string;
  password: string;
  host?: string;
}

function checkoutChampFor(account: Account): API {
  return new API(account.loginId, account.password, {
    host: account.host ?? 'api.checkoutchamp.com',
  });
}
```

Build the client at the point of use, from the account you are acting for.
Avoid a single process-wide instance unless you genuinely only ever talk to
one account.

### Handling the credentials themselves

If either credential has ever been committed, captured in a proxy log, or
pasted into a ticket, rotate it — removing it from a file does not un-expose
it. Given that this API puts the password in the request URL (see section 2),
treat rotation as routine rather than exceptional.

---

## 4. Choose the host

The client takes a **bare hostname** and builds the scheme and path itself:

```ts
new API(id, pw, { host: 'api.checkoutchamp.com' }); // fine
new API(id, pw, { host: 'https://api.checkoutchamp.com' }); // throws
new API(id, pw, { host: 'api.checkoutchamp.com/v1' }); // throws
new API(id, pw, { host: 'api.checkoutchamp.com', basePath: 'v1' }); // fine
```

`host` is checked against a strict allowlist: dot-separated labels of ASCII
letters, digits and hyphens, with an optional numeric `:port`. A scheme, a
path, a query string, userinfo (`@`) or a backslash are all rejected.

Omitting `host` gives you `api.checkoutchamp.com`. If your account is issued a
different hostname, pass it — the client applies no environment branching of
its own, so a test account is reached the same way as production. Keep the
host in configuration so one build can be pointed at either.

---

## 5. Make a call and read the result

Every resource method returns a call object that has not been sent yet — no
request happens until you read it.

```ts
const { response } = await api.orderQuery({ orderId: '123' }).getInObject();
```

| Accessor        | `response` contains            |
| --------------- | ------------------------------ |
| `get()`         | the provider's raw JSON string |
| `getInObject()` | that JSON decoded to a value   |

This package adds **no envelope of its own** — what you get back is what
Checkout Champ sent, so consult their reference for the `result` / `message`
shape of each endpoint.

Pass `true` to add a `payload` key with the endpoint called and the parameters
you sent. It never includes your credentials, so it is safe to attach to your
own error reports:

```ts
const { response, payload } = await api.orderQuery({ orderId: '123' }).getInObject(true);
```

Reading the same call object twice does not repeat the request — the exchange
happens once, on the first accessor used, and every accessor after that reads
the cached result:

```ts
const call = api.orderQuery({ orderId: '123' });
const decoded = await call.getInObject();
const info = await call.getPayloadInfo(); // no second request
```

---

## 6. Handle failures

Three distinct failure modes, surfacing differently. Handling all three is the
difference between a robust integration and a fragile one.

### a. Your mistake — a `CheckoutChampError`

Thrown for an empty credential, a host that is not bare, an unknown method
passed to `api.call()`, or a response that is not valid JSON.

```ts
import { CheckoutChampError } from '@astermd-hq/checkoutchamp-client';

try {
  const { response } = await api.orderQuery({ orderId: id }).getInObject();
} catch (e) {
  if (e instanceof CheckoutChampError) {
    report(e);
  }
}
```

Note that a non-JSON response raises this too — an HTML error page from a load
balancer, for example, arrives as an exception rather than as data.

### b. The provider rejected the request

Not an exception. Checkout Champ reports it in its own response body:

```ts
const { response } = await api.orderQuery({ orderId: id }).getInObject();
const body = response as { result?: string; message?: unknown };

if (body.result !== 'SUCCESS') {
  const message = body.message ?? 'unknown error';
}
```

### c. The request never arrived

A DNS failure, a timeout, a TLS problem. Also not an exception:

```ts
const { response } = await api.orderQuery().getInObject();
const body = response as { curlError?: string };

if (body.curlError !== undefined) {
  // transport failure — safe to retry
}
```

`get()` surfaces the same failure as the bare message string instead of a
`curlError` key — check which accessor you used before branching on the shape.

### Timeouts and retries

Defaults are 30 s transfer, 10 s connect. Tighten them for user-facing paths
and widen them for background jobs:

```ts
const interactive = new API(id, pw, { timeout: 5, connectTimeout: 2 });
const batch = new API(id, pw, { timeout: 120, connectTimeout: 10 });
```

The package performs no retries — that policy belongs in your job runner, where
it can be observed and bounded. Retry on `curlError`. **Do not blindly retry
`importOrder`, `preauth`, `importUpsale` or `qa`** — they move money or change
order state and are not idempotent.

---

## 7. Logging in production

Logging is off unless you enable it, and enabling it needs a destination —
either `debugFile` or `debugSink` — or construction throws.

```ts
const api = new API(id, pw, {
  debug: true,
  debugFile: '/var/log/checkoutchamp/client.log',
  debugRetentionDays: 7,
  debugTimezone: 'UTC',
});
```

- Redaction is on by default and **covers the URL**, which is what keeps your
  password out of the log. Leave it on.
- One file per day: `client-2026-08-16.log`, `client-2026-08-17.log`, …
- Files older than the retention window are pruned once per process. Pruning
  matches only this package's own dated pattern and reads the date from the
  filename, never the mtime. `debugRetentionDays: 7` keeps eight calendar
  dates, not seven — see the README for the exact fencepost.
- Point `debugFile` at a directory your process can write to and your
  application does not serve. Never under a public document root.

### Awaiting the log before exit

Writes go through Node's asynchronous filesystem API, so a short-lived process
— a CLI command, a one-shot script, a serverless function about to freeze or
return — can exit before a queued entry reaches disk. Await
`api.flushDebugLog()` before such a process ends if the log matters:

```ts
async function handler(): Promise<void> {
  await api.importOrder({ sessionId: 'sess_1' }).getInObject();
  await api.flushDebugLog();
}
```

It resolves immediately when logging is off, so it is safe to call
unconditionally at the end of a request handler.

### Shipping elsewhere

A `debugSink` function replaces the file sink entirely — the package then
writes no files, and retention becomes yours. The function may be asynchronous;
the logger serializes calls to it on its own queue, so a slow destination
cannot interleave two entries mid-write:

```ts
const api = new API(id, pw, {
  debug: true,
  debugSink: async (entry: string): Promise<void> => {
    await shipToExternalDestination(entry);
  },
});
```

Anything the sink throws, or a promise it returns that rejects, is caught and
discarded; a logging failure will not break an API call. Because the sink can
be asynchronous, `flushDebugLog()` still matters here — it awaits the
logger's own queue of pending sink invocations, not just a file write.

### What a redacted entry looks like

```
curl --location --request POST 'https://api.checkoutchamp.com/order/import/?sessionId=sess_1&cardNumber=[REDACTED]&cvv=[REDACTED]&loginId=[REDACTED]&password=[REDACTED]'

# Response: HTTP 200
{"result":"SUCCESS","message":{"orderId":"123"}}
```

The endpoint and the ordinary parameters stay readable, which is what makes the
entry useful for support. Redacted logs are still sensitive — they record who
touched what and when. Encrypt at rest, restrict read access, and retain them
no longer than the order data they describe.

---

## 8. Testing your own code

Inject a fake transport instead of stubbing the client:

```ts
import { API, type HttpClientInterface, type Request, Response } from '@astermd-hq/checkoutchamp-client';

class FakeCheckoutChamp implements HttpClientInterface {
  public lastRequest: Request | null = null;

  async send(request: Request): Promise<Response> {
    this.lastRequest = request;

    return new Response(200, '{"result":"SUCCESS"}', { http_code: 200 });
  }
}

const transport = new FakeCheckoutChamp();
const api = new API('test-login', 'test-password', {}, transport);

await api.orderQuery({ orderId: '123' }).getInObject();

console.assert(transport.lastRequest?.url.startsWith('https://api.checkoutchamp.com/order/query/?'));
```

Use obviously fake credentials. Never a real login, not even an expired one.

---

## 9. Reusing the client

A single `API` instance is safe to reuse across many calls, including calls
issued concurrently. Every call gets its own `PendingCall`, so parameters and
state from one call cannot leak into another — this is a structural
difference from the Composer package, whose client-level accessors read
shared "last call" state and are only safe one request at a time.

One caveat: `withProxy()` applies to the **next call only** and then clears
itself. Chain it immediately before the call it is meant for.

---

## 10. Troubleshooting

| Symptom                                     | Cause                                                                                     | Fix                                                                   |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `A login ID and password are required`      | One credential empty                                                                      | Check the values you passed to the constructor — nothing is defaulted |
| `The host must be a bare hostname…`         | A full URL, path, or disallowed character in `host`                                       | Strip the scheme, move any path to `basePath`                         |
| `Debug logging needs either a "debugFile"…` | `debug: true` with no destination                                                         | Add `debugFile` or `debugSink`                                        |
| `No such method found`                      | A typo passed to `api.call()`, or a method this client does not implement                 | `API.supportedMethods()` lists all 14                                 |
| `API response is not valid JSON`            | An HTML error page from a proxy or load balancer                                          | Inspect with `get()` before decoding                                  |
| `curlError` on every call                   | Network, DNS, TLS or firewall                                                             | Verify the host and that egress to it is allowed                      |
| Auth failures despite correct credentials   | A parameter named `loginId`/`password` in your own params                                 | Harmless — credentials are appended last and always win               |
| No log file appears                         | Directory not writable, `debug` still off, or the process exited before `flushDebugLog()` | Check permissions, and await `flushDebugLog()` before exit            |

---

## 11. Migrating from the PHP package

See the [README's migration table](../README.md#migrating-from-the-php-package)
for the accessor and option-name changes. Behaviour worth double-checking when
you port an integration over:

- `getInArray()` has no equivalent because there is nothing to distinguish it
  from — `getInObject()` is the only decoding accessor.
- The client-level `get()` / `getInArray()` / `getInObject()` are gone. Read
  the result off the call object each resource method returns.
- `headerRequired` is passed per call, as the second argument, not set as a
  property on a resource.
- Debug log timestamps carry millisecond precision, not true microseconds —
  the fractional part is a zero-padded millisecond value.
- Call `await api.flushDebugLog()` before a short-lived process exits. PHP's
  synchronous file write had no equivalent hazard.
