/**
 * Transport metadata about one exchange.
 *
 * Keys are snake_case because they mirror the `curl_getinfo()` output the
 * Composer package exposes through its `header` wrapper. Renaming them would
 * break a consumer reading `header.http_code` after migrating.
 *
 * These names are a wire-visible compatibility contract with that package, not
 * a style choice this codebase happens to have made — treat `http_code`,
 * `content_type`, `total_time` and `redirect_count` as fixed. If
 * `@typescript-eslint/naming-convention` is ever broadened to cover interface
 * members, this interface needs an explicit exemption, not a rename.
 */
export interface TransportInfo {
  /** HTTP status code, or `0` when the exchange never completed. */
  http_code: number;
  /** Final URL after any redirects. */
  url?: string;
  /** Value of the response `Content-Type` header. */
  content_type?: string;
  /** Total transfer time in seconds. */
  total_time?: number;
  /** Number of redirects followed. */
  redirect_count?: number;
}

/**
 * Immutable result of one HTTP exchange.
 *
 * A transport failure is carried as data rather than thrown. That ordering
 * matters: the debug logger observes the attempt before the caller decides what
 * to do about it, so a connection that never completed still leaves a log
 * entry. It also keeps the failure mode identical to the Composer package,
 * where a transport error reaches the caller as a `curlError` key rather than
 * an exception.
 */
export class Response {
  /** HTTP status code, or `0` when the exchange never completed. */
  public readonly statusCode: number;

  /** Response body, verbatim. Empty when the exchange failed. */
  public readonly body: string;

  /** Transport metadata. */
  public readonly info: Readonly<TransportInfo> | Readonly<Record<string, never>>;

  /** Transport failure message, or an empty string on success. */
  public readonly transportError: string;

  /**
   * @param statusCode     HTTP status code, or `0`.
   * @param body           Response body, verbatim.
   * @param info           Transport metadata.
   * @param transportError Failure message; empty when the transfer succeeded.
   */
  public constructor(
    statusCode: number,
    body: string,
    info: TransportInfo | Record<string, never> = {},
    transportError = '',
  ) {
    this.statusCode = statusCode;
    this.body = body;
    this.info = Object.freeze({ ...info });
    this.transportError = transportError;

    Object.freeze(this);
  }

  /**
   * Whether the request failed before a response was received.
   *
   * A transport failure means the exchange never completed — no bytes reached
   * the server, or none came back — so `statusCode` and `body` carry no
   * meaning when this is `true`. A `false` result is what tells a caller it is
   * safe to read the status code and body as the actual server response.
   *
   * @returns `true` when a transport failure message is present.
   */
  public hasTransportError(): boolean {
    return this.transportError !== '';
  }
}
