import { CheckoutChamp } from './checkout-champ.js';
import type { CallOptions, Params, PendingCall } from './pending-call.js';

/**
 * Order, lead and upsale endpoints.
 *
 * The busiest resource in the package, and the one that carries the most
 * sensitive data. Several of these endpoints transmit personal and cardholder
 * details, and because this API sends every parameter in the query string,
 * those values appear in the URL. See the README for what debug logging does
 * about it, and the compliance note for what it means for your PCI DSS scope.
 *
 * Every method takes the provider's own parameter names. Consult the Checkout
 * Champ API reference for the fields each endpoint accepts.
 */
export class Order extends CheckoutChamp {
  /**
   * Look up one or more orders by identifier, customer, campaign, date range
   * or status, and get back the full order record: line items, billing and
   * shipping details, and the status history the CRM has recorded for it.
   * Support tooling and reconciliation jobs both reach for this before any
   * other order call, since it is the only way to see current state without
   * placing or changing anything.
   *
   * POST `/order/query/`
   *
   * @param params  Query parameters, e.g. `{ orderId }`.
   * @param options Per-call settings.
   *
   * @returns The unsent call.
   */
  public orderQuery(params: Params = {}, options: CallOptions = {}): PendingCall {
    return this.sendPost('order', 'query', params, options);
  }

  /**
   * Add a new lead to the CRM.
   *
   * Usually the first call in a checkout flow, before `preauth` or
   * `importOrder`.
   *
   * POST `/leads/import/`
   *
   * @param params  Lead fields, e.g. `{ campaignId, emailAddress }`.
   * @param options Per-call settings.
   *
   * @returns The unsent call.
   */
  public importLeads(params: Params = {}, options: CallOptions = {}): PendingCall {
    return this.sendPost('leads', 'import', params, options);
  }

  /**
   * Change fields on an order already in the CRM — shipping address, a
   * quantity, a note, a tracking number — without re-running the payment
   * that created it. This is the call a support desk uses after a customer
   * reports a shipping mistake, or a fulfilment system uses to attach a
   * carrier tracking number once a package ships. It does not touch billing;
   * see {@link importUpsale} for a call that also charges the card.
   *
   * POST `/order/update/`
   *
   * @param params  Fields to change, alongside the order identifier.
   * @param options Per-call settings.
   *
   * @returns The unsent call.
   */
  public updateOrder(params: Params = {}, options: CallOptions = {}): PendingCall {
    return this.sendPost('order', 'update', params, options);
  }

  /**
   * Pre-authorise a card on a new order before billing the final charge.
   *
   * Usually called after `importLeads`. Transmits cardholder data as query
   * parameters.
   *
   * POST `/order/preauth/`
   *
   * @param params  Pre-authorisation fields.
   * @param options Per-call settings.
   *
   * @returns The unsent call.
   */
  public preauth(params: Params = {}, options: CallOptions = {}): PendingCall {
    return this.sendPost('order', 'preauth', params, options);
  }

  /**
   * Create a new order and bill the customer.
   *
   * Transmits cardholder data as query parameters.
   *
   * POST `/order/import/`
   *
   * @param params  Order fields, e.g. `{ sessionId, product1_id }`.
   * @param options Per-call settings.
   *
   * @returns The unsent call.
   */
  public importOrder(params: Params = {}, options: CallOptions = {}): PendingCall {
    return this.sendPost('order', 'import', params, options);
  }

  /**
   * Bill and attach an upsale to an existing order.
   *
   * Transmits cardholder data as query parameters.
   *
   * POST `/upsale/import/`
   *
   * @param params  Upsale fields, alongside the order identifier.
   * @param options Per-call settings.
   *
   * @returns The unsent call.
   */
  public importUpsale(params: Params = {}, options: CallOptions = {}): PendingCall {
    return this.sendPost('upsale', 'import', params, options);
  }

  /**
   * Trigger the order's confirmation auto-responder email right away rather
   * than waiting for the CRM's own schedule. A storefront calls this after
   * {@link importOrder} succeeds so the customer's receipt lands immediately
   * instead of on whatever delay the account's email rules would otherwise
   * apply, which matters most for a same-day or expedited purchase.
   *
   * POST `/order/confirm/`
   *
   * @param params  Confirmation fields, e.g. `{ orderId }`.
   * @param options Per-call settings.
   *
   * @returns The unsent call.
   */
  public confirm(params: Params = {}, options: CallOptions = {}): PendingCall {
    return this.sendPost('order', 'confirm', params, options);
  }

  /**
   * Record a reviewer's decision on an order a fraud or compliance queue has
   * flagged for manual review before it ships. Passing `qaStatus: 'APPROVED'`
   * releases the order to fulfilment; a decline routes it to whatever refund
   * or cancellation flow the account is configured to run instead. This is
   * typically the last call in a review workflow, made from an internal
   * dashboard rather than a customer-facing storefront.
   *
   * POST `/order/qa/`
   *
   * @param params  QA fields, e.g. `{ orderId, qaStatus }`.
   * @param options Per-call settings.
   *
   * @returns The unsent call.
   */
  public qa(params: Params = {}, options: CallOptions = {}): PendingCall {
    return this.sendPost('order', 'qa', params, options);
  }
}
