import { Campaign } from './campaign.js';
import type { CheckoutChamp } from './checkout-champ.js';
import { ClientConfig, type ClientOptions } from './client-config.js';
import { Customer } from './customer.js';
import { CheckoutChampError } from './errors.js';
import type { HttpClientInterface } from './http/http-client-interface.js';
import { HttpsClient } from './http/https-client.js';
import { Landers } from './landers.js';
import { DebugLogger } from './logging/debug-logger.js';
import { MESSAGES } from './messages.js';
import { Order } from './order.js';
import type { CallOptions, Params, PendingCall } from './pending-call.js';
import { Transaction } from './transaction.js';

/** The resources a dispatchable method can belong to. */
type ResourceKey = 'order' | 'campaign' | 'customer' | 'transaction' | 'landers';

/**
 * Entry point for the Checkout Champ API.
 *
 * Construct it with your API credentials, call any resource method, and read
 * the result:
 *
 * ```ts
 * const api = new API(loginId, password);
 * const data = await api.orderQuery({ orderId: '123' }).getInObject();
 * ```
 *
 * The login ID and password are required arguments. This package ships no
 * default credentials and reads none from the environment.
 *
 * A resource method returns a call that has not been sent yet; awaiting it, or
 * any of its accessors, performs the request exactly once. Every call carries
 * its own state, so issuing several concurrently against one client is safe —
 * worth stating because the PHP package this was ported from relies on a
 * request-per-process model where that question never arises.
 *
 * The provider's response is returned unchanged. This package adds no envelope
 * of its own: the `result` and `message` contract inside the body belongs to
 * Checkout Champ.
 *
 * Fourteen methods are declared explicitly rather than dispatched through a
 * single catch-all. The Composer package this was ported from reaches its
 * endpoints through PHP's `__call`, a `METHOD_MAP` constant, and `@method`
 * docblocks for editor support; TypeScript has no typed equivalent of
 * `__call`, and a JavaScript `Proxy` could imitate the same runtime shape only
 * by erasing per-method parameter and return types — the exact thing a
 * TypeScript port exists to keep. Declaring every method by hand costs
 * fourteen small, near-identical bodies and buys compile-time checking,
 * grep-ability, and editor autocomplete for all of them. The `METHOD_MAP`
 * survives anyway, because both {@link API.supportedMethods} and the dynamic
 * {@link API.call} still need one place that lists every dispatchable name.
 *
 * The client-level `get()`, `getInArray()` and `getInObject()` accessors the
 * Composer package exposes are also gone. There they read state left behind by
 * whichever call the client made most recently, which is safe only because
 * that package assumes one request per PHP process. Node has no such
 * assumption — two calls issued concurrently against one client are ordinary
 * here — so carrying "last call" state on the client would silently corrupt
 * one of them under real concurrency. The accessors live on the
 * {@link PendingCall} each resource method returns instead; every documented
 * Composer snippet still has a direct equivalent, chained off the call rather
 * than read back off the client, and nothing is lost but the race.
 */
export class API {
  /** Every dispatchable method, and the resource that implements it. */
  private static readonly METHOD_MAP: Readonly<Record<string, ResourceKey>> = Object.freeze({
    orderQuery: 'order',
    importLeads: 'order',
    updateOrder: 'order',
    preauth: 'order',
    importOrder: 'order',
    importUpsale: 'order',
    confirm: 'order',
    qa: 'order',
    campaignQuery: 'campaign',
    customerQuery: 'customer',
    addnote: 'customer',
    transactionsQuery: 'transaction',
    importClick: 'landers',
    confirmPaypal: 'landers',
  });

  private readonly order: Order;

  private readonly campaign: Campaign;

  private readonly customer: Customer;

  private readonly transaction: Transaction;

  private readonly landers: Landers;

  private readonly logger: DebugLogger;

  /**
   * Proxy address queued for the next resource call, or `null` when none is
   * set. See {@link withProxy} for why handing this to a resource
   * synchronously, with no `await` in between, is what makes it safe under
   * concurrent calls.
   */
  private proxyUrl: string | null = null;

  private proxyUserName: string | null = null;

  private proxyPassword: string | null = null;

  /**
   * Construct the client and eagerly build one instance of each resource.
   *
   * The Composer package lazily caches a resource the first time a call
   * reaches it. Here all five are built up front instead, in the constructor:
   * they are cheap value holders sharing this client's config, transport and
   * logger, so eager construction is behaviourally equivalent to lazy
   * caching — every resource method still sees the same three collaborators
   * on every call — and it is simpler to read, with no lazy-init branch to
   * maintain in five places.
   *
   * @param loginId  Checkout Champ API login ID. Required; there is no default.
   * @param password Checkout Champ API password. Required; there is no default.
   * @param options  Connection and logging settings.
   * @param http     Custom transport. Defaults to the built-in `node:https` client.
   *
   * @throws {CheckoutChampError} When a credential is empty, the host is not
   *                              bare, debug logging has no destination, the
   *                              debug sink is not callable, or the timezone is
   *                              not recognised.
   */
  public constructor(loginId: string, password: string, options: ClientOptions = {}, http?: HttpClientInterface) {
    const config = new ClientConfig(loginId, password, options);
    this.logger = DebugLogger.fromOptions(options);

    const transport = http ?? new HttpsClient(config.timeout, config.connectTimeout);

    this.order = new Order(config, transport, this.logger);
    this.campaign = new Campaign(config, transport, this.logger);
    this.customer = new Customer(config, transport, this.logger);
    this.transaction = new Transaction(config, transport, this.logger);
    this.landers = new Landers(config, transport, this.logger);
  }

