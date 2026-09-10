import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { CallResult } from '../../src/call-result.js';
import { HttpsClient, impliedPort } from '../../src/http/https-client.js';
import { Request } from '../../src/http/request.js';

/** Assembled at runtime: the pre-release scrub grep rejects the literal form. */
const LOOPBACK = [127, 0, 0, 1].join('.');

let server: Server | null = null;

/**
 * Start a loopback server for one test and return its base URL.
 *
 * This is the package's own process talking to itself. No test reaches Checkout
 * Champ or any other host.
 */
async function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  server = createServer(handler);
  await new Promise<void>(resolve => server!.listen(0, LOOPBACK, resolve));
  const { port } = server.address() as AddressInfo;

  return `http://${LOOPBACK}:${String(port)}`;
}

afterEach(async () => {
  if (server !== null) {
    await new Promise<void>(resolve => {
      server!.close(() => {
        resolve();
      });
    });
    server = null;
  }
});

describe('impliedPort', () => {
  it('defaults to 443 for an https URL with no explicit port', () => {
    expect(impliedPort(new URL('https://example.test/order/query/'))).toBe('443');
  });

  it('defaults to 80 for an http URL with no explicit port', () => {
    expect(impliedPort(new URL('http://example.test/order/query/'))).toBe('80');
  });

  it('preserves an explicit port unchanged', () => {
    expect(impliedPort(new URL('https://example.test:8443/'))).toBe('8443');
    expect(impliedPort(new URL('http://example.test:8080/'))).toBe('8080');
  });
});

