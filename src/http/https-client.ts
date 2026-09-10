import { request as httpRequest } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import type { Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import type { HttpClientInterface } from './http-client-interface.js';
import type { Request } from './request.js';
import { Response, type TransportInfo } from './response.js';

/** Maximum redirects followed before giving up, mirroring cURL's default cap. */
const MAX_REDIRECTS = 10;

/** One hop's outcome: enough to decide whether to redirect and what to report. */
interface HopResult {
  statusCode: number;
  body: string;
  location: string | null;
  contentType: string | null;
}

/**
 * The port implied by a URL when it does not carry an explicit one.
 *
 * Node infers this correctly on its own for a request it connects itself —
 * the `Host` header gets `:443` or `:80` omitted exactly when it should be —
 * but not for a request whose socket comes from a custom `createConnection`,
 * which is what a tunnelled request uses: there, Node falls back to port 80
 * regardless of scheme, which would send a wrong `Host` header (and, for the
 * `CONNECT` target itself, a wrong port) through the proxy for the implicit-443
 * URLs `ClientConfig` always builds. Both places that need an implicit port —
 * the tunnelled request's own options and the `CONNECT` target — call this one
 * function so they cannot independently drift apart.
 *
 * @param target The URL to derive a port for.
 *
 * @returns The URL's own port, or `443` for `https:` / `80` for `http:` when
 *          it has none.
 */
export function impliedPort(target: URL): string {
  if (target.port !== '') {
    return target.port;
  }

  return target.protocol === 'https:' ? '443' : '80';
}

/**
 * The default transport, built directly on Node's own HTTP stack.
 *
 * `fetch` would be the obvious choice here and is deliberately not used. This
 * client has to support two things `fetch` cannot express without pulling in a
 * dependency: routing a request through an HTTP proxy (a `CONNECT` tunnel for
 * an HTTPS destination), and a connection timeout that is distinct from the
 * transfer timeout — `AbortSignal.timeout()` gives only one deadline for the
 * whole exchange. Both are documented features of this package, so the
 * transport is built on `node:http` and `node:https` instead: still native,
 * still zero-dependency.
 *
 * The scheme of the URL it is given decides which module performs the request
 * — `node:https` for `https:`, `node:http` for `http:` — the way any transport
 * honours the URL handed to it. That is not a weakening of the TLS guarantee:
 * `ClientConfig` is the enforcement point and can only ever build `https://`
 * URLs, with no option to change that. A consumer who hand-builds a `Request`
 * pointing at `http:` and calls this transport directly has stepped outside
 * the client's surface. TLS peer and hostname verification stay on by default
 * for every `https:` exchange this class performs, and there is no option
 * anywhere in this class to disable them — this API carries the account
 * password in the query string, so an unverified connection would hand it to
 * anyone on the path.
 *
 * A transport failure is never thrown, in either the top-level call or any
 * helper it uses internally. It is always returned as `Response.transportError`
 * instead. That ordering is what lets the debug logger record a failed attempt
 * before the caller decides what to do about it, and it is what gives the
 * caller the documented `curlError` shape rather than an unhandled exception.
 */
export class HttpsClient implements HttpClientInterface {
  /** Transfer timeout, in seconds, applied to the whole response body read. */
  private readonly timeout: number;

  /** Connect timeout, in seconds, applied only until the socket is usable. */
  private readonly connectTimeout: number;

  /**
   * @param timeout        Transfer timeout in seconds — the deadline for a
   *                        complete response after the connection is
   *                        established. Defaults to 30.
   * @param connectTimeout Connection timeout in seconds — the deadline for the
   *                        TCP connect (and, for `https:`, the TLS handshake,
   *                        or for a proxied request the `CONNECT` tunnel) to
   *                        finish. Defaults to 10. Kept separate from
   *                        `timeout` because a slow or black-holed network
   *                        path and a slow server response are different
   *                        failures a caller may want to time out differently
   *                        — the exact distinction `fetch` cannot express.
   */
  public constructor(timeout = 30, connectTimeout = 10) {
    this.timeout = timeout;
    this.connectTimeout = connectTimeout;
  }

  /**
   * Perform the request, following redirects and honouring both timeouts.
   *
   * Every failure this method or anything it calls can produce — a malformed
   * URL, a DNS failure, either timeout, a TLS error, a refused proxy tunnel, or
   * exceeding the redirect cap — is caught here and converted into a
   * `Response` carrying `transportError`. Nothing below this method is allowed
   * to let an exception or a rejected promise escape to the caller.
   *
   * @param request The frozen request description.
   *
   * @returns The response, carrying any failure as `transportError`.
   */
  public async send(request: Request): Promise<Response> {
    if (request.url === '' || request.method === '') {
      return new Response(0, '', {}, 'A request needs both a URL and an HTTP method');
    }

    const startedAt = Date.now();

    try {
      return await this.follow(request, request.url, 0, startedAt);
    } catch (error) {
      return new Response(0, '', {}, HttpsClient.describe(error));
    }
  }

  /**
   * Perform one hop, recursing when the response is a redirect.
   *
   * The redirect cap is checked before anything else in this method runs, so a
   * request that would exceed it is never issued — the counter is what
   * advances on the way into the *next* hop, not something incremented after
   * the fact, which is what keeps a server that redirects forever from
   * hanging the caller instead of failing at a bounded number of hops.
   *
   * @param request       The original request, for method, headers, body and
   *                       proxy settings, reused unchanged on every hop.
   * @param url           The URL for this hop — the original URL on the first
   *                       call, a `Location` header resolved against the
   *                       previous hop's URL on every recursive call.
   * @param redirectCount Redirects already followed before this hop.
   * @param startedAt     Epoch milliseconds the whole exchange began, used to
   *                       compute `total_time` across every hop.
   *
   * @returns The final response, once a hop is not itself a redirect.
   */
  private async follow(request: Request, url: string, redirectCount: number, startedAt: number): Promise<Response> {
    if (redirectCount > MAX_REDIRECTS) {
      return new Response(0, '', {}, `Exceeded ${String(MAX_REDIRECTS)} redirects`);
    }

    const target = new URL(url);

    if (request.hasProxy() && target.protocol !== 'https:') {
      // A `CONNECT` tunnel is the only proxy mechanism this transport
      // implements, and that only makes sense for an `https:` destination.
      // `ClientConfig` never builds anything but `https://` URLs, so silently
      // sending a proxied request direct — dropping the proxy — is not a real
      // call path worth supporting; it is only a bad failure mode worth
      // refusing loudly instead.
      return new Response(0, '', {}, 'A proxy is supported for https targets only');
    }

    const socket = request.hasProxy() ? await this.tunnel(request, target) : null;

    const hop = await this.exchange(request, target, socket);

    if (hop.location !== null && hop.statusCode >= 300 && hop.statusCode < 400) {
      return this.follow(request, new URL(hop.location, target).toString(), redirectCount + 1, startedAt);
    }

    const info: TransportInfo = {
      http_code: hop.statusCode,
      url: HttpsClient.withoutQuery(target),
      redirect_count: redirectCount,
      total_time: (Date.now() - startedAt) / 1000,
      ...(hop.contentType === null ? {} : { content_type: hop.contentType }),
    };

    return new Response(hop.statusCode, hop.body, info);
  }

  /**
   * Issue one HTTP exchange over either a fresh connection or a pre-tunnelled
   * socket, and read the whole response body.
   *
   * Two independent deadlines are armed for the exchange and both are always
   * cleared before this method's promise settles, on every path — a
   * successful read, a socket or request error, or either deadline itself
   * firing — so a finished exchange never leaves a timer able to keep the
   * process alive. The connect deadline is cleared the moment the socket is
   * actually usable: for a fresh connection that is the `connect` (or, over
   * TLS, `secureConnect`) event; for a socket handed in already tunnelled, it
   * is cleared immediately, since there is nothing left to wait for. Because a
   * JavaScript promise silently ignores a second settlement, an error that
   * arrives after the body has already resolved can never turn a completed
   * exchange into a failure — but this method also tracks whether it has
   * already settled so it does not do redundant teardown work on that late
   * arrival.
   *
   * @param request The original request, for method, headers, body and
   *                 (indirectly, via `socket`) proxy routing.
   * @param target  The URL for this hop.
   * @param socket  A pre-established, already-tunnelled socket to reuse, or
   *                `null` to let this call open its own connection.
   *
   * @returns The status, body, `Location` header and content type of the one
   *          response received.
   */
  private exchange(request: Request, target: URL, socket: Socket | null): Promise<HopResult> {
    return new Promise((resolve, reject) => {
      const secure = target.protocol === 'https:';
      let settled = false;

      const options: RequestOptions = {
        method: request.method,
        headers: HttpsClient.toHeaderObject(request.headers),
        hostname: target.hostname,
        port: impliedPort(target),
        path: `${target.pathname}${target.search}`,
        ...(socket === null
          ? { protocol: target.protocol }
          : { createConnection: () => socket, servername: target.hostname }),
      };

      const clearTimers = (): void => {
        clearTimeout(connectTimer);
        clearTimeout(transferTimer);
      };

      const fail = (error: unknown): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimers();
        req.destroy();
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      const succeed = (result: HopResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimers();
        resolve(result);
      };

      const connectTimer = setTimeout(() => {
        fail(new Error('Connection timed out'));
      }, this.connectTimeout * 1000);

      // Two separate deadlines are the reason this package does not use
      // fetch: AbortSignal.timeout() can express only one for the whole call.
      const transferTimer = setTimeout(() => {
        fail(new Error('Transfer timed out'));
      }, this.timeout * 1000);

      const send = secure ? httpsRequest : httpRequest;
      const req = send(options, res => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          succeed({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            location: typeof res.headers.location === 'string' ? res.headers.location : null,
            contentType: typeof res.headers['content-type'] === 'string' ? res.headers['content-type'] : null,
          });
        });
        res.on('error', fail);
      });

      req.on('socket', activeSocket => {
        if (socket !== null) {
          // Already connected (and, for https, already tunnelled and
          // TLS-wrapped) before this call started — nothing left to wait for.
          clearTimeout(connectTimer);
          return;
        }

        const onReady = (): void => {
          clearTimeout(connectTimer);
        };

        activeSocket.once(secure ? 'secureConnect' : 'connect', onReady);
        if (!activeSocket.connecting) {
          onReady();
        }
      });

      req.on('error', fail);

      if (request.body !== null) {
        req.write(request.body);
      }
      req.end();
    });
  }

  /**
   * Open a `CONNECT` tunnel through the configured proxy and wrap it in TLS.
   *
   * cURL's `CURLOPT_PROXY` does this transparently for an HTTPS destination;
   * in Node the equivalent has to be spelled out by hand — ask the proxy to
   * open a raw connection to the real destination, then run the TLS handshake
   * for that destination over the tunnel the proxy handed back, so the proxy
   * itself never sees the decrypted traffic.
   *
   * @param request The request carrying the proxy address and credentials.
   * @param target  The final destination the tunnel must reach.
   *
   * @returns A TLS socket tunnelled through the proxy to the destination,
   *          ready for `exchange` to write an HTTP request over.
   */
  private tunnel(request: Request, target: URL): Promise<Socket> {
    return new Promise((resolve, reject) => {
      let settled = false;

      const finish = (fn: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        fn();
      };

      const proxy = new URL(`http://${request.proxyUrl ?? ''}`);
      const port = impliedPort(target);
      const headers: Record<string, string> = {};

      if (request.proxyCredentials !== null && request.proxyCredentials !== '') {
        headers['Proxy-Authorization'] = `Basic ${Buffer.from(request.proxyCredentials).toString('base64')}`;
      }

      const connectReq = httpRequest({
        method: 'CONNECT',
        host: proxy.hostname,
        port: proxy.port === '' ? 80 : Number(proxy.port),
        path: `${target.hostname}:${port}`,
        headers,
      });

      const timer = setTimeout(() => {
        finish(() => {
          connectReq.destroy();
          reject(new Error('Connection timed out'));
        });
      }, this.connectTimeout * 1000);

      connectReq.on('connect', (res, proxySocket) => {
        if (res.statusCode !== 200) {
          finish(() => {
            proxySocket.destroy();
            reject(new Error(`Proxy refused the tunnel with HTTP ${String(res.statusCode ?? 0)}`));
          });
          return;
        }

        const secured = tlsConnect({ socket: proxySocket, servername: target.hostname });
        secured.once('secureConnect', () => {
          finish(() => {
            resolve(secured);
          });
        });
        secured.once('error', error => {
          finish(() => {
            reject(error instanceof Error ? error : new Error(String(error)));
          });
        });
      });

      connectReq.on('error', error => {
        finish(() => {
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      });

      connectReq.end();
    });
  }

  /**
   * Convert raw `Name: value` header lines into the object Node's request
   * options expect.
   *
   * @param headers Raw header lines, in `Name: value` form.
   *
   * @returns A header object, empty when there are no lines. A line without a
   *          `:` is skipped rather than sent malformed.
   */
  private static toHeaderObject(headers: readonly string[]): Record<string, string> {
    const result: Record<string, string> = {};

    for (const line of headers) {
      const separator = line.indexOf(':');
      if (separator === -1) {
        continue;
      }
      result[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    }

    return result;
  }

  /**
   * Strip the query string and fragment from a URL for `TransportInfo.url`.
   *
   * `loginId` and `password` — and, on the billing endpoints, cardholder
   * data — ride in the query string, so `target.toString()` is never safe
   * to hand back to a caller: `header.url` is returned verbatim by
   * `CallResult`, with no redaction applied, since it is meant to be shown
   * to the caller rather than only logged. Scheme, host and path still
   * serve the field's diagnostic purpose of showing where a (possibly
   * redirected) request landed.
   *
   * @param target The URL for the hop that produced this response.
   *
   * @returns The URL with its query string and fragment removed.
   */
  private static withoutQuery(target: URL): string {
    return `${target.origin}${target.pathname}`;
  }

  /**
   * Render an unknown thrown value as a transport error message.
   *
   * Node's own errors (DNS failure, connection refused, a malformed `URL`
   * constructor argument) are always `Error` instances with a usable
   * `message`, but the `catch` in `send` is typed to receive `unknown`, so
   * this still has to handle whatever else could technically be thrown.
   *
   * @param error The thrown or rejected value.
   *
   * @returns A human-readable message suitable for `Response.transportError`.
   */
  private static describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
