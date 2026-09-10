import type { ClientOptions, DebugSink } from '../client-config.js';
import { CheckoutChampError } from '../errors.js';
import type { Request } from '../http/request.js';
import type { Response } from '../http/response.js';
import { MESSAGES } from '../messages.js';
import { FileSink } from './file-sink.js';
import { Redactor } from './redactor.js';

/**
 * Opt-in request and response logging, redacted by default.
 *
 * Each entry is a copy-pasteable cURL command followed by the response it
 * produced. The logger reads from the frozen `Request` and `Response` value
 * objects and writes a formatted string to a sink; it never mutates either, so
 * turning logging on cannot change what is sent or what the caller receives.
 * The test suite asserts that directly.
 *
 * Because this API transmits credentials and cardholder data as query string
 * parameters, redaction covers the URL as well as the headers and bodies.
 * Logging is off unless `debug` is true, and redaction is on unless
 * `debugRedact` is explicitly false.
 */
export class DebugLogger {
  private readonly enabled: boolean;

  private readonly redact: boolean;

  private readonly sink: DebugSink | FileSink | null;

  private readonly timezone: string;

  private readonly redactor = new Redactor();

  /** Tail of the chain that serializes a caller-supplied sink's promises. */
  private chain: Promise<void> = Promise.resolve();

  /**
   * Build a logger directly from its parts.
   *
   * Most callers should reach this class through {@link fromOptions} instead,
   * which resolves an option bag into these same arguments and applies the
   * package's own destination and validation rules; calling this constructor
   * directly is for tests and for a consumer assembling a `FileSink` or
   * `DebugSink` by hand. A `sink` of `null` describes a logger that is
   * `enabled` but has nowhere to write — {@link log} treats that combination
   * as a no-op rather than an error, so flipping `enabled` on ahead of
   * choosing a destination is safe.
   *
   * @param enabled  Master switch.
   * @param redact   Mask the URL, headers and bodies. Defaults to `true`.
   * @param sink     Destination for the finished entry, or `null` for none.
   * @param timezone IANA timezone for entry timestamps.
   *
   * @throws {CheckoutChampError} When the timezone is not a recognised IANA
   *                              identifier.
   */
  public constructor(enabled: boolean, redact = true, sink: DebugSink | FileSink | null = null, timezone = 'UTC') {
    try {
      // Constructing the formatter is the only reliable way to validate an
      // IANA identifier: an unrecognised zone throws a RangeError here rather
      // than surfacing later, mid-format.
      new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
    } catch {
      throw new CheckoutChampError(MESSAGES.invalidTimezone);
    }

    this.enabled = enabled;
    this.redact = redact;
    this.sink = sink;
    this.timezone = timezone;
  }

  /**
   * Build a logger from the client option bag.
   *
   * A caller-supplied `debugSink` replaces the file sink entirely; the package
   * then writes no files and retention becomes the caller's concern. When
   * `debug` is off, no destination is required and none of the destination
   * checks below run — only the timezone is still validated, since a caller
   * may configure `debugTimezone` in advance of turning debugging on.
   *
   * @param options The client options.
   *
   * @returns A configured logger, disabled when `debug` is not set.
   *
   * @throws {CheckoutChampError} When debug is on but no destination is
   *                              configured, when `debugSink` is not callable,
   *                              or when the timezone is unrecognised.
   */
  public static fromOptions(options: ClientOptions): DebugLogger {
    const enabled = options.debug === true;
    const redact = options.debugRedact !== false;
    const timezone = options.debugTimezone ?? 'UTC';

    if (!enabled) {
      return new DebugLogger(false, redact, null, timezone);
    }

    if (options.debugSink !== undefined) {
      if (typeof options.debugSink !== 'function') {
        throw new CheckoutChampError(MESSAGES.invalidDebugSink);
      }

      return new DebugLogger(true, redact, options.debugSink, timezone);
    }

    const file = (options.debugFile ?? '').trim();
    if (file === '') {
      throw new CheckoutChampError(MESSAGES.debugFileRequired);
    }

    const retention = options.debugRetentionDays ?? FileSink.DEFAULT_RETENTION_DAYS;

    return new DebugLogger(true, redact, new FileSink(file, retention, timezone), timezone);
  }

  /**
   * Report whether logging is turned on.
   *
   * Callers on a hot path (building headers, formatting a body) can use this
   * to skip work that would otherwise be thrown away, since {@link log} is
   * already a no-op when disabled.
   *
   * @returns Whether logging is turned on.
   */
  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Report whether entries are redacted before reaching the sink.
   *
   * This reflects the `debugRedact` option the logger was built with, not
   * anything about the current exchange — every entry from one logger is
   * redacted, or none are.
   *
   * @returns Whether entries are redacted before reaching the sink.
   */
  public isRedacting(): boolean {
    return this.redact;
  }

