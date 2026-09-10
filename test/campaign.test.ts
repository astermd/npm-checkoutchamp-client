import { describe, it } from 'vitest';
import { Campaign } from '../src/campaign.js';
import { assertRequest, makeDeps } from './support/client-test-case.js';

describe('Campaign', () => {
  it('campaignQuery posts to /campaign/query/', async () => {
    const { config, http, logger } = makeDeps();
    await new Campaign(config, http, logger).campaignQuery({ campaignId: '7' });
    assertRequest(http, '/campaign/query/', { campaignId: '7' });
  });

  it('campaignQuery sends only the credentials when called with no parameters', async () => {
    const { config, http, logger } = makeDeps();
    await new Campaign(config, http, logger).campaignQuery();
    assertRequest(http, '/campaign/query/', {});
  });
});
