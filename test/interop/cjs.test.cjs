const assert = require('node:assert/strict');
const { API, CallResult, CheckoutChampError, PendingCall, Request, Response } = require('../../dist/index.cjs');

const error = new CheckoutChampError('boom');
assert.ok(
  error instanceof CheckoutChampError,
  'instanceof must hold across the CJS module boundary in the built output',
);
assert.ok(error instanceof Error, 'the error must still be an Error');
assert.equal(error.name, 'CheckoutChampError');

assert.equal(typeof API, 'function');
assert.equal(typeof PendingCall, 'function');
assert.equal(typeof CallResult, 'function');
assert.equal(API.supportedMethods().length, 14);

const request = new Request('post', 'https://api.checkoutchamp.com/order/query/');
assert.equal(request.method, 'POST');
assert.ok(Object.isFrozen(request));

const response = new Response(200, '{}', { http_code: 200 });
assert.equal(response.hasTransportError(), false);

try {
  new API('', '');
  assert.fail('an empty credential must be rejected');
} catch (thrown) {
  assert.ok(
    thrown instanceof CheckoutChampError,
    'a thrown error must remain catchable by class across the module boundary',
  );
}

console.log('cjs interop ok');
