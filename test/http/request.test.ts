import { describe, expect, it } from 'vitest';
import { Request } from '../../src/http/request.js';

describe('Request', () => {
  it('uppercases the method', () => {
    expect(new Request('post', 'https://api.checkoutchamp.com/order/query/').method).toBe('POST');
  });

  it('keeps the URL verbatim, query string included', () => {
    const url = 'https://api.checkoutchamp.com/order/query/?orderId=123';
    expect(new Request('POST', url).url).toBe(url);
  });

  it('defaults to no headers, no body and no proxy', () => {
    const request = new Request('POST', 'https://api.checkoutchamp.com/order/query/');
    expect(request.headers).toEqual([]);
    expect(request.body).toBeNull();
    expect(request.proxyUrl).toBeNull();
    expect(request.proxyCredentials).toBeNull();
  });

  it('carries raw header lines in order', () => {
    const request = new Request('POST', 'https://example.test/', ['A: 1', 'B: 2']);
    expect(request.headers).toEqual(['A: 1', 'B: 2']);
  });

  it('reports a proxy only when one is set to a non-empty value', () => {
    expect(new Request('POST', 'https://example.test/').hasProxy()).toBe(false);
    expect(new Request('POST', 'https://example.test/', [], null, '').hasProxy()).toBe(false);
    expect(new Request('POST', 'https://example.test/', [], null, 'proxy.example.test:8080').hasProxy()).toBe(true);
  });

  it('exposes proxy credentials as a single user:password string', () => {
    const request = new Request('POST', 'https://example.test/', [], null, 'p:8080', 'u:pw');
    expect(request.proxyCredentials).toBe('u:pw');
  });

  it('is frozen, so the debug logger cannot alter what is sent', () => {
    const request = new Request('POST', 'https://example.test/', ['A: 1']);
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.headers)).toBe(true);
  });

  it('copies the headers array, so a later mutation of the caller list is not seen', () => {
    const headers = ['A: 1'];
    const request = new Request('POST', 'https://example.test/', headers);
    headers.push('B: 2');
    expect(request.headers).toEqual(['A: 1']);
  });
});
