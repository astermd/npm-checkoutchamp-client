import { CheckoutChampError } from './errors.js';
import { MESSAGES } from './messages.js';

/**
 * Destination for a formatted debug log entry.
 *
 * Receives the finished entry, already redacted unless redaction was turned
 * off. May return a promise; the logger awaits it on its own serialized chain
 * so a slow destination cannot interleave two entries.
 *
 * @param entry The formatted log entry.
 */
export type DebugSink = (entry: string) => void | Promise<void>;

/**
 * Every option the client accepts.
 *
 * Names and defaults are identical to the Composer package's option array, so
 * configuration transfers between the PHP and Node clients unchanged.
 */
export interface ClientOptions {
  /** Bare hostname. A scheme, path, query or space is rejected. */
  host?: string;
  /** Optional path prefix below the host, e.g. a version segment. */
  basePath?: string;
  /** Transfer timeout in seconds. */
  timeout?: number;
  /** Connection timeout in seconds. */
  connectTimeout?: number;
  /** Master switch for request/response logging. */
  debug?: boolean;
  /** Mask credentials and sensitive fields in the logged URL, headers and body. */
  debugRedact?: boolean;
  /** Base path for the built-in dated file sink. */
  debugFile?: string;
  /** Days of log history to keep. `0` keeps everything. */
  debugRetentionDays?: number;
  /** IANA timezone for log timestamps and dated filenames. */
  debugTimezone?: string;
  /** Replaces the file sink entirely. */
  debugSink?: DebugSink;
}

/**
 * Immutable connection settings for the Checkout Champ API.
 *
 * The consumer supplies a bare hostname, never a full URL. That keeps the
 * scheme, the path assembly and the query encoding inside this package. It is
 * not a stylistic preference: this API carries the account password in the
 * query string, so a consumer able to pass `http://…` could publish that
 * password to every hop on the path.
 *
 * Instances are frozen. A client reuses one config for its whole lifetime, and
 * nothing in the request path may adjust it.
 */
export class ClientConfig {
  /**
   * Host used when the consumer does not supply one, or supplies only
   * whitespace. This is Checkout Champ's production API host; most consumers
   * never need to override it, and the handful who talk to an account-specific
   * or sandbox host pass their own `host` option instead.
   */
  public static readonly DEFAULT_HOST = 'api.checkoutchamp.com';

  /**
   * Default transfer timeout in seconds, applied when the consumer omits
   * `timeout`. This bounds how long a request may run once it is sent, as
   * distinct from {@link DEFAULT_CONNECT_TIMEOUT}, which bounds only the
   * connection setup that precedes it.
   */
  public static readonly DEFAULT_TIMEOUT = 30;

  /**
   * Default connection timeout in seconds, applied when the consumer omits
   * `connectTimeout`. This bounds only the time to establish the TCP/TLS
   * connection, not the request that follows on it.
   */
  public static readonly DEFAULT_CONNECT_TIMEOUT = 10;

  /**
   * Checkout Champ API login ID, supplied entirely by the caller. This
   * package ships no default and reads no environment variable for it; the
   * value passed to the constructor is the only one that is ever used. Like
   * {@link password}, it travels as a URL query parameter on every request,
   * not in a header, which is also why {@link host} is restricted to a bare
   * hostname.
   */
  public readonly loginId: string;

  /**
   * Checkout Champ API password, supplied entirely by the caller. This
   * package ships no default and reads no environment variable for it, so a
   * missing or blank value is always a caller error, not a configuration gap
   * this class could fill in. It travels as a URL query parameter on every
   * request, alongside {@link loginId} — the reason {@link host} accepts
   * nothing but a bare hostname.
   */
  public readonly password: string;

  /**
   * Bare hostname, with no scheme, path, userinfo or fragment — optionally
   * followed by `:port`. Only a bare hostname is accepted because this API
   * takes `loginId` and `password` as URL query parameters: a value that
   * could smuggle in a scheme could force the request onto plaintext HTTP and
   * hand the password to every hop on the path, and a value that could
   * smuggle in userinfo (an `@`) or an authority terminator (`\`, `#`) could
   * redirect the request to a different host entirely while looking innocuous
   * at a glance. Restricting `host` to a validated hostname closes both
   * routes; the scheme is fixed to HTTPS by {@link getBaseUrl} and is not a
   * configurable part of this value.
   */
  public readonly host: string;

  /**
   * Path prefix below the host, with any leading and trailing slashes
   * stripped, e.g. `v1`. Since {@link host} rejects anything that is not a
   * bare hostname, a full URL cannot be used to reach a versioned or
   * namespaced endpoint — `basePath` is the only supported way to place a
   * path segment between the host and the query string that
   * {@link getBaseUrl} and the request builder assemble around it.
   */
  public readonly basePath: string;

