import { CallResult, type PayloadInfo, type RawResponse } from './call-result.js';
import type { HttpClientInterface } from './http/http-client-interface.js';
import type { Request } from './http/request.js';
import type { DebugLogger } from './logging/debug-logger.js';

/** Caller parameters for one endpoint, passed through to the provider verbatim. */
export type Params = Record<string, unknown>;

/** Per-call settings that are not endpoint parameters. */
export interface CallOptions {
  /**
   * Wrap the response with its transport metadata as `{ content, header }`.
   *
   * Off by default.
   */
  headerRequired?: boolean;
}

/** Everything {@link PendingCall} needs to perform one exchange. */
export interface CallSpec {
  /** The frozen request, fully assembled. */
  request: Request;
  /** Endpoint URL without its query string, for the payload snapshot. */
  url: string;
  /** The caller's own parameters, credentials excluded. */
  payload: Params;
  /** Whether to wrap the response with its transport metadata. */
  headerRequired: boolean;
  /** The transport to send through. */
  http: HttpClientInterface;
  /** The observer that records the exchange. */
  logger: DebugLogger;
}

/**
 * One Checkout Champ call, unsent.
 *
 * Returned by every resource method so a call site reads almost exactly as the
 * Composer package's does — `await api.orderQuery({ orderId }).getInObject()`
 * against PHP's `$api->orderQuery([...])->getInArray()`. The single `await` is
 * the only thing the language forced.
 *
 * The request is not sent until the call is awaited or an accessor is used, and
 * the resulting promise is cached, so reading two shapes from one call performs
 * one HTTP request. Every call owns its own state: unlike PHP's
 * request-per-process model, two concurrent calls on one client are common in
 * Node, and nothing here is shared between them.
 */
export class PendingCall implements PromiseLike<CallResult> {
  private readonly spec: CallSpec;

  /** The in-flight or settled exchange, or `null` before the first use. */
  private started: Promise<CallResult> | null = null;

  /**
   * @param spec Everything needed to perform the exchange.
   */
  public constructor(spec: CallSpec) {
    this.spec = spec;
  }

  /**
   * The provider's raw response body.
   *
   * @param payloadFlag Include the endpoint and the caller's parameters.
   *
   * @returns The raw body, and the payload when asked for.
   */
  public async get(payloadFlag = false): Promise<{ response: RawResponse; payload?: PayloadInfo }> {
    return (await this.run()).get(payloadFlag);
  }

  /**
   * The provider's response, decoded.
   *
   * @param payloadFlag Include the endpoint and the caller's parameters.
   *
   * @returns The decoded body, and the payload when asked for.
   *
   * @throws {CheckoutChampError} When the response body is not valid JSON.
   */
  public async getInObject(payloadFlag = false): Promise<{ response: unknown; payload?: PayloadInfo }> {
    return (await this.run()).getInObject(payloadFlag);
  }

  /**
   * The endpoint and parameters this call used, credentials excluded.
   *
   * @returns The credential-free snapshot.
   */
  public async getPayloadInfo(): Promise<PayloadInfo> {
    return (await this.run()).getPayloadInfo();
  }

  /**
   * Make the call awaitable, resolving to the settled result.
   *
   * @param onfulfilled Called with the settled {@link CallResult}.
   * @param onrejected  Called when the exchange could not be attempted.
   *
   * @returns A promise chained onto this call.
   */
  public then<TResult1 = CallResult, TResult2 = never>(
    onfulfilled?: ((value: CallResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }

  /**
   * Perform the exchange, at most once.
   *
   * The first call from any accessor or `await` creates and caches the
   * promise in {@link started}; every later call, whichever accessor it comes
   * through, returns that same cached promise instead of sending again. This
   * is what lets `getInObject()` and `getPayloadInfo()` be read off one
   * `PendingCall` while only one HTTP request is ever made.
   *
   * @returns The settled result.
   */
  private run(): Promise<CallResult> {
    this.started ??= this.perform();

    return this.started;
  }

  /**
   * Send the request, let the logger observe it, and wrap the outcome.
   *
   * @returns The settled result.
   */
  private async perform(): Promise<CallResult> {
    const response = await this.spec.http.send(this.spec.request);

    this.spec.logger.log(this.spec.request, response);

    return new CallResult(this.spec.url, this.spec.payload, response, this.spec.headerRequired);
  }
}
