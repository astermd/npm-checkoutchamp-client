import { describe, expect, it } from 'vitest';
import { ClientConfig } from '../src/client-config.js';
import { CheckoutChampError } from '../src/errors.js';
import { MESSAGES } from '../src/messages.js';

const LOGIN_ID = 'test-login-id-not-a-real-credential';
const PASSWORD = 'test-password-not-a-real-credential';

describe('ClientConfig', () => {
  it('defaults to the provider host over HTTPS', () => {
    const config = new ClientConfig(LOGIN_ID, PASSWORD);
    expect(config.host).toBe('api.checkoutchamp.com');
    expect(config.getBaseUrl()).toBe('https://api.checkoutchamp.com');
  });

  it('accepts an account-specific bare hostname', () => {
    const config = new ClientConfig(LOGIN_ID, PASSWORD, { host: 'crm.example.test' });
    expect(config.getBaseUrl()).toBe('https://crm.example.test');
  });

  it('appends a basePath below the host, trimming slashes', () => {
    const config = new ClientConfig(LOGIN_ID, PASSWORD, { basePath: '/v1/' });
    expect(config.basePath).toBe('v1');
    expect(config.getBaseUrl()).toBe('https://api.checkoutchamp.com/v1');
  });

  it('defaults the timeouts to 30 and 10 seconds', () => {
    const config = new ClientConfig(LOGIN_ID, PASSWORD);
    expect(config.timeout).toBe(30);
    expect(config.connectTimeout).toBe(10);
  });

  it('accepts caller-supplied timeouts', () => {
    const config = new ClientConfig(LOGIN_ID, PASSWORD, { timeout: 5, connectTimeout: 2 });
    expect(config.timeout).toBe(5);
    expect(config.connectTimeout).toBe(2);
  });

  it('rejects an empty login ID', () => {
    expect(() => new ClientConfig('', PASSWORD)).toThrow(new CheckoutChampError(MESSAGES.invalidApiAuth));
  });

  it('rejects a whitespace-only password', () => {
    expect(() => new ClientConfig(LOGIN_ID, '   ')).toThrow(new CheckoutChampError(MESSAGES.invalidApiAuth));
  });

  it('rejects a host carrying a scheme, so the client keeps control of HTTPS', () => {
    expect(() => new ClientConfig(LOGIN_ID, PASSWORD, { host: 'https://api.checkoutchamp.com' })).toThrow(
      new CheckoutChampError(MESSAGES.invalidHost),
    );
  });

  it('rejects a host carrying a path', () => {
    expect(() => new ClientConfig(LOGIN_ID, PASSWORD, { host: 'api.checkoutchamp.com/v1' })).toThrow(
      new CheckoutChampError(MESSAGES.invalidHost),
    );
  });

  it('rejects a host carrying a query string', () => {
    expect(() => new ClientConfig(LOGIN_ID, PASSWORD, { host: 'api.checkoutchamp.com?a=1' })).toThrow(
      new CheckoutChampError(MESSAGES.invalidHost),
    );
  });

  it('rejects a host carrying a space', () => {
    expect(() => new ClientConfig(LOGIN_ID, PASSWORD, { host: 'api.checkoutchamp.com extra' })).toThrow(
      new CheckoutChampError(MESSAGES.invalidHost),
    );
  });

  it('rejects a host that smuggles userinfo, which WHATWG URL would treat as a different host', () => {
    expect(() => new ClientConfig(LOGIN_ID, PASSWORD, { host: 'api.checkoutchamp.com@evil.test' })).toThrow(
      new CheckoutChampError(MESSAGES.invalidHost),
    );
  });

  it('rejects a host carrying credentials-shaped userinfo', () => {
    expect(() => new ClientConfig(LOGIN_ID, PASSWORD, { host: 'user:pass@evil.test' })).toThrow(
      new CheckoutChampError(MESSAGES.invalidHost),
    );
  });

  it('rejects a host carrying a backslash, an authority terminator for special schemes', () => {
    expect(() => new ClientConfig(LOGIN_ID, PASSWORD, { host: 'evil.test\\@api.checkoutchamp.com' })).toThrow(
      new CheckoutChampError(MESSAGES.invalidHost),
    );
  });

  it('rejects a host carrying a fragment separator', () => {
    expect(() => new ClientConfig(LOGIN_ID, PASSWORD, { host: 'api.checkoutchamp.com#evil.test' })).toThrow(
      new CheckoutChampError(MESSAGES.invalidHost),
    );
  });

  it('rejects a host with a leading dot', () => {
    expect(() => new ClientConfig(LOGIN_ID, PASSWORD, { host: '.api.checkoutchamp.com' })).toThrow(
      new CheckoutChampError(MESSAGES.invalidHost),
    );
  });

  it('rejects a host with a trailing dot', () => {
    expect(() => new ClientConfig(LOGIN_ID, PASSWORD, { host: 'api.checkoutchamp.com.' })).toThrow(
      new CheckoutChampError(MESSAGES.invalidHost),
    );
  });

  it('rejects a host with an empty label', () => {
    expect(() => new ClientConfig(LOGIN_ID, PASSWORD, { host: 'a..b' })).toThrow(
      new CheckoutChampError(MESSAGES.invalidHost),
    );
  });

  it('accepts a bare host with a numeric port', () => {
    expect(new ClientConfig(LOGIN_ID, PASSWORD, { host: 'api.checkoutchamp.com:8443' }).host).toBe(
      'api.checkoutchamp.com:8443',
    );
  });

  it('accepts a punycode label', () => {
    expect(new ClientConfig(LOGIN_ID, PASSWORD, { host: 'xn--exmple-cua.test' }).host).toBe('xn--exmple-cua.test');
  });

  it('falls back to the default when host is whitespace-only', () => {
    expect(new ClientConfig(LOGIN_ID, PASSWORD, { host: '  ' }).host).toBe('api.checkoutchamp.com');
  });

  it('falls back to the default when host is an empty string', () => {
    expect(new ClientConfig(LOGIN_ID, PASSWORD, { host: '' }).host).toBe('api.checkoutchamp.com');
  });

  it('is frozen, so settings cannot drift after construction', () => {
    const config = new ClientConfig(LOGIN_ID, PASSWORD);
    expect(Object.isFrozen(config)).toBe(true);
  });
});
