import { expect } from 'vitest';
import { ClientConfig, type ClientOptions } from '../../src/client-config.js';
import type { Request } from '../../src/http/request.js';
import { DebugLogger } from '../../src/logging/debug-logger.js';
import { MockHttpClient } from './mock-http-client.js';

/** Obviously fake placeholders. Never real credentials. */
export const LOGIN_ID = 'test-login-id-not-a-real-credential';

/** Obviously fake placeholders. Never real credentials. */
export const PASSWORD = 'test-password-not-a-real-credential';

/** The default base URL every assertion is written against. */
export const BASE_URL = 'https://api.checkoutchamp.com';

/**
 * Build the three collaborators every resource takes.
 *
 * @param options Client options, defaulting to none.
 *
 * @returns A config, a recording transport, and a disabled logger.
 */
export function makeDeps(options: ClientOptions = {}): {
  config: ClientConfig;
  http: MockHttpClient;
  logger: DebugLogger;
} {
  return {
    config: new ClientConfig(LOGIN_ID, PASSWORD, options),
    http: new MockHttpClient(),
    logger: DebugLogger.fromOptions(options),
  };
}

/**
 * Assert the recorded request matches the expected shape.
 *
 * Every Checkout Champ call is a POST with no headers and no body; all
 * parameters, credentials included, ride in the query string. This checks all
 * four of those, and that the credentials are present exactly once with the
 * configured values.
 *
 * @param http           The recording transport.
 * @param path           Path below the host, e.g. `/order/query/`.
 * @param expectedParams The caller's parameters, credentials excluded.
 *
 * @returns The recorded request, for any further assertion.
 */
export function assertRequest(
  http: MockHttpClient,
  path: string,
  expectedParams: Record<string, string> = {},
): Request {
  const request = http.lastRequest();

  expect(request.method).toBe('POST');
  expect(request.body).toBeNull();
  expect(request.headers).toEqual([]);

  const separator = request.url.indexOf('?');
  expect(separator).toBeGreaterThan(-1);
  expect(request.url.slice(0, separator)).toBe(`${BASE_URL}${path}`);

  const query = new URLSearchParams(request.url.slice(separator + 1));

  expect(query.getAll('loginId')).toEqual([LOGIN_ID]);
  expect(query.getAll('password')).toEqual([PASSWORD]);

  const received: Record<string, string> = {};
  for (const [key, value] of query.entries()) {
    if (key !== 'loginId' && key !== 'password') {
      received[key] = value;
    }
  }
  expect(received).toEqual(expectedParams);

  return request;
}
