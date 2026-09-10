import type { ClientConfig } from './client-config.js';
import type { HttpClientInterface } from './http/http-client-interface.js';
import { Request } from './http/request.js';
import type { DebugLogger } from './logging/debug-logger.js';
import { PendingCall, type CallOptions, type Params } from './pending-call.js';
import { buildQuery } from './support/build-query.js';

/**
 * Base class for every Checkout Champ API resource.
 *
 * Holds the connection settings, assembles the request, and hands back a
 * {@link PendingCall}. Resource subclasses contain no HTTP knowledge at all —
 * they name a section and a method and pass the caller's parameters through,
 * which is the whole reason they stay thin enough to read at a glance.
 *
 * The API authenticates with `loginId` and `password` sent as query string
 * parameters. They are appended at send time, after the caller's own
 * parameters, so a caller who passes a `password` key cannot shadow the
 * configured credential. The snapshot kept for the payload accessor is taken
 * before they are added, which is what makes it structurally impossible for a
 * credential to reach a consumer's diagnostics.
 */
export abstract class CheckoutChamp {
  protected readonly config: ClientConfig;

  protected readonly http: HttpClientInterface;

  protected readonly logger: DebugLogger;

  /**
   * Proxy address for the next request only, or `null` when none is set.
   *
   * Written by {@link setProxy} and read-and-cleared by {@link sendPost}. This
   * is a one-shot latch, not a standing setting: see {@link setProxy} for why
   * that is safe under concurrent calls.
   */
  private proxyUrl: string | null = null;

  /** Proxy credentials as `user:password` for the next request, or `null`. */
  private proxyCredentials: string | null = null;

  /**
   * @param config Connection settings shared with the whole client.
   * @param http   The transport every request passes through.
   * @param logger The read-only observer that records each exchange.
   */
  public constructor(config: ClientConfig, http: HttpClientInterface, logger: DebugLogger) {
    this.config = config;
    this.http = http;
    this.logger = logger;
  }

  /**
   * Route the next request through an HTTP proxy.
   *
   * This sets a one-shot latch rather than a standing option: {@link sendPost}
   * reads and clears it synchronously while it builds the `Request`, with no
   * `await` in between the caller setting it and the resource reading it. That
   * ordering is what makes the latch safe under concurrency — nothing else can
   * run on this object's turn of the event loop between the write and the
   * read, so a second, unrelated concurrent call has no window in which to
   * pick up a proxy setting meant for the first. Calling this method is
   * therefore only meaningful immediately before the one call it is meant for.
   *
   * @param proxyUrl      Proxy address, e.g. `proxy.example.test:8080`.
   * @param proxyUserName Proxy username, when the proxy requires one.
   * @param proxyPassword Proxy password, when the proxy requires one.
   */
  public setProxy(
    proxyUrl: string | null,
    proxyUserName: string | null = null,
    proxyPassword: string | null = null,
  ): void {
    this.proxyUrl = proxyUrl;
    this.proxyCredentials =
      proxyUserName !== null && proxyUserName !== '' ? `${proxyUserName}:${proxyPassword ?? ''}` : null;
  }

  /**
   * Assemble one call.
   *
   * Every Checkout Champ endpoint is a POST to `{section}/{method}/` with all
   * parameters, credentials included, in the query string. The credential-free
   * payload snapshot handed to {@link PendingCall} is copied from `fields`
   * before `loginId` and `password` are spread into the query object; spreading
   * them last means the assignment overwrites a caller-supplied key of the
   * same name in place, exactly as PHP's `array_merge` does, rather than
   * appending a second occurrence — so exactly one `loginId` and one
   * `password` ever reach the wire, and both carry the configured value.
   *
   * @param section First path segment, e.g. `order`.
   * @param method  Second path segment, e.g. `query`.
   * @param fields  The caller's own parameters.
   * @param options Per-call settings.
   *
   * @returns The unsent call.
   */
  protected sendPost(section: string, method: string, fields: Params, options: CallOptions = {}): PendingCall {
    const path = `${CheckoutChamp.trimSlashes(section)}/${CheckoutChamp.trimSlashes(method)}/`;
    const url = `${this.config.getBaseUrl()}/${path.replace(/ /g, '')}`;

    // Credentials are appended last so a caller-supplied key cannot shadow them.
    const query = buildQuery({
      ...fields,
      loginId: this.config.loginId,
      password: this.config.password,
    });

    const request = new Request('POST', `${url}?${query}`, [], null, this.proxyUrl, this.proxyCredentials);

    // Read-and-clear the one-shot latch synchronously; see setProxy for why
    // this cannot race a concurrent call.
    this.proxyUrl = null;
    this.proxyCredentials = null;

    return new PendingCall({
      request,
      url,
      payload: { ...fields },
      headerRequired: options.headerRequired ?? false,
      http: this.http,
      logger: this.logger,
    });
  }

  /**
   * Strip leading and trailing slashes from a path segment.
   *
   * @param segment The raw segment.
   *
   * @returns The trimmed segment.
   */
  private static trimSlashes(segment: string): string {
    return segment.replace(/^\/+|\/+$/g, '');
  }
}
