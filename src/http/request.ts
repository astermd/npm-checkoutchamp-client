/**
 * Immutable description of one outbound HTTP request.
 *
 * Everything the transport needs, and nothing it can change. Two things fall
 * out of that. Tests get a single object to assert URL, method, headers and
 * body against, so an endpoint's wire shape is checkable without a network.
 * And the debug logger, which receives this same object, is structurally
 * incapable of altering what is actually sent — the guarantee does not rest on
 * the logger being careful.
 *
 * For this API the body is always `null` and the headers are always empty:
 * Checkout Champ takes every parameter, credentials included, in the query
 * string. The fields exist so a consumer's own transport can be tested against
 * the same object shape.
 */
export class Request {
  /** Uppercased HTTP method. */
  public readonly method: string;

  /** Absolute URL, query string included. */
  public readonly url: string;

  /** Raw header lines in `Name: value` form. */
  public readonly headers: readonly string[];

  /** Request body, or `null` when there is none. */
  public readonly body: string | null;

  /** Proxy address for this request, or `null`. */
  public readonly proxyUrl: string | null;

  /** Proxy credentials as `user:password`, or `null`. */
  public readonly proxyCredentials: string | null;

  /**
   * @param method           HTTP method; case is normalised to upper.
   * @param url              Absolute URL including any query string.
   * @param headers          Raw header lines. Copied, not referenced.
   * @param body             Request body, or `null`.
   * @param proxyUrl         Proxy address, e.g. `proxy.example.test:8080`.
   * @param proxyCredentials Proxy credentials as `user:password`.
   */
  public constructor(
    method: string,
    url: string,
    headers: readonly string[] = [],
    body: string | null = null,
    proxyUrl: string | null = null,
    proxyCredentials: string | null = null,
  ) {
    this.method = method.toUpperCase();
    this.url = url;
    this.headers = Object.freeze([...headers]);
    this.body = body;
    this.proxyUrl = proxyUrl;
    this.proxyCredentials = proxyCredentials;

    Object.freeze(this);
  }

  /**
   * Whether this request should be routed through a proxy.
   *
   * An empty string counts as no proxy, not as a proxy with a blank address —
   * callers building a `Request` from optional configuration often end up
   * passing `''` rather than `null` when a proxy setting is unset, and this
   * keeps that case from being treated as "route through nothing".
   *
   * @returns `true` when a non-empty proxy address is set.
   */
  public hasProxy(): boolean {
    return this.proxyUrl !== null && this.proxyUrl !== '';
  }
}
