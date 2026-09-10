import { describe, expect, it } from 'vitest';
import { CallResult } from '../src/call-result.js';
import { ClientConfig } from '../src/client-config.js';
import { CheckoutChamp } from '../src/checkout-champ.js';
import { DebugLogger } from '../src/logging/debug-logger.js';
import { Response } from '../src/http/response.js';
import { MockHttpClient } from './support/mock-http-client.js';

const LOGIN_ID = 'test-login-id-not-a-real-credential';
const PASSWORD = 'test-password-not-a-real-credential';

/** Minimal concrete resource, standing in for Order in these unit tests. */
class Probe extends CheckoutChamp {
  public run(params: Record<string, unknown> = {}, options = {}) {
    return this.sendPost('order', 'query', params, options);
  }

  /**
   * Like {@link run}, but with a caller-chosen section and method, so a test
   * can feed a space through the path segments specifically.
   */
  public runAt(section: string, method: string, params: Record<string, unknown> = {}) {
    return this.sendPost(section, method, params, {});
  }
}

function probe(http = new MockHttpClient()): { resource: Probe; http: MockHttpClient } {
  const resource = new Probe(new ClientConfig(LOGIN_ID, PASSWORD), http, DebugLogger.fromOptions({}));

  return { resource, http };
}

describe('CheckoutChamp.sendPost', () => {
  it('POSTs to section/method/ below the base URL', async () => {
    const { resource, http } = probe();
    await resource.run({ orderId: '123' });

    const request = http.lastRequest();
    expect(request.method).toBe('POST');
    expect(request.url.split('?')[0]).toBe('https://api.checkoutchamp.com/order/query/');
  });

  it('sends no headers and no body, because everything rides in the query', async () => {
    const { resource, http } = probe();
    await resource.run();

    expect(http.lastRequest().headers).toEqual([]);
    expect(http.lastRequest().body).toBeNull();
  });

  it('appends the credentials after the caller parameters', async () => {
    const { resource, http } = probe();
    await resource.run({ orderId: '123' });

    expect(http.lastRequest().url).toBe(
      `https://api.checkoutchamp.com/order/query/?orderId=123&loginId=${LOGIN_ID}&password=${PASSWORD}`,
    );
  });

  it('cannot have its credentials shadowed by a caller parameter', async () => {
    const { resource, http } = probe();
    await resource.run({ password: 'attacker', loginId: 'attacker' });

    const query = new URLSearchParams(http.lastRequest().url.split('?')[1]);
    // Spreading the credentials last overwrites the caller's key rather than
    // adding a second one, exactly as PHP's array_merge does. One parameter
    // reaches the wire, and it carries the configured value.
    expect(query.getAll('password')).toEqual([PASSWORD]);
    expect(query.getAll('loginId')).toEqual([LOGIN_ID]);
  });

  it('honours a basePath below the host', async () => {
    const resource = new Probe(
      new ClientConfig(LOGIN_ID, PASSWORD, { basePath: 'v1' }),
      new MockHttpClient(),
      DebugLogger.fromOptions({}),
    );
    const result = await resource.run();

    expect(result.getPayloadInfo().endPoint).toBe('https://api.checkoutchamp.com/v1/order/query/');
  });

  it('strips spaces from the assembled path only, leaving the query untouched', async () => {
    const { resource, http } = probe();
    // The section and method carry spaces on purpose, and the field value
    // does too, so the two assertions below can only both pass if stripping
    // is applied to the path segments and not to the query string.
    await resource.runAt('or der', 'que ry', { note: 'a b' });

    const [path, query] = http.lastRequest().url.split('?');
    expect(path).toBe('https://api.checkoutchamp.com/order/query/');
    expect(new URLSearchParams(query).get('note')).toBe('a b');
  });
});

describe('PendingCall', () => {
  it('is awaitable, resolving to a CallResult', async () => {
    const { resource } = probe();
    await expect(resource.run()).resolves.toBeInstanceOf(CallResult);
  });

  it('does not send anything until it is awaited', () => {
    const { resource, http } = probe();
    resource.run({ orderId: '1' });

    expect(http.count()).toBe(0);
  });

  it('sends exactly once however many accessors are used', async () => {
    const { resource, http } = probe();
    const call = resource.run();

    await call.get();
    await call.getInObject();
    await call;

    expect(http.count()).toBe(1);
  });

  it('reads the decoded response through getInObject()', async () => {
    const http = new MockHttpClient().queue(new Response(200, '{"result":"SUCCESS"}', { http_code: 200 }));
    const { resource } = probe(http);

    await expect(resource.run().getInObject()).resolves.toEqual({
      response: { result: 'SUCCESS' },
    });
  });

  it('reads the raw response through get()', async () => {
    const http = new MockHttpClient().queue(new Response(200, 'raw', { http_code: 200 }));
    const { resource } = probe(http);

    await expect(resource.run().get()).resolves.toEqual({ response: 'raw' });
  });

  it('returns the credential-free payload', async () => {
    const { resource } = probe();

    await expect(resource.run({ orderId: '1' }).getPayloadInfo()).resolves.toEqual({
      endPoint: 'https://api.checkoutchamp.com/order/query/',
      orderId: '1',
    });
  });

  it('supports the two-step form, with sync accessors after the await', async () => {
    const { resource } = probe();
    const result = await resource.run({ orderId: '1' });

    expect(result.getInObject()).toEqual({ response: { ok: true } });
    expect(result.getPayloadInfo().orderId).toBe('1');
  });

  it('honours headerRequired', async () => {
    const { resource } = probe();
    const result = await resource.run({}, { headerRequired: true });

    expect(result.getInObject()).toEqual({
      response: { content: { ok: true }, header: { http_code: 200 } },
    });
  });

  it('keeps two concurrent calls on one resource independent', async () => {
    const { resource, http } = probe();

    const [first, second] = await Promise.all([
      resource.run({ orderId: 'first' }).getPayloadInfo(),
      resource.run({ orderId: 'second' }).getPayloadInfo(),
    ]);

    expect(first.orderId).toBe('first');
    expect(second.orderId).toBe('second');
    expect(http.count()).toBe(2);
  });

  it('routes through a proxy set immediately before the call, once', async () => {
    const { resource, http } = probe();

    resource.setProxy('proxy.example.test:8080', 'u', 'pw');
    await resource.run();
    expect(http.lastRequest().proxyUrl).toBe('proxy.example.test:8080');
    expect(http.lastRequest().proxyCredentials).toBe('u:pw');

    await resource.run();
    expect(http.lastRequest().proxyUrl).toBeNull();
  });

  it('omits proxy credentials when no username is given', async () => {
    const { resource, http } = probe();

    resource.setProxy('proxy.example.test:8080');
    await resource.run();

    expect(http.lastRequest().proxyCredentials).toBeNull();
  });
});
