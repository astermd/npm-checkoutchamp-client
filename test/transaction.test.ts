import { describe, it } from 'vitest';
import { Transaction } from '../src/transaction.js';
import { assertRequest, makeDeps } from './support/client-test-case.js';

describe('Transaction', () => {
  it('transactionsQuery posts to /transactions/query/', async () => {
    const { config, http, logger } = makeDeps();
    await new Transaction(config, http, logger).transactionsQuery({ orderId: '123' });
    assertRequest(http, '/transactions/query/', { orderId: '123' });
  });

  it('transactionsQuery sends only the credentials when called with no parameters', async () => {
    const { config, http, logger } = makeDeps();
    await new Transaction(config, http, logger).transactionsQuery();
    assertRequest(http, '/transactions/query/', {});
  });
});