  /**
   * Return information about existing orders.
   *
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
    return this.prepare(this.order).orderQuery(params, options);
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
    return this.prepare(this.order).importLeads(params, options);
  }

  /**
   * Update an existing order.
   *
   * Change fields on an order already in the CRM — shipping address, a
   * quantity, a note, a tracking number — without re-running the payment that
   * created it. This is the call a support desk uses after a customer reports
   * a shipping mistake, or a fulfilment system uses to attach a carrier
   * tracking number once a package ships. It does not touch billing; see
   * {@link importUpsale} for a call that also charges the card.
   *
   * POST `/order/update/`
   *
   * @param params  Fields to change, alongside the order identifier.
   * @param options Per-call settings.
   *
   * @returns The unsent call.
   */
  public updateOrder(params: Params = {}, options: CallOptions = {}): PendingCall {
    return this.prepare(this.order).updateOrder(params, options);
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
    return this.prepare(this.order).preauth(params, options);
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
    return this.prepare(this.order).importOrder(params, options);
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
    return this.prepare(this.order).importUpsale(params, options);
  }

  /**
   * Send confirmation auto-responder emails to the customer immediately.
   *
   * Trigger the order's confirmation auto-responder email right away rather
   * than waiting for the CRM's own schedule. A storefront calls this after
   * `importOrder` succeeds so the customer's receipt lands immediately
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
    return this.prepare(this.order).confirm(params, options);
  }

  /**
   * Approve or decline orders awaiting quality assurance.
   *
   * Record a reviewer's decision on an order a fraud or compliance queue has
   * flagged for manual review before it ships. Passing
   * `qaStatus: 'APPROVED'` releases the order to fulfilment; a decline routes
   * it to whatever refund or cancellation flow the account is configured to
   * run instead. This is typically the last call in a review workflow, made
   * from an internal dashboard rather than a customer-facing storefront.
   *
   * POST `/order/qa/`
   *
   * @param params  QA fields, e.g. `{ orderId, qaStatus }`.
   * @param options Per-call settings.
   *
   * @returns The unsent call.
   */
  public qa(params: Params = {}, options: CallOptions = {}): PendingCall {
    return this.prepare(this.order).qa(params, options);
  }

  /**
   * Return information about campaigns.
   *
   * Look up a campaign's configuration: its identifier, the products and
   * upsale paths attached to it, and its currently active pricing. A
   * storefront calls this at startup or on a cache miss to learn which
   * product identifiers to pass into `importOrder`, since those identifiers
   * are defined per campaign rather than fixed across the whole account.
   *
   * POST `/campaign/query/`
   *
   * @param params  Query parameters, e.g. `{ campaignId }`.
   * @param options Per-call settings.
   *
   * @returns The unsent call.
   */
  public campaignQuery(params: Params = {}, options: CallOptions = {}): PendingCall {
    return this.prepare(this.campaign).campaignQuery(params, options);
  }

  /**
   * Return information about existing customers.
   *
   * Look up a customer's account by identifier, email address or phone
   * number, and get back their contact details plus the identifiers of the
   * orders on file for them. A support agent typically runs this first when
   * a customer calls in, before pulling the specific order with
   * `orderQuery`, since a customer rarely knows their own order identifier
   * off-hand.
   *
   * POST `/customer/query/`
   *
   * @param params  Query parameters, e.g. `{ customerId }`.
   * @param options Per-call settings.
   *
   * @returns The unsent call.
   */
  public customerQuery(params: Params = {}, options: CallOptions = {}): PendingCall {
    return this.prepare(this.customer).customerQuery(params, options);
  }

  /**
   * Attach a note to a customer account.
   *
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
    return this.prepare(this.customer).addnote(params, options);
  }

  /**
   * Return information about transactions recorded in the CRM.
   *
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
    return this.prepare(this.transaction).transactionsQuery(params, options);
  }

  /**
   * Record a lander page click.
   *
   * A lander is the page a visitor arrives on before entering the checkout;
   * recording its clicks is what lets the provider attribute a later order to
   * the traffic that produced it. The only endpoint whose section is two path
   * segments deep.
   *
   * POST `/landers/clicks/import/`
   *
   * @param params  Click fields, e.g. `{ campaignId }`.
   * @param options Per-call settings.
   *
   * @returns The unsent call.
   */
  public importClick(params: Params = {}, options: CallOptions = {}): PendingCall {
    return this.prepare(this.landers).importClick(params, options);
  }

