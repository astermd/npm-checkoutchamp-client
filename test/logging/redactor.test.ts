import { describe, expect, it } from 'vitest';
import { Redactor } from '../../src/logging/redactor.js';

const MASK = '[REDACTED]';
const redactor = new Redactor();

describe('Redactor.redactUrl', () => {
  it('masks the credentials this API puts in the query string', () => {
    const url = 'https://api.checkoutchamp.com/order/query/?orderId=123&loginId=abc&password=xyz';
    expect(redactor.redactUrl(url)).toBe(
      `https://api.checkoutchamp.com/order/query/?orderId=123&loginId=${MASK}&password=${MASK}`,
    );
  });

  it('preserves the scheme, host and path so the entry stays reproducible', () => {
    const url = 'https://api.checkoutchamp.com/order/import/?password=xyz';
    expect(redactor.redactUrl(url).split('?')[0]).toBe('https://api.checkoutchamp.com/order/import/');
  });

  it('preserves non-sensitive parameters so the call is still identifiable', () => {
    const url = 'https://api.checkoutchamp.com/order/qa/?orderId=123&qaStatus=APPROVED';
    expect(redactor.redactUrl(url)).toBe(url);
  });

  it('masks cardholder parameters', () => {
    const url = 'https://api.checkoutchamp.com/order/import/?cardNumber=4111111111111111&cvv=123';
    expect(redactor.redactUrl(url)).toBe(`https://api.checkoutchamp.com/order/import/?cardNumber=${MASK}&cvv=${MASK}`);
  });

  it('masks a card number hiding under an unexpected parameter name, by Luhn shape', () => {
    const url = 'https://api.checkoutchamp.com/order/import/?ref=4111111111111111';
    expect(redactor.redactUrl(url)).toBe(`https://api.checkoutchamp.com/order/import/?ref=${MASK}`);
  });

  it('leaves an ordinary numeric identifier alone when it fails the Luhn check', () => {
    const url = 'https://api.checkoutchamp.com/order/query/?orderId=1234567890123';
    expect(redactor.redactUrl(url)).toBe(url);
  });

  it('matches a parameter name whatever its separators or case', () => {
    const url = 'https://api.checkoutchamp.com/order/import/?Card_Number=1&CVC=2&x-api-key=3';
    expect(redactor.redactUrl(url)).toBe(
      `https://api.checkoutchamp.com/order/import/?Card_Number=${MASK}&CVC=${MASK}&x-api-key=${MASK}`,
    );
  });

  it('masks a percent-encoded sensitive parameter name', () => {
    const url = 'https://api.checkoutchamp.com/order/import/?card%20number=4111111111111111';
    expect(redactor.redactUrl(url)).toBe(`https://api.checkoutchamp.com/order/import/?card%20number=${MASK}`);
  });

  it('returns a URL with no query string unchanged', () => {
    const url = 'https://api.checkoutchamp.com/order/query/';
    expect(redactor.redactUrl(url)).toBe(url);
  });

  it('returns a URL with an empty query string unchanged', () => {
    const url = 'https://api.checkoutchamp.com/order/query/?';
    expect(redactor.redactUrl(url)).toBe(url);
  });

  it('leaves a valueless parameter alone', () => {
    const url = 'https://api.checkoutchamp.com/order/query/?flag&orderId=1';
    expect(redactor.redactUrl(url)).toBe(url);
  });

  it('masks every occurrence when a parameter repeats', () => {
    const url = 'https://api.checkoutchamp.com/order/query/?password=a&password=b';
    expect(redactor.redactUrl(url)).toBe(
      `https://api.checkoutchamp.com/order/query/?password=${MASK}&password=${MASK}`,
    );
  });

  it('masks an entire fragment wholesale, even one shaped like a single key=value pair', () => {
    const url = 'https://api.checkoutchamp.com/order/query/?orderId=1#password=hunter2xyz';
    expect(redactor.redactUrl(url)).toBe(`https://api.checkoutchamp.com/order/query/?orderId=1#${MASK}`);
  });

  it('masks an entire multi-pair fragment wholesale, without merging any of it into the preceding query value', () => {
    const url = 'https://api.checkoutchamp.com/order/query/?orderId=1#loginId=abc&password=xyz';
    expect(redactor.redactUrl(url)).toBe(`https://api.checkoutchamp.com/order/query/?orderId=1#${MASK}`);
  });

  it('masks a hash-route fragment whose key-shaped prefix would otherwise hide a real parameter name', () => {
    const url = 'https://api.checkoutchamp.com/callback#/dashboard?password=hunter2xyz';
    expect(redactor.redactUrl(url)).toBe(`https://api.checkoutchamp.com/callback#${MASK}`);
  });

  it('masks a percent-encoded "=" in the fragment, which has no literal "=" to detect', () => {
    const url = 'https://api.checkoutchamp.com/callback#password%3Dhunter2xyz';
    expect(redactor.redactUrl(url)).toBe(`https://api.checkoutchamp.com/callback#${MASK}`);
  });

  it('masks a bare anchor fragment too, since fragment content is never trusted regardless of shape', () => {
    const url = 'https://api.checkoutchamp.com/order/query/?orderId=1#section-2';
    expect(redactor.redactUrl(url)).toBe(`https://api.checkoutchamp.com/order/query/?orderId=1#${MASK}`);
  });

  it('leaves a bare trailing "#" with no content unchanged, since there is nothing to leak', () => {
    const url = 'https://api.checkoutchamp.com/order/query/?orderId=1#';
    expect(redactor.redactUrl(url)).toBe(url);
  });

  it('masks a bracket-nested key that is sensitive on its own, e.g. card[cvv]', () => {
    const url = 'https://api.checkoutchamp.com/order/import/?sessionId=s1&card[cvv]=737';
    expect(redactor.redactUrl(url)).toBe(`https://api.checkoutchamp.com/order/import/?sessionId=s1&card[cvv]=${MASK}`);
  });

  it('masks a bracket-nested key that is only sensitive because of its parent, e.g. card[number]', () => {
    // Deliberately not a Luhn-valid number, so this only passes if the
    // parent/child key check catches it — not the Luhn fallback.
    const url = 'https://api.checkoutchamp.com/order/import/?card[number]=4111111111111112';
    expect(redactor.redactUrl(url)).toBe(`https://api.checkoutchamp.com/order/import/?card[number]=${MASK}`);
  });

  it('leaves a bracket-nested key visible when its parent is not card-like, e.g. order[number]', () => {
    const url = 'https://api.checkoutchamp.com/order/import/?order[number]=INV-42';
    expect(redactor.redactUrl(url)).toBe(url);
  });

  it('masks a triple-nested sensitive key, e.g. a[card][cvv]', () => {
    const url = 'https://api.checkoutchamp.com/order/import/?a[card][cvv]=737';
    expect(redactor.redactUrl(url)).toBe(`https://api.checkoutchamp.com/order/import/?a[card][cvv]=${MASK}`);
  });

  it('masks a percent-encoded bracket-nested key, e.g. card%5Bcvv%5D', () => {
    const url = 'https://api.checkoutchamp.com/order/import/?card%5Bcvv%5D=737';
    expect(redactor.redactUrl(url)).toBe(`https://api.checkoutchamp.com/order/import/?card%5Bcvv%5D=${MASK}`);
  });

  it('does not throw on a malformed, unclosed bracket in a query key', () => {
    const url = 'https://api.checkoutchamp.com/order/import/?card[cvv=737';
    expect(() => redactor.redactUrl(url)).not.toThrow();
  });

  it('masks every bracket-nested sensitive key when a full card payload rides in the query', () => {
    const url =
      'https://api.checkoutchamp.com/order/import/?sessionId=s1&card[number]=4111111111111112&card[cvv]=737&card[expMonth]=12&card[expYear]=2030&billing[password]=hunter2';
    expect(redactor.redactUrl(url)).toBe(
      `https://api.checkoutchamp.com/order/import/?sessionId=s1&card[number]=${MASK}&card[cvv]=${MASK}&card[expMonth]=${MASK}&card[expYear]=${MASK}&billing[password]=${MASK}`,
    );
  });
});

