import { describe, it } from 'vitest';
import { Customer } from '../src/customer.js';
import { assertRequest, makeDeps } from './support/client-test-case.js';

describe('Customer', () => {
  it('customerQuery posts to /customer/query/', async () => {
    const { config, http, logger } = makeDeps();
    await new Customer(config, http, logger).customerQuery({ customerId: '5' });
    assertRequest(http, '/customer/query/', { customerId: '5' });
  });

  it('addnote posts to /customer/addnote/', async () => {
    const { config, http, logger } = makeDeps();
    await new Customer(config, http, logger).addnote({ customerId: '5', note: 'called back' });
    assertRequest(http, '/customer/addnote/', { customerId: '5', note: 'called back' });
  });

  it('customerQuery sends only the credentials when called with no parameters', async () => {
    const { config, http, logger } = makeDeps();
    await new Customer(config, http, logger).customerQuery();
    assertRequest(http, '/customer/query/', {});
  });

  it('addnote sends only the credentials when called with no parameters', async () => {
    const { config, http, logger } = makeDeps();
    await new Customer(config, http, logger).addnote();
    assertRequest(http, '/customer/addnote/', {});
  });
});
