import { describe, it } from 'vitest';
import { Landers } from '../src/landers.js';
import { assertRequest, makeDeps } from './support/client-test-case.js';

describe('Landers', () => {
  it('importClick posts to the two-segment /landers/clicks/import/ path', async () => {
    const { config, http, logger } = makeDeps();
    await new Landers(config, http, logger).importClick({ campaignId: '7' });
    assertRequest(http, '/landers/clicks/import/', { campaignId: '7' });
  });

  it('confirmPaypal posts to /transactions/confirmPaypal/', async () => {
    const { config, http, logger } = makeDeps();
    await new Landers(config, http, logger).confirmPaypal({ orderId: '123' });
    assertRequest(http, '/transactions/confirmPaypal/', { orderId: '123' });
  });

  it('importClick sends only the credentials when called with no parameters', async () => {
    const { config, http, logger } = makeDeps();
    await new Landers(config, http, logger).importClick();
    assertRequest(http, '/landers/clicks/import/', {});
  });

  it('confirmPaypal sends only the credentials when called with no parameters', async () => {
    const { config, http, logger } = makeDeps();
    await new Landers(config, http, logger).confirmPaypal();
    assertRequest(http, '/transactions/confirmPaypal/', {});
  });
});
