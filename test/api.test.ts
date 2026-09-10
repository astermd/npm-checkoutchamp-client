import { describe, expect, it } from 'vitest';
import { API } from '../src/api.js';
import { CheckoutChampError } from '../src/errors.js';
import { Response } from '../src/http/response.js';
import { MESSAGES } from '../src/messages.js';
import { assertRequest, LOGIN_ID, PASSWORD } from './support/client-test-case.js';
import { MockHttpClient } from './support/mock-http-client.js';

function client(options = {}): { api: API; http: MockHttpClient } {
  const http = new MockHttpClient();

  return { api: new API(LOGIN_ID, PASSWORD, options, http), http };
}

describe('API construction', () => {
  it('rejects an empty login ID', () => {
    expect(() => new API('', PASSWORD)).toThrow(new CheckoutChampError(MESSAGES.invalidApiAuth));
  });

  it('rejects an empty password', () => {
    expect(() => new API(LOGIN_ID, '')).toThrow(new CheckoutChampError(MESSAGES.invalidApiAuth));
  });

  it('rejects a host that is not bare', () => {
    expect(() => new API(LOGIN_ID, PASSWORD, { host: 'https://api.checkoutchamp.com' })).toThrow(
      new CheckoutChampError(MESSAGES.invalidHost),
    );
  });

  it('rejects debug logging with no destination', () => {
    expect(() => new API(LOGIN_ID, PASSWORD, { debug: true })).toThrow(
      new CheckoutChampError(MESSAGES.debugFileRequired),
    );
  });

  it('accepts a custom transport as the fourth argument', async () => {
    const { api, http } = client();
    await api.orderQuery({ orderId: '1' });
    expect(http.count()).toBe(1);
  });
});

