import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { CheckoutChampError } from '../../src/errors.js';
import { Request } from '../../src/http/request.js';
import { Response } from '../../src/http/response.js';
import { DebugLogger } from '../../src/logging/debug-logger.js';
import { FileSink } from '../../src/logging/file-sink.js';
import { MESSAGES } from '../../src/messages.js';

const URL_WITH_SECRETS =
  'https://api.checkoutchamp.com/order/import/?sessionId=sess_1&cardNumber=4111111111111111&loginId=abc&password=xyz';

function request(): Request {
  return new Request('POST', URL_WITH_SECRETS);
}

function response(): Response {
  return new Response(200, '{"result":"SUCCESS"}', { http_code: 200 });
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ccc-logger-'));
  FileSink.resetPruneState();
});

describe('DebugLogger.fromOptions', () => {
  it('is disabled by default', () => {
    expect(DebugLogger.fromOptions({}).isEnabled()).toBe(false);
  });

  it('redacts by default once enabled', () => {
    const logger = DebugLogger.fromOptions({ debug: true, debugSink: () => undefined });
    expect(logger.isEnabled()).toBe(true);
    expect(logger.isRedacting()).toBe(true);
  });

  it('honours debugRedact false', () => {
    const logger = DebugLogger.fromOptions({
      debug: true,
      debugRedact: false,
      debugSink: () => undefined,
    });
    expect(logger.isRedacting()).toBe(false);
  });

  it('requires a destination when debug is on', () => {
    expect(() => DebugLogger.fromOptions({ debug: true })).toThrow(new CheckoutChampError(MESSAGES.debugFileRequired));
  });

  it('rejects a debugSink that is not callable', () => {
    expect(() => DebugLogger.fromOptions({ debug: true, debugSink: 'nope' as unknown as () => void })).toThrow(
      new CheckoutChampError(MESSAGES.invalidDebugSink),
    );
  });

  it('rejects an unrecognised timezone', () => {
    expect(() => DebugLogger.fromOptions({ debugTimezone: 'Not/AZone' })).toThrow(
      new CheckoutChampError(MESSAGES.invalidTimezone),
    );
  });

  it('needs no destination when debug is off', () => {
    expect(() => DebugLogger.fromOptions({ debug: false })).not.toThrow();
  });

  it('prefers debugSink over debugFile when both are given', async () => {
    const entries: string[] = [];
    const logger = DebugLogger.fromOptions({
      debug: true,
      debugFile: join(dir, 'client.log'),
      debugSink: entry => {
        entries.push(entry);
      },
    });

    logger.log(request(), response());
    await logger.flush();

    expect(entries).toHaveLength(1);
    expect(await readdir(dir)).toEqual([]);
  });
});

