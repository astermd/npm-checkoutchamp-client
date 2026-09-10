/**
 * Public entry point for `@astermd-hq/checkoutchamp-client`.
 *
 * `API` is the only class most consumers construct. The rest are exported so a
 * custom transport can be written against the same value objects, and so the
 * logging pieces can be reused or inspected.
 */
export { API } from './api.js';
export { CheckoutChamp } from './checkout-champ.js';
export { Order } from './order.js';
export { Campaign } from './campaign.js';
export { Customer } from './customer.js';
export { Transaction } from './transaction.js';
export { Landers } from './landers.js';

export { ClientConfig } from './client-config.js';
export type { ClientOptions, DebugSink } from './client-config.js';

export { CheckoutChampError } from './errors.js';
export { MESSAGES } from './messages.js';

export { PendingCall } from './pending-call.js';
export type { CallOptions, CallSpec, Params } from './pending-call.js';
export { CallResult } from './call-result.js';
export type { PayloadInfo, RawResponse } from './call-result.js';

export { Request } from './http/request.js';
export { Response } from './http/response.js';
export type { TransportInfo } from './http/response.js';
export type { HttpClientInterface } from './http/http-client-interface.js';
export { HttpsClient } from './http/https-client.js';

export { DebugLogger } from './logging/debug-logger.js';
export { FileSink } from './logging/file-sink.js';
export { Redactor } from './logging/redactor.js';
