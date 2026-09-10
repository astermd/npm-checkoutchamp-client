import { describe, expect, it } from 'vitest';
import { CallResult } from '../src/call-result.js';
import { CheckoutChampError } from '../src/errors.js';
import { Response } from '../src/http/response.js';
import { MESSAGES } from '../src/messages.js';

const URL = 'https://api.checkoutchamp.com/order/query/';
const OK = new Response(200, '{"result":"SUCCESS"}', { http_code: 200 });
const FAILED = new Response(0, '', {}, 'connect timed out');

describe('CallResult', () => {
  it('returns the raw body from get()', () => {
    expect(new CallResult(URL, {}, OK, false).get()).toEqual({
      response: '{"result":"SUCCESS"}',
    });
  });

  it('returns the decoded body from getInObject()', () => {
    expect(new CallResult(URL, {}, OK, false).getInObject()).toEqual({
      response: { result: 'SUCCESS' },
    });
  });

  it('omits the payload unless asked for it', () => {
    expect(new CallResult(URL, { orderId: '1' }, OK, false).getInObject()).not.toHaveProperty('payload');
  });

  it('includes the endpoint and the caller parameters when asked', () => {
    expect(new CallResult(URL, { orderId: '1' }, OK, false).getInObject(true)).toEqual({
      response: { result: 'SUCCESS' },
      payload: { endPoint: URL, orderId: '1' },
    });
  });

  it('never puts credentials in the payload, so it is safe to surface', () => {
    const payload = new CallResult(URL, { orderId: '1' }, OK, false).getPayloadInfo();
    expect(payload).toEqual({ endPoint: URL, orderId: '1' });
    expect(payload).not.toHaveProperty('loginId');
    expect(payload).not.toHaveProperty('password');
  });

  it('reports the endpoint without its query string', () => {
    expect(new CallResult(URL, {}, OK, false).getPayloadInfo().endPoint).toBe(URL);
  });

  it('throws when the body is not valid JSON', () => {
    const result = new CallResult(URL, {}, new Response(200, 'not json', { http_code: 200 }), false);
    expect(() => result.getInObject()).toThrow(new CheckoutChampError(MESSAGES.jsonFormatError));
  });

  it('does not throw for a non-JSON body when reading it raw', () => {
    const result = new CallResult(URL, {}, new Response(200, 'not json', { http_code: 200 }), false);
    expect(result.get()).toEqual({ response: 'not json' });
  });

  it('surfaces a transport failure as curlError from getInObject()', () => {
    expect(new CallResult(URL, {}, FAILED, false).getInObject()).toEqual({
      response: { curlError: 'connect timed out' },
    });
  });

  it('surfaces a transport failure as the bare message from get()', () => {
    expect(new CallResult(URL, {}, FAILED, false).get()).toEqual({
      response: 'connect timed out',
    });
  });

  it('still returns the payload alongside a transport failure', () => {
    expect(new CallResult(URL, { orderId: '1' }, FAILED, false).getInObject(true)).toEqual({
      response: { curlError: 'connect timed out' },
      payload: { endPoint: URL, orderId: '1' },
    });
  });

  it('wraps the raw body with transport info when headerRequired is set', () => {
    expect(new CallResult(URL, {}, OK, true).get()).toEqual({
      response: { content: '{"result":"SUCCESS"}', header: { http_code: 200 } },
    });
  });

  it('wraps the decoded body with transport info when headerRequired is set', () => {
    expect(new CallResult(URL, {}, OK, true).getInObject()).toEqual({
      response: { content: { result: 'SUCCESS' }, header: { http_code: 200 } },
    });
  });

  it('does not wrap a transport failure even when headerRequired is set', () => {
    expect(new CallResult(URL, {}, FAILED, true).get()).toEqual({
      response: 'connect timed out',
    });
    expect(new CallResult(URL, {}, FAILED, true).getInObject()).toEqual({
      response: { curlError: 'connect timed out' },
    });
  });

  it('returns a fresh payload object each time, so a caller cannot poison it', () => {
    const result = new CallResult(URL, { orderId: '1' }, OK, false);
    const first = result.getPayloadInfo();
    first.orderId = 'tampered';
    expect(result.getPayloadInfo().orderId).toBe('1');
  });
});