describe('Redactor.redactHeaders', () => {
  it('masks an api key header', () => {
    expect(redactor.redactHeaders(['X-Api-Key: secret'])).toEqual([`X-Api-Key: ${MASK}`]);
  });

  it('preserves the scheme on an Authorization header', () => {
    expect(redactor.redactHeaders(['Authorization: Bearer abc.def'])).toEqual([`Authorization: Bearer ${MASK}`]);
  });

  it('masks an Authorization header that carries no scheme', () => {
    expect(redactor.redactHeaders(['Authorization: abcdef'])).toEqual([`Authorization: ${MASK}`]);
  });

  it('preserves the scheme on a Proxy-Authorization header', () => {
    expect(redactor.redactHeaders(['Proxy-Authorization: Basic abc'])).toEqual([`Proxy-Authorization: Basic ${MASK}`]);
  });

  it('masks Cookie and Set-Cookie entirely', () => {
    expect(redactor.redactHeaders(['Cookie: a=1', 'Set-Cookie: b=2'])).toEqual([
      `Cookie: ${MASK}`,
      `Set-Cookie: ${MASK}`,
    ]);
  });

  it('leaves an ordinary header untouched', () => {
    expect(redactor.redactHeaders(['Content-Type: application/json'])).toEqual(['Content-Type: application/json']);
  });

  it('leaves a malformed header line with no colon untouched', () => {
    expect(redactor.redactHeaders(['nonsense'])).toEqual(['nonsense']);
  });

  it('returns a new array, leaving the caller list untouched', () => {
    const headers = ['X-Api-Key: secret'];
    const result = redactor.redactHeaders(headers);
    expect(headers).toEqual(['X-Api-Key: secret']);
    expect(result).not.toBe(headers);
  });
});

