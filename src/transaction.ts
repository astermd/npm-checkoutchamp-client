import { CheckoutChamp } from './checkout-champ.js';
import type { CallOptions, Params, PendingCall } from './pending-call.js';

/**
 * Transaction endpoints.
 *
 * A transaction is the record of one attempt to move money — an authorisation,
 * a capture, a decline, a refund. Reading them back is how reconciliation and
 * dispute handling find out what actually happened to an order.
 */
export class Transaction extends CheckoutChamp {
  /**
   * Look up the transactions recorded against an order, a date range, or a
   * gateway response code, and get back each attempt's amount, result and
   * timestamp — one row per authorisation, capture, decline or refund. This
   * is the call reconciliation and dispute-handling reach for, since an
   * order's current balance can only be reconstructed from its full
   * transaction history rather than from the order record alone.
   *
   * POST `/transactions/query/`
   *
   * @param params  Query parameters, e.g. `{ orderId }`.
   * @param options Per-call settings.
   *
   * @returns The unsent call.
   */
  public transactionsQuery(params: Params = {}, options: CallOptions = {}): PendingCall {
    return this.sendPost('transactions', 'query', params, options);
  }
}