  /**
   * Confirm a PayPal transaction.
   *
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
    return this.prepare(this.landers).confirmPaypal(params, options);
  }

  /**
   * Route the next call through an HTTP proxy.
   *
   * The setting applies to the next resource call only and is then cleared.
   * It is handed to the resource synchronously, with no `await` between the
   * write here and the resource's own read of it in `sendPost` — the same
   * one-shot-latch discipline `CheckoutChamp.setProxy` documents. That
   * ordering is what makes queuing a proxy safe even while another call is
   * in flight on this same client: nothing can run on this object's turn of
   * the event loop between the caller setting the latch and {@link prepare}
   * consuming it, so a concurrent, unrelated call has no window in which to
   * pick up a proxy meant for a different one.
   *
   * @param proxyUrl      Proxy address as a bare `host:port`, e.g.
   *                      `proxy.example.test:8080` — no scheme. Prefixing it
   *                      with `http://` is parsed as `host:port` too, which
   *                      turns the literal word `http` into the hostname and
   *                      fails with a DNS lookup error rather than doing what
   *                      it looks like it should. An empty value is ignored.
   * @param proxyUserName Proxy username, when the proxy requires one.
   * @param proxyPassword Proxy password, when the proxy requires one.
   *
   * @returns This client, so the resource call chains.
   */
  public withProxy(proxyUrl: string, proxyUserName = '', proxyPassword = ''): this {
    if (proxyUrl !== '') {
      this.proxyUrl = proxyUrl;
      this.proxyUserName = proxyUserName === '' ? null : proxyUserName;
      this.proxyPassword = proxyPassword === '' ? null : proxyPassword;
    }

    return this;
  }

  /**
   * Dispatch a resource method chosen at runtime.
   *
   * The declared methods above are the supported surface; this exists for a
   * caller that holds the method name in a variable, which PHP's `__call`
   * allowed for free.
   *
   * @param method  One of {@link API.supportedMethods}.
   * @param params  Endpoint parameters.
   * @param options Per-call settings.
   *
   * @returns The unsent call.
   *
   * @throws {CheckoutChampError} When no resource implements the method.
   */
  public call(method: string, params: Params = {}, options: CallOptions = {}): PendingCall {
    if (!Object.hasOwn(API.METHOD_MAP, method)) {
      throw new CheckoutChampError(MESSAGES.methodNotFound);
    }

    // Safe by the membership check above: only the fourteen names in
    // METHOD_MAP reach this cast, and every one of them names a declared
    // method on this class with exactly this signature. Without that check, a
    // name colliding with another own member of this class — `call` itself,
    // `withProxy`, `flushDebugLog`, the private `prepare` — would resolve to
    // a real, non-`undefined` function here and be invoked with the wrong
    // arguments instead of being rejected.
    const dispatch = this as unknown as Record<string, ((p: Params, o: CallOptions) => PendingCall) | undefined>;

    const fn = dispatch[method];
    if (fn === undefined) {
      throw new CheckoutChampError(MESSAGES.methodNotFound);
    }

    return fn.call(this, params, options);
  }

  /**
   * Wait for every queued debug log entry to reach its destination.
   *
   * Logging is asynchronous, so a short-lived process can exit before an entry
   * lands. Await this before exit when the log matters. Resolves immediately
   * when logging is off.
   *
   * @returns A promise that settles once the log is drained.
   */
  public async flushDebugLog(): Promise<void> {
    await this.logger.flush();
  }

  /**
   * Resource methods this client can dispatch.
   *
   * The order matches the documentation's own grouping — orders and leads
   * first, then campaigns, customers, transactions, landers — not
   * alphabetical order, since `Object.keys` preserves the insertion order of
   * {@link API.METHOD_MAP}. These are exactly the names {@link API.call}
   * accepts; any other name, including one that collides with a member of
   * this class itself, is rejected.
   *
   * @returns The method names, in the order the documentation lists them.
   */
  public static supportedMethods(): string[] {
    return Object.keys(API.METHOD_MAP);
  }

  /**
   * Hand a queued proxy to the resource about to be called, then clear it.
   *
   * There is no `await` between this and the resource method's own read of the
   * setting, so the one-shot latch cannot be picked up by an unrelated call.
   *
   * @param resource The resource about to be called.
   *
   * @returns The same resource, for chaining.
   */
  private prepare<T extends CheckoutChamp>(resource: T): T {
    if (this.proxyUrl !== null) {
      resource.setProxy(this.proxyUrl, this.proxyUserName, this.proxyPassword);
      this.proxyUrl = null;
      this.proxyUserName = null;
      this.proxyPassword = null;
    }

    return resource;
  }
}
