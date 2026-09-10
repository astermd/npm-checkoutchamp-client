import { CheckoutChamp } from './checkout-champ.js';
import type { CallOptions, Params, PendingCall } from './pending-call.js';

/**
 * Lander page and PayPal confirmation endpoints.
 *
 * A lander is the page a visitor arrives on before entering the checkout, and
 * recording its clicks is what lets the provider attribute a later order to the
 * traffic that produced it. The PayPal confirmation lives here rather than on
 * the transaction resource because it completes a flow that begins off-site.
 */
export class Landers extends CheckoutChamp {
  /**
   * Record a lander page click.
   *
   * The only endpoint whose section is two path segments deep.
   *
   * POST `/landers/clicks/import/`
   *
   * @param params  Click fields, e.g. `{ campaignId }`.
   * @param options Per-call settings.
   *
   * @returns The unsent call.
   */
  public importClick(params: Params = {}, options: CallOptions = {}): PendingCall {
    return this.sendPost('landers/clicks', 'import', params, options);
  }

  /**
   * Complete an order whose payment was authorised on PayPal's own site
   * rather than by a card submitted directly to Checkout Champ. A PayPal
   * checkout redirects the buyer away and back, so the order the storefront
   * created earlier sits unfinished until this call tells the CRM the
   * off-site approval succeeded and it is safe to finish billing and
   * fulfilment.
   *
   * POST `/transactions/confirmPaypal/`
   *
   * @param params  Confirmation fields, e.g. `{ orderId }`.
   * @param options Per-call settings.
   *
   * @returns The unsent call.
   */
  public confirmPaypal(params: Params = {}, options: CallOptions = {}): PendingCall {
    return this.sendPost('transactions', 'confirmPaypal', params, options);
  }
}