describe('Redactor.redactBody', () => {
  it('masks a sensitive key in a JSON object', () => {
    expect(redactor.redactBody('{"orderId":"1","password":"xyz"}')).toBe(`{"orderId":"1","password":"${MASK}"}`);
  });

  it('masks recursively through nested objects', () => {
    expect(redactor.redactBody('{"a":{"cvv":"123","b":"keep"}}')).toBe(`{"a":{"cvv":"${MASK}","b":"keep"}}`);
  });

  it('masks a generic child key when nested under a card-like parent', () => {
    expect(redactor.redactBody('{"card":{"number":"1","code":"2"}}')).toBe(
      `{"card":{"number":"${MASK}","code":"${MASK}"}}`,
    );
  });

  it('leaves the same generic key alone outside a card-like parent', () => {
    expect(redactor.redactBody('{"order":{"number":"1"}}')).toBe('{"order":{"number":"1"}}');
  });

  it('masks a Luhn-valid card number wherever it appears as a value', () => {
    expect(redactor.redactBody('{"note":"4111111111111111"}')).toBe(`{"note":"${MASK}"}`);
  });

  it('masks inside arrays', () => {
    expect(redactor.redactBody('[{"ssn":"1"},{"ok":"2"}]')).toBe(`[{"ssn":"${MASK}"},{"ok":"2"}]`);
  });

  it('replaces a body that is not JSON wholesale, which is the safe direction', () => {
    expect(redactor.redactBody('not json at all')).toBe('[REDACTED: body is not JSON]');
  });

  it('returns null for a null body', () => {
    expect(redactor.redactBody(null)).toBeNull();
  });

  it('returns an empty body unchanged', () => {
    expect(redactor.redactBody('')).toBe('');
    expect(redactor.redactBody('   ')).toBe('   ');
  });

  it('leaves slashes and unicode unescaped, matching the PHP encoder flags', () => {
    expect(redactor.redactBody('{"path":"a/b","name":"café"}')).toBe('{"path":"a/b","name":"café"}');
  });

  it('masks a Luhn-valid card number expressed as a bare JSON number', () => {
    expect(redactor.redactBody('{"note":4111111111111111}')).toBe(`{"note":"${MASK}"}`);
  });

  it('masks a Luhn-valid card number expressed as a bare JSON number inside an array', () => {
    expect(redactor.redactBody('[4111111111111111,2]')).toBe(`["${MASK}",2]`);
  });
});

describe('Redactor immutability', () => {
  it('never mutates the values it is given', () => {
    const headers = ['X-Api-Key: secret'];
    const body = '{"password":"xyz"}';
    const url = 'https://api.checkoutchamp.com/order/query/?password=xyz';

    redactor.redactHeaders(headers);
    redactor.redactBody(body);
    redactor.redactUrl(url);

    expect(headers).toEqual(['X-Api-Key: secret']);
    expect(body).toBe('{"password":"xyz"}');
    expect(url).toBe('https://api.checkoutchamp.com/order/query/?password=xyz');
  });
});
