import { describe, expect, it } from 'vitest';
import { Order } from '../src/order.js';
import { assertRequest, makeDeps } from './support/client-test-case.js';

function order() {
  const { config, http, logger } = makeDeps();

  return { resource: new Order(config, http, logger), http };
}

describe('Order', () => {
  it('orderQuery posts to /order/query/', async () => {
    const { resource, http } = order();
    await resource.orderQuery({ orderId: '123' });
    assertRequest(http, '/order/query/', { orderId: '123' });
  });

  it('importLeads posts to /leads/import/', async () => {
    const { resource, http } = order();
    await resource.importLeads({ campaignId: '7', emailAddress: 'buyer@example.test' });
    assertRequest(http, '/leads/import/', {
      campaignId: '7',
      emailAddress: 'buyer@example.test',
    });
  });

  it('updateOrder posts to /order/update/', async () => {
    const { resource, http } = order();
    await resource.updateOrder({ orderId: '123' });
    assertRequest(http, '/order/update/', { orderId: '123' });
  });

  it('preauth posts to /order/preauth/', async () => {
    const { resource, http } = order();
    await resource.preauth({ sessionId: 'sess_1' });
    assertRequest(http, '/order/preauth/', { sessionId: 'sess_1' });
  });

  it('importOrder posts to /order/import/', async () => {
    const { resource, http } = order();
    await resource.importOrder({ sessionId: 'sess_1', product1_id: '9' });
    assertRequest(http, '/order/import/', { sessionId: 'sess_1', product1_id: '9' });
  });

  it('importUpsale posts to /upsale/import/', async () => {
    const { resource, http } = order();
    await resource.importUpsale({ orderId: '123' });
    assertRequest(http, '/upsale/import/', { orderId: '123' });
  });

  it('confirm posts to /order/confirm/', async () => {
    const { resource, http } = order();
    await resource.confirm({ orderId: '123' });
    assertRequest(http, '/order/confirm/', { orderId: '123' });
  });

  it('qa posts to /order/qa/', async () => {
    const { resource, http } = order();
    await resource.qa({ orderId: '123', qaStatus: 'APPROVED' });
    assertRequest(http, '/order/qa/', { orderId: '123', qaStatus: 'APPROVED' });
  });

  it('sends only the credentials when called with no parameters', async () => {
    const { resource, http } = order();
    await resource.orderQuery();
    assertRequest(http, '/order/query/', {});
  });

  it('excludes the credentials from the payload snapshot', async () => {
    const { resource } = order();
    const payload = await resource.orderQuery({ orderId: '123' }).getPayloadInfo();

    expect(payload).toEqual({
      endPoint: 'https://api.checkoutchamp.com/order/query/',
      orderId: '123',
    });
  });

  it('cannot have its credentials shadowed by a caller parameter', async () => {
    const { resource, http } = order();
    await resource.importOrder({ loginId: 'attacker', password: 'attacker' });

    // assertRequest proves each credential appears exactly once, with the
    // configured value, and that no caller copy survived.
    assertRequest(http, '/order/import/', {});
  });
});
