import { CheckoutChamp } from './checkout-champ.js';
import type { CallOptions, Params, PendingCall } from './pending-call.js';

/**
 * Campaign endpoints.
 *
 * A campaign is the container an order or lead is attributed to, so its
 * identifier appears in most other calls. Reading campaigns back is how a
 * storefront discovers the identifiers and product configuration it needs.
 */
export class Campaign extends CheckoutChamp {
  /**
   * Look up a campaign's configuration: its identifier, the products and
   * upsale paths attached to it, and its currently active pricing. A
   * storefront calls this at startup or on a cache miss to learn which
   * product identifiers to pass into `Order.importOrder`, since those
   * identifiers are defined per campaign rather than fixed across the whole
   * account.
   *
   * POST `/campaign/query/`
   *
   * @param params  Query parameters, e.g. `{ campaignId }`.
   * @param options Per-call settings.
   *
   * @returns The unsent call.
   */
  public campaignQuery(params: Params = {}, options: CallOptions = {}): PendingCall {
    return this.sendPost('campaign', 'query', params, options);
  }
}
