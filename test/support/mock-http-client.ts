import type { HttpClientInterface } from '../../src/http/http-client-interface.js';
import type { Request } from '../../src/http/request.js';
import { Response } from '../../src/http/response.js';

/**
 * Recording transport used by the whole suite.
 *
 * Nothing here touches the network. Every request is captured so a test can
 * assert the URL, method, headers and body that would have been sent.
 */
export class MockHttpClient implements HttpClientInterface {
  private readonly recorded: Request[] = [];

  private readonly pending: Response[] = [];

  private readonly fallback: Response;

  public constructor(fallback?: Response) {
    this.fallback = fallback ?? new Response(200, '{"ok":true}', { http_code: 200 });
  }

  public queue(response: Response): this {
    this.pending.push(response);

    return this;
  }

  public send(request: Request): Promise<Response> {
    this.recorded.push(request);

    return Promise.resolve(this.pending.shift() ?? this.fallback);
  }

  public lastRequest(): Request {
    const last = this.recorded.at(-1);
    if (last === undefined) {
      throw new Error('No request was recorded.');
    }

    return last;
  }

  public requests(): readonly Request[] {
    return this.recorded;
  }

  public count(): number {
    return this.recorded.length;
  }
}