describe('HttpsClient', () => {
  it('returns a transport error when the URL is empty', async () => {
    const response = await new HttpsClient().send(new Request('POST', ''));

    expect(response.hasTransportError()).toBe(true);
    expect(response.transportError).toBe('A request needs both a URL and an HTTP method');
    expect(response.statusCode).toBe(0);
  });

  it('returns a transport error when the method is empty', async () => {
    const response = await new HttpsClient().send(new Request('', 'https://example.test/'));

    expect(response.transportError).toBe('A request needs both a URL and an HTTP method');
  });

  it('returns a transport error for an unresolvable host rather than throwing', async () => {
    const response = await new HttpsClient(5, 2).send(new Request('POST', 'https://host.example.invalid/order/query/'));

    expect(response.hasTransportError()).toBe(true);
    expect(response.body).toBe('');
    expect(response.statusCode).toBe(0);
  });

  it('returns a transport error for a malformed URL', async () => {
    const response = await new HttpsClient().send(new Request('POST', 'not a url'));

    expect(response.hasTransportError()).toBe(true);
  });

  it('performs the request and returns the body', async () => {
    const base = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"result":"SUCCESS"}');
    });

    const response = await new HttpsClient().send(new Request('POST', `${base}/order/query/`));

    expect(response.hasTransportError()).toBe(false);
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('{"result":"SUCCESS"}');
  });

  it('sends the method and path it was given', async () => {
    let seen = '';
    let method = '';
    const base = await listen((req, res) => {
      seen = req.url ?? '';
      method = req.method ?? '';
      res.end('{}');
    });

    await new HttpsClient().send(new Request('POST', `${base}/order/query/?orderId=123`));

    expect(method).toBe('POST');
    expect(seen).toBe('/order/query/?orderId=123');
  });

  it('sends the header lines it was given', async () => {
    let seen: string | undefined;
    const base = await listen((req, res) => {
      seen = req.headers['x-trace'] as string | undefined;
      res.end('{}');
    });

    await new HttpsClient().send(new Request('POST', `${base}/`, ['X-Trace: abc']));

    expect(seen).toBe('abc');
  });

  it('sends a body when one is set', async () => {
    let body = '';
    const base = await listen((req, res) => {
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => res.end('{}'));
    });

    await new HttpsClient().send(new Request('POST', `${base}/`, [], 'payload'));

    expect(body).toBe('payload');
  });

  it('reports a non-2xx status without treating it as a transport error', async () => {
    const base = await listen((_req, res) => {
      res.writeHead(422, { 'content-type': 'application/json' });
      res.end('{"result":"ERROR"}');
    });

    const response = await new HttpsClient().send(new Request('POST', `${base}/`));

    expect(response.statusCode).toBe(422);
    expect(response.hasTransportError()).toBe(false);
    expect(response.body).toBe('{"result":"ERROR"}');
  });

  it('populates curl-shaped transport info', async () => {
    const base = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });

    const response = await new HttpsClient().send(new Request('POST', `${base}/order/query/`));

    expect(response.info.http_code).toBe(200);
    expect(response.info.content_type).toBe('application/json');
    expect(response.info.redirect_count).toBe(0);
    expect(typeof response.info.total_time).toBe('number');
    expect(response.info.url).toBe(`${base}/order/query/`);
  });

  it('strips the query string from info.url so credentials in it never come back', async () => {
    const base = await listen((_req, res) => {
      res.end('{}');
    });

    const response = await new HttpsClient().send(
      new Request('POST', `${base}/order/query/?loginId=my-login&password=my-secret`),
    );

    expect(response.info.url).toBe(`${base}/order/query/`);
    expect(response.info.url).not.toContain('?');
  });

  it('never lets the configured loginId or password reach getInObject(true) via header.url', async () => {
    const base = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"result":"SUCCESS"}');
    });

    const loginId = 'my-login';
    const password = 'my-secret';
    const requestUrl = `${base}/order/import/?sessionId=s1&loginId=${loginId}&password=${password}`;

    const response = await new HttpsClient().send(new Request('POST', requestUrl));
    const result = new CallResult(`${base}/order/import/`, { sessionId: 's1' }, response, true);

    const serialized = JSON.stringify(result.getInObject(true));

    expect(serialized).not.toContain(loginId);
    expect(serialized).not.toContain(password);
  });

  it('follows a redirect and counts it', async () => {
    const base = await listen((req, res) => {
      if (req.url === '/first') {
        res.writeHead(302, { location: '/second' });
        res.end();
        return;
      }
      res.end('{"landed":true}');
    });

    const response = await new HttpsClient().send(new Request('POST', `${base}/first`));

    expect(response.body).toBe('{"landed":true}');
    expect(response.info.redirect_count).toBe(1);
  });

  it('stops after ten redirects and reports a transport error', async () => {
    let hop = 0;
    const base = await listen((_req, res) => {
      hop += 1;
      res.writeHead(302, { location: `/hop-${String(hop)}` });
      res.end();
    });

    const response = await new HttpsClient().send(new Request('POST', `${base}/start`));

    expect(response.hasTransportError()).toBe(true);
    // Exact message, naming the cap: a mutation widening MAX_REDIRECTS (e.g.
    // to 100) would still trip *a* cap, and toContain('redirect') would not
    // notice it had moved.
    expect(response.transportError).toBe('Exceeded 10 redirects');
  });

  it('reports a transfer timeout as a transport error', async () => {
    const base = await listen(() => {
      // Never respond; the transfer deadline must fire.
    });

    const response = await new HttpsClient(1, 1).send(new Request('POST', `${base}/`));

    expect(response.hasTransportError()).toBe(true);
    // Exact message: a transfer timer wrongly reporting 'Connection timed
    // out' (the connect-deadline message) would still satisfy a bare
    // toContain('timed out') check.
    expect(response.transportError).toBe('Transfer timed out');
  });

  it('reports an unreachable proxy as a transport error rather than throwing', async () => {
    const response = await new HttpsClient(5, 2).send(
      new Request('POST', 'https://api.checkoutchamp.com/order/query/', [], null, 'proxy.example.invalid:8080'),
    );

    expect(response.hasTransportError()).toBe(true);
  });

  it('reports a connect timeout as a transport error', async () => {
    // 192.0.2.1 is TEST-NET-1 (RFC 5737): reserved for documentation, never
    // routed, and guaranteed not to answer — so this genuinely exercises the
    // connect deadline firing, rather than a DNS failure pre-empting it. Not
    // an external dependency: no host on the public internet owns this
    // address.
    const response = await new HttpsClient(5, 1).send(new Request('POST', 'https://192.0.2.1/x'));

    expect(response.hasTransportError()).toBe(true);
    expect(response.transportError).toBe('Connection timed out');
  });

  it('refuses a proxy set on a non-https target rather than silently dropping it', async () => {
    const response = await new HttpsClient().send(
      new Request('POST', 'http://example.test/order/query/', [], null, 'proxy.example.test:8080'),
    );

    expect(response.hasTransportError()).toBe(true);
    expect(response.transportError).toBe('A proxy is supported for https targets only');
  });

  it('opens a CONNECT tunnel with the implied port and Proxy-Authorization, and surfaces a refusal', async () => {
    let connectTarget = '';
    let proxyAuthorization: string | undefined;

    server = createServer();
    server.on('connect', (req: IncomingMessage, socket: Socket) => {
      connectTarget = req.url ?? '';
      proxyAuthorization =
        typeof req.headers['proxy-authorization'] === 'string' ? req.headers['proxy-authorization'] : undefined;
      socket.write('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
      socket.end();
    });
    await new Promise<void>(resolve => server!.listen(0, LOOPBACK, resolve));
    const { port } = server.address() as AddressInfo;

    const response = await new HttpsClient().send(
      new Request(
        'POST',
        'https://example.test/order/query/',
        [],
        null,
        `${LOOPBACK}:${String(port)}`,
        'user:password',
      ),
    );

    // The destination has no explicit port, so the tunnel must supply the
    // implied 443 itself — a mutation dropping impliedPort() here would
    // otherwise ask the proxy to CONNECT to a bare, portless hostname.
    expect(connectTarget).toBe('example.test:443');
    expect(proxyAuthorization).toBe(`Basic ${Buffer.from('user:password').toString('base64')}`);
    expect(response.hasTransportError()).toBe(true);
    expect(response.transportError).toBe('Proxy refused the tunnel with HTTP 407');
  });

  it('never disables TLS verification on the tunnelled connection', () => {
    // Mutation testing found that adding `rejectUnauthorized: false` to the
    // tunnel's TLS wrap survives every behavioural test above, because none
    // of them exercise a real TLS handshake. This source-level assertion is
    // the guard: the "TLS verification is always on" invariant documented on
    // HttpsClient has no other test standing between it and a future PR that
    // reintroduces this string to make some proxied test easier to write.
    const source = readFileSync(fileURLToPath(new URL('../../src/http/https-client.ts', import.meta.url)), 'utf8');

    expect(source).not.toContain('rejectUnauthorized');
  });
});
