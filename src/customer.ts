import { CheckoutChamp } from './checkout-champ.js';
import type { CallOptions, Params, PendingCall } from './pending-call.js';

/**
 * Customer endpoints.
 *
 * Customer records outlive any single order, so these are the calls a support
 * tool reaches for: look a customer up, and attach a note recording what was
 * said or done.
 */
export class Customer extends CheckoutChamp {
  /**
   * Look up a customer's account by identifier, email address or phone
   * number, and get back their contact details plus the identifiers of the
   * orders on file for them. A support agent typically runs this first when
   * a customer calls in, before pulling the specific order with
   * `Order.orderQuery`, since a customer rarely knows their own order
   * identifier off-hand.
   *
   * POST `/customer/query/`
   *
   * @param params  Query parameters, e.g. `{ customerId }`.
   * @param options Per-call settings.
   *
   * @returns The unsent call.
   */
  public customerQuery(params: Params = {}, options: CallOptions = {}): PendingCall {
    return this.sendPost('customer', 'query', params, options);
  }

  /**
   * Record a free-text note against a customer's account, timestamped by the
   * CRM. This is how a support interaction gets logged for whoever handles
   * that customer next — what was said on a call, why a refund was granted,
   * or that a shipping address was confirmed by phone — without it living
   * only in a ticketing system the CRM cannot see.
   *
   * POST `/customer/addnote/`
   *
   * @param params  Note fields, e.g. `{ customerId, note }`.
   * @param options Per-call settings.
   *
   * @returns The unsent call.
   */
  public addnote(params: Params = {}, options: CallOptions = {}): PendingCall {
    return this.sendPost('customer', 'addnote', params, options);
  }
}
