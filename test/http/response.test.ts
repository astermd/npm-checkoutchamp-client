import { describe, expect, it } from 'vitest';
import { Response } from '../../src/http/response.js';

describe('Response', () => {
  it('carries the status code and body', () => {
    const response = new Response(200, '{"ok":true}');
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('{"ok":true}');
  });

  it('defaults to empty transport info and no transport error', () => {
    const response = new Response(200, '');
    expect(response.info).toEqual({});
    expect(response.transportError).toBe('');
    expect(response.hasTransportError()).toBe(false);
  });

  it('reports a transport error when one is present', () => {
    const response = new Response(0, '', {}, 'connect timed out');
    expect(response.hasTransportError()).toBe(true);
    expect(response.transportError).toBe('connect timed out');
  });

  it('exposes transport info under curl-shaped keys', () => {
    const response = new Response(200, '', { http_code: 200, total_time: 0.4 });
    expect(response.info.http_code).toBe(200);
    expect(response.info.total_time).toBe(0.4);
  });

  it('is frozen, including the info object', () => {
    const response = new Response(200, '', { http_code: 200 });
    expect(Object.isFrozen(response)).toBe(true);
    expect(Object.isFrozen(response.info)).toBe(true);
  });

  it('copies the info object, so a later mutation of the caller object is not seen', () => {
    const info = { http_code: 200 };
    const response = new Response(200, '', info);
    info.http_code = 500;
    expect(response.info.http_code).toBe(200);
  });
});