  /**
   * Record one exchange.
   *
   * Returns immediately and never throws: a logging failure must not break the
   * API call that produced it. A `FileSink` already serializes its own writes,
   * so the entry is handed off to it directly; a caller-supplied function may
   * be asynchronous, so its promise is chained onto this logger's own queue and
   * any rejection is swallowed there instead of becoming an unhandled
   * rejection.
   *
   * @param request  The request as it was sent.
   * @param response The response as it was received.
   */
  public log(request: Request, response: Response): void {
    if (!this.enabled || this.sink === null) {
      return;
    }

    const sink = this.sink;

    try {
      const entry = this.format(request, response);

      if (sink instanceof FileSink) {
        sink.write(entry);
        return;
      }

      this.chain = this.chain.then(async () => {
        try {
          await sink(entry);
        } catch {
          // Intentionally swallowed: logging must never break an API call.
        }
      });
    } catch {
      // Intentionally swallowed: logging must never break an API call.
    }
  }

  /**
   * Wait for every queued entry to reach its destination.
   *
   * A Node process can exit before an asynchronous sink has finished writing.
   * Await this before exit when the log matters. Draining a `FileSink` means
   * awaiting its own write chain; draining a caller-supplied sink means
   * awaiting this logger's chain of queued invocations instead, since that is
   * where their promises are held.
   *
   * @returns A promise that settles once every pending write is done.
   */
  public async flush(): Promise<void> {
    if (this.sink instanceof FileSink) {
      await this.sink.flush();
      return;
    }

    await this.chain;
  }

  /**
   * Render one entry without writing it anywhere.
   *
   * Useful for testing a redaction rule, and for a caller who wants the entry
   * text without the package's sink machinery. Reads only; the `Request` and
   * `Response` passed in come back unchanged regardless of how this method
   * renders them.
   *
   * @param request  The request as it was sent.
   * @param response The response as it was received.
   *
   * @returns The formatted entry, redacted unless redaction was turned off.
   */
  public format(request: Request, response: Response): string {
    const headers = this.redact ? this.redactor.redactHeaders(request.headers) : [...request.headers];

    const body = this.redact ? this.redactor.redactBody(request.body) : request.body;

    const responseBody = this.redact ? this.redactor.redactBody(response.body) : response.body;

    // This API carries credentials and cardholder data in the query string, so
    // the URL is masked too rather than logged verbatim. Scheme, host and path
    // survive, which keeps the entry readable and reproducible.
    const url = this.redact ? this.redactor.redactUrl(request.url) : request.url;

    const parts = [`curl --location --request ${request.method} '${url}'`];
    for (const headerLine of headers) {
      parts.push(`  --header '${headerLine}'`);
    }
    if (body !== null) {
      parts.push(`  --data '${body.replace(/'/g, "'\\''")}'`);
    }

    const entry = `[${this.timestamp()}]\n${parts.join(' \\\n')}\n\n`;

    if (response.hasTransportError()) {
      return `${entry}# Transport error: ${response.transportError}\n\n`;
    }

    return `${entry}# Response: HTTP ${String(response.statusCode)}\n${responseBody ?? ''}\n\n`;
  }

  /**
   * Render the current moment as `YYYY-MM-DD HH:MM:SS.uuuuuu ZONE`.
   *
   * The Composer package uses PHP's true microseconds. JavaScript resolves to
   * milliseconds, so the fractional part here is the millisecond value padded
   * to six digits rather than a genuine microsecond reading; the format is
   * otherwise identical. This is a documented fidelity loss against the PHP
   * original, not a bug: a Node process simply has no finer-grained wall clock
   * to read from.
   *
   * @returns The formatted timestamp.
   */
  private timestamp(): string {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    });

    const parts = new Map(formatter.formatToParts(now).map(part => [part.type, part.value]));
    const date = `${parts.get('year') ?? ''}-${parts.get('month') ?? ''}-${parts.get('day') ?? ''}`;
    // Some ICU versions render midnight under `hour12: false` as "24" rather
    // than "00"; normalise it here so the entry never shows a 24th hour.
    const hour = (parts.get('hour') ?? '00') === '24' ? '00' : (parts.get('hour') ?? '00');
    const time = `${hour}:${parts.get('minute') ?? ''}:${parts.get('second') ?? ''}`;
    const micros = `${String(now.getMilliseconds()).padStart(3, '0')}000`;
    const zone = parts.get('timeZoneName') ?? this.timezone;

    return `${date} ${time}.${micros} ${zone}`;
  }
}