describe('DebugLogger.format', () => {
  const logger = new DebugLogger(true, true, () => undefined, 'UTC');

  it('renders a copy-pasteable curl command', () => {
    expect(logger.format(request(), response())).toContain(
      "curl --location --request POST 'https://api.checkoutchamp.com/order/import/?",
    );
  });

  it('masks the credentials and card number in the logged URL', () => {
    const entry = logger.format(request(), response());
    expect(entry).toContain('loginId=[REDACTED]');
    expect(entry).toContain('password=[REDACTED]');
    expect(entry).toContain('cardNumber=[REDACTED]');
    expect(entry).not.toContain('xyz');
    expect(entry).not.toContain('4111111111111111');
  });

  it('keeps the endpoint and non-sensitive parameters readable', () => {
    const entry = logger.format(request(), response());
    expect(entry).toContain('https://api.checkoutchamp.com/order/import/');
    expect(entry).toContain('sessionId=sess_1');
  });

  it('writes the response status and body beneath the command', () => {
    const entry = logger.format(request(), response());
    expect(entry).toContain('# Response: HTTP 200');
    expect(entry).toContain('{"result":"SUCCESS"}');
  });

  it('reports a transport error instead of a response', () => {
    const entry = logger.format(request(), new Response(0, '', {}, 'connect timed out'));
    expect(entry).toContain('# Transport error: connect timed out');
    expect(entry).not.toContain('# Response:');
  });

  it('opens with a timestamp in the configured timezone', () => {
    expect(logger.format(request(), response())).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6} UTC]\n/);
  });

  it('renders the timestamp zone label for a non-UTC timezone', () => {
    const kolkata = new DebugLogger(true, true, () => undefined, 'Asia/Kolkata');
    expect(kolkata.format(request(), response())).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6} [^\]]+]\n/);
  });

  it('renders headers as --header arguments', () => {
    const withHeaders = new Request('POST', 'https://example.test/', ['X-Trace: abc']);
    expect(logger.format(withHeaders, response())).toContain("--header 'X-Trace: abc'");
  });

  it('masks a sensitive header', () => {
    const withHeaders = new Request('POST', 'https://example.test/', ['X-Api-Key: secret']);
    const entry = logger.format(withHeaders, response());
    expect(entry).toContain("--header 'X-Api-Key: [REDACTED]'");
    expect(entry).not.toContain('secret');
  });

  it('renders a body as a --data argument, quote-escaped', () => {
    const withBody = new Request('POST', 'https://example.test/', [], '{"a":"it\'s"}');
    expect(logger.format(withBody, response())).toContain(`--data '{"a":"it'\\''s"}'`);
  });

  it('escapes every single quote in the body, not just the first', () => {
    const withBody = new Request('POST', 'https://example.test/', [], '{"a":"it\'s","b":"ok\'s"}');
    expect(logger.format(withBody, response())).toContain(`--data '{"a":"it'\\''s","b":"ok'\\''s"}'`);
  });

  it('logs verbatim when redaction is off', () => {
    const verbatim = new DebugLogger(true, false, () => undefined, 'UTC');
    const entry = verbatim.format(request(), response());
    expect(entry).toContain('password=xyz');
    expect(entry).toContain('cardNumber=4111111111111111');
  });

  it('redacts the response body too', () => {
    const secretResponse = new Response(200, '{"password":"xyz"}', { http_code: 200 });
    const entry = logger.format(request(), secretResponse);
    expect(entry).toContain('"password":"[REDACTED]"');
  });
});

describe('DebugLogger.log', () => {
  it('does nothing when disabled', async () => {
    const entries: string[] = [];
    const logger = new DebugLogger(false, true, entry => {
      entries.push(entry);
    });

    logger.log(request(), response());
    await logger.flush();

    expect(entries).toEqual([]);
  });

  it('writes through a caller-supplied sink', async () => {
    const entries: string[] = [];
    const logger = new DebugLogger(true, true, entry => {
      entries.push(entry);
    });

    logger.log(request(), response());
    await logger.flush();

    expect(entries).toHaveLength(1);
  });

  it('awaits an async sink through flush', async () => {
    const entries: string[] = [];
    const logger = new DebugLogger(true, true, async entry => {
      await new Promise(resolve => setTimeout(resolve, 5));
      entries.push(entry);
    });

    logger.log(request(), response());
    await logger.flush();

    expect(entries).toHaveLength(1);
  });

  it('swallows a throwing sink, because logging must never break an API call', async () => {
    const logger = new DebugLogger(true, true, () => {
      throw new Error('sink exploded');
    });

    expect(() => {
      logger.log(request(), response());
    }).not.toThrow();
    await expect(logger.flush()).resolves.toBeUndefined();
  });

  it('swallows a rejecting async sink', async () => {
    const logger = new DebugLogger(true, true, () => Promise.reject(new Error('nope')));

    logger.log(request(), response());
    await expect(logger.flush()).resolves.toBeUndefined();
  });

  it('writes through the built-in file sink', async () => {
    const logger = DebugLogger.fromOptions({ debug: true, debugFile: join(dir, 'client.log') });

    logger.log(request(), response());
    await logger.flush();

    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(await readFile(join(dir, files[0]!), 'utf8')).toContain('# Response: HTTP 200');
  });
});

describe('DebugLogger immutability', () => {
  it('leaves the request and response untouched', async () => {
    const logger = new DebugLogger(true, true, () => undefined);
    const req = request();
    const res = response();

    logger.format(req, res);
    logger.log(req, res);
    await logger.flush();

    expect(req.url).toBe(URL_WITH_SECRETS);
    expect(res.body).toBe('{"result":"SUCCESS"}');
  });
});
