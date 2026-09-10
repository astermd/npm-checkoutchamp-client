import { CheckoutChampError } from './errors.js';
import type { Response, TransportInfo } from './http/response.js';
import { MESSAGES } from './messages.js';

/**
 * The endpoint and parameters used by one call.
 *
 * The *configured* credentials — `loginId` and `password` as `ClientConfig`
 * holds them — are deliberately absent, and that is the entire guarantee.
 * Everything else the caller passed in `params` is echoed back verbatim,
 * which on `importOrder`, `preauth` and `importUpsale` is the full cardholder
 * object the caller supplied: this value is not blanket-safe to log or show
 * to an end user on those endpoints, and the same PCI handling that applies
 * to the request URL applies here too. A caller-supplied `password` key
 * (distinct from the configured one) also survives into this snapshot even
 * though it never reaches the wire — {@link ../support/build-query.js}
 * discards it in favour of the configured value, but this object is built
 * from `params` before that substitution happens.
 */
export interface PayloadInfo {
  /** Absolute endpoint URL, without its query string. */
  endPoint: string;
  /** The caller's own parameters, verbatim. */
  [param: string]: unknown;
}

/**
 * The response body as it arrived, before any decoding.
 *
 * A plain string normally; an object carrying transport metadata alongside the
 * body when the call asked for `headerRequired`.
 */
export type RawResponse =
  string | { content: string; header: Readonly<TransportInfo> | Readonly<Record<string, never>> };

/**
 * The settled outcome of one Checkout Champ call.
 *
 * Holds the provider's response and the credential-free snapshot of what was
 * sent, and reads them back in two shapes. It adds no envelope of its own: the
 * provider's body is returned exactly as it arrived, and the `result` and
 * `message` contract inside it belongs to Checkout Champ, not to this package.
 *
 * A transport failure — a connection that never completed — is not an error
 * here. It reaches the caller as the message string from `get()` and as a
 * `curlError` property from `getInObject()`, matching the Composer package this
 * was ported from.
 */
export class CallResult {
  private readonly url: string;

  private readonly payload: Record<string, unknown>;

  private readonly response: Response;

  private readonly headerRequired: boolean;

  /**
   * @param url            Endpoint URL without its query string.
   * @param payload        The caller's own parameters, credentials excluded.
   * @param response       The transport's response.
   * @param headerRequired Wrap the response with its transport metadata.
   */
  public constructor(url: string, payload: Record<string, unknown>, response: Response, headerRequired: boolean) {
    this.url = url;
    this.payload = { ...payload };
    this.response = response;
    this.headerRequired = headerRequired;

    Object.freeze(this);
  }

  /**
   * The provider's raw response body.
   *
   * On a transport failure this is the failure message rather than a body. That
   * matches the Composer package, where the raw accessor returns the error text
   * unwrapped while the decoded accessor returns a `curlError` object.
   *
   * @param payloadFlag Include the endpoint and the caller's parameters.
   *
   * @returns The raw body, wrapped with transport metadata when the call asked
   *          for it.
   */
  public get(payloadFlag = false): { response: RawResponse; payload?: PayloadInfo } {
    const body = this.response.hasTransportError() ? this.response.transportError : this.response.body;

    const response: RawResponse =
      this.headerRequired && !this.response.hasTransportError() ? { content: body, header: this.response.info } : body;

    return payloadFlag ? { response, payload: this.getPayloadInfo() } : { response };
  }

  /**
   * The provider's response, decoded.
   *
   * @param payloadFlag Include the endpoint and the caller's parameters.
   *
   * @returns The decoded body, wrapped with transport metadata when the call
   *          asked for it, or `{ curlError }` when the request never completed.
   *
   * @throws {CheckoutChampError} When the response body is not valid JSON.
   */
  public getInObject(payloadFlag = false): { response: unknown; payload?: PayloadInfo } {
    let response: unknown;

    if (this.response.hasTransportError()) {
      response = { curlError: this.response.transportError };
    } else {
      const decoded = CallResult.decode(this.response.body);
      response = this.headerRequired ? { content: decoded, header: this.response.info } : decoded;
    }

    return payloadFlag ? { response, payload: this.getPayloadInfo() } : { response };
  }

  /**
   * The endpoint and parameters used by this call.
   *
   * The *configured* `loginId` and `password` are deliberately absent — see
   * {@link PayloadInfo} for the full scope of that guarantee, and its limit:
   * on `importOrder`, `preauth` and `importUpsale` this is the caller's own
   * cardholder data, echoed back verbatim.
   *
   * @returns A fresh object each call, so a caller cannot mutate the snapshot.
   */
  public getPayloadInfo(): PayloadInfo {
    return { endPoint: this.url, ...this.payload };
  }

  /**
   * Decode a JSON response body.
   *
   * @param body The raw body.
   *
   * @returns The decoded value.
   *
   * @throws {CheckoutChampError} When the body is not valid JSON.
   */
  private static decode(body: string): unknown {
    try {
      return JSON.parse(body);
    } catch {
      throw new CheckoutChampError(MESSAGES.jsonFormatError);
    }
  }
}
