import type { Request } from './request.js';
import type { Response } from './response.js';

/**
 * The transport seam.
 *
 * Implement this to route requests through your own HTTP stack — a shared
 * agent pool, an egress proxy, a queue, a recorded fixture — and pass the
 * implementation as the fourth argument to the client's constructor. The
 * package's own test suite uses this seam, which is how no test performs real
 * network I/O.
 *
 * Implementations must not throw on transport failure. Report it through
 * `Response.transportError` instead, so the debug logger can record the attempt
 * and the caller receives the documented `curlError` shape rather than an
 * exception.
 */
export interface HttpClientInterface {
  /**
   * Perform the request and return the response.
   *
   * @param request The frozen request description.
   *
   * @returns The response, carrying any transport failure as data.
   */
  send(request: Request): Promise<Response>;
}