describe('API dispatch', () => {
  it('lists every dispatchable method', () => {
    expect(API.supportedMethods()).toEqual([
      'orderQuery',
      'importLeads',
      'updateOrder',
      'preauth',
      'importOrder',
      'importUpsale',
      'confirm',
      'qa',
      'campaignQuery',
      'customerQuery',
      'addnote',
      'transactionsQuery',
      'importClick',
      'confirmPaypal',
    ]);
  });

  it('exposes every supported method as a real function', () => {
    const { api } = client();
    for (const name of API.supportedMethods()) {
      expect(typeof (api as unknown as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('routes each method to the endpoint the provider documents', async () => {
    const cases: [string, string][] = [
      ['orderQuery', '/order/query/'],
      ['importLeads', '/leads/import/'],
      ['updateOrder', '/order/update/'],
      ['preauth', '/order/preauth/'],
      ['importOrder', '/order/import/'],
      ['importUpsale', '/upsale/import/'],
      ['confirm', '/order/confirm/'],
      ['qa', '/order/qa/'],
      ['campaignQuery', '/campaign/query/'],
      ['customerQuery', '/customer/query/'],
      ['addnote', '/customer/addnote/'],
      ['transactionsQuery', '/transactions/query/'],
      ['importClick', '/landers/clicks/import/'],
      ['confirmPaypal', '/transactions/confirmPaypal/'],
    ];

    for (const [method, path] of cases) {
      const { api, http } = client();
      await api.call(method, { probe: '1' });
      assertRequest(http, path, { probe: '1' });
    }
  });

  it('throws for a method no resource implements', () => {
    const { api } = client();
    expect(() => api.call('nope')).toThrow(new CheckoutChampError(MESSAGES.methodNotFound));
  });

  it.each(['call', 'withProxy', 'flushDebugLog', 'prepare', 'constructor'])(
    'throws for %s, a name that collides with a member of API itself',
    name => {
      const { api, http } = client();
      expect(() => api.call(name)).toThrow(new CheckoutChampError(MESSAGES.methodNotFound));
      expect(http.count()).toBe(0);
    },
  );

  it('issues exactly one request per call', async () => {
    const { api, http } = client();
    await api.orderQuery({ a: '1' });
    await api.importOrder({ b: '2' });

    expect(http.count()).toBe(2);
  });

  it('keeps two concurrent calls independent', async () => {
    const { api } = client();

    const [first, second] = await Promise.all([
      api.orderQuery({ orderId: 'first' }).getPayloadInfo(),
      api.orderQuery({ orderId: 'second' }).getPayloadInfo(),
    ]);

    expect(first.orderId).toBe('first');
    expect(second.orderId).toBe('second');
  });
});

describe('API reading a response', () => {
  it('returns the decoded provider body with no envelope of its own', async () => {
    const http = new MockHttpClient().queue(
      new Response(200, '{"result":"SUCCESS","message":{"orderId":"123"}}', { http_code: 200 }),
    );
    const api = new API(LOGIN_ID, PASSWORD, {}, http);

    await expect(api.orderQuery({ orderId: '123' }).getInObject()).resolves.toEqual({
      response: { result: 'SUCCESS', message: { orderId: '123' } },
    });
  });

  it('returns the raw JSON string from get()', async () => {
    const http = new MockHttpClient().queue(new Response(200, '{"a":1}', { http_code: 200 }));
    const api = new API(LOGIN_ID, PASSWORD, {}, http);

    await expect(api.orderQuery().get()).resolves.toEqual({ response: '{"a":1}' });
  });

  it('includes the credential-free payload when asked', async () => {
    const { api } = client();

    await expect(api.orderQuery({ orderId: '123' }).getInObject(true)).resolves.toEqual({
      response: { ok: true },
      payload: { endPoint: 'https://api.checkoutchamp.com/order/query/', orderId: '123' },
    });
  });

  it('raises for a response that is not JSON', async () => {
    const http = new MockHttpClient().queue(new Response(200, '<html>', { http_code: 200 }));
    const api = new API(LOGIN_ID, PASSWORD, {}, http);

    await expect(api.orderQuery().getInObject()).rejects.toThrow(new CheckoutChampError(MESSAGES.jsonFormatError));
  });

  it('surfaces a transport failure as curlError rather than throwing', async () => {
    const http = new MockHttpClient().queue(new Response(0, '', {}, 'connect timed out'));
    const api = new API(LOGIN_ID, PASSWORD, {}, http);

    await expect(api.orderQuery().getInObject()).resolves.toEqual({
      response: { curlError: 'connect timed out' },
    });
  });
});

describe('API.withProxy', () => {
  it('routes the next call through the proxy', async () => {
    const { api, http } = client();
    await api.withProxy('proxy.example.test:8080', 'u', 'pw').orderQuery();

    expect(http.lastRequest().proxyUrl).toBe('proxy.example.test:8080');
    expect(http.lastRequest().proxyCredentials).toBe('u:pw');
  });

  it('applies to the next call only', async () => {
    const { api, http } = client();
    await api.withProxy('proxy.example.test:8080').orderQuery();
    await api.orderQuery();

    expect(http.lastRequest().proxyUrl).toBeNull();
  });

  it('carries the proxy across a resource boundary', async () => {
    const { api, http } = client();
    await api.withProxy('proxy.example.test:8080').campaignQuery();

    expect(http.lastRequest().proxyUrl).toBe('proxy.example.test:8080');
  });

  it('ignores an empty proxy address', async () => {
    const { api, http } = client();
    await api.withProxy('').orderQuery();

    expect(http.lastRequest().proxyUrl).toBeNull();
  });

  it('returns the client, so the call chains', () => {
    const { api } = client();
    expect(api.withProxy('proxy.example.test:8080')).toBe(api);
  });
});

describe('API.flushDebugLog', () => {
  it('resolves even when logging is off', async () => {
    const { api } = client();
    await expect(api.flushDebugLog()).resolves.toBeUndefined();
  });

  it('drains a caller-supplied sink', async () => {
    const entries: string[] = [];
    const http = new MockHttpClient();
    const api = new API(
      LOGIN_ID,
      PASSWORD,
      {
        debug: true,
        debugSink: async entry => {
          await new Promise(resolve => setTimeout(resolve, 5));
          entries.push(entry);
        },
      },
      http,
    );

    await api.orderQuery({ orderId: '1' });
    await api.flushDebugLog();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toContain('password=[REDACTED]');
  });
});