  /**
   * Transfer timeout in seconds: the maximum time allowed for a request once
   * it has been sent, covering the full round trip through to the response
   * body. It is distinct from {@link connectTimeout}, which only bounds
   * connection setup — the two are enforced separately by the transport, so a
   * slow-to-connect host and a slow-to-respond host fail against different
   * budgets rather than sharing one.
   */
  public readonly timeout: number;

  /**
   * Connection timeout in seconds: the maximum time allowed to establish the
   * TCP/TLS connection, before any request bytes are sent. It is distinct
   * from {@link timeout}, which governs the request that follows once the
   * connection is up; a low `connectTimeout` fails fast against an
   * unreachable host without shortening how long an already-connected,
   * slow-to-respond request is given to complete.
   */
  public readonly connectTimeout: number;

  /**
   * Validates the credentials and the host, applies the documented defaults
   * for whatever the caller omits, and freezes the resulting instance so it
   * cannot be mutated afterwards. Construction is the only place validation
   * happens — every other member trusts the fields it reads.
   *
   * @param loginId  Checkout Champ API login ID. Required; there is no default.
   * @param password Checkout Champ API password. Required; there is no default.
   * @param options  Connection settings. Unrecognised keys are ignored.
   *
   * @throws {CheckoutChampError} When a credential is empty or whitespace, or
   *                              the host is not a bare hostname.
   */
  public constructor(loginId: string, password: string, options: ClientOptions = {}) {
    if (loginId.trim() === '' || password.trim() === '') {
      throw new CheckoutChampError(MESSAGES.invalidApiAuth);
    }

    const host = (options.host ?? '').trim();
    const resolvedHost = host === '' ? ClientConfig.DEFAULT_HOST : host;
    ClientConfig.assertBareHost(resolvedHost);

    this.loginId = loginId;
    this.password = password;
    this.host = resolvedHost;
    this.basePath = (options.basePath ?? '').trim().replace(/^\/+|\/+$/g, '');
    this.timeout = options.timeout ?? ClientConfig.DEFAULT_TIMEOUT;
    this.connectTimeout = options.connectTimeout ?? ClientConfig.DEFAULT_CONNECT_TIMEOUT;

    Object.freeze(this);
  }

  /**
   * Absolute base URL with no trailing slash.
   *
   * The scheme is always HTTPS and is not configurable.
   *
   * @returns e.g. `https://api.checkoutchamp.com` or `https://host/v1`.
   */
  public getBaseUrl(): string {
    const url = `https://${this.host}`;

    return this.basePath === '' ? url : `${url}/${this.basePath}`;
  }

  /**
   * Matches a bare hostname and nothing else: one or more dot-separated
   * labels, each 1-63 characters of ASCII letters, digits and hyphens that
   * neither starts nor ends with a hyphen, followed by an optional 1-5 digit
   * `:port`.
   *
   * This is a positive allowlist rather than a list of forbidden characters
   * on purpose. A deny-list only ever rejects the delimiters its author
   * thought of; WHATWG URL parsing treats `@` (userinfo), and — for special
   * schemes such as `https:` — `\` and `#` as authority terminators too, so a
   * host that merely avoids `/`, whitespace, `?` and `://` can still resolve
   * to a completely different host once `https://` is prepended and the
   * result is parsed as a URL. An allowlist has no such gaps: anything that
   * is not a validated label-and-port sequence is rejected, full stop.
   */
  private static readonly BARE_HOST_PATTERN =
    /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*(:[0-9]{1,5})?$/;

  /** Longest hostname (including an optional `:port`) this class accepts. */
  private static readonly MAX_HOST_LENGTH = 253;

  /**
   * Reject anything that is not a bare hostname, matched against
   * {@link BARE_HOST_PATTERN}. Punycode labels (`xn--…`) pass, because they
   * are themselves ASCII letters, digits and hyphens.
   *
   * @param host Candidate hostname.
   *
   * @throws {CheckoutChampError} When the value is empty, exceeds
   *                              {@link MAX_HOST_LENGTH}, or does not match
   *                              {@link BARE_HOST_PATTERN}.
   */
  private static assertBareHost(host: string): void {
    if (host.length > ClientConfig.MAX_HOST_LENGTH || !ClientConfig.BARE_HOST_PATTERN.test(host)) {
      throw new CheckoutChampError(MESSAGES.invalidHost);
    }
  }
}
