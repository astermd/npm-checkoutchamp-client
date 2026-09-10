import { describe, expect, it } from 'vitest';
import { buildQuery } from '../../src/support/build-query.js';

describe('buildQuery', () => {
  it('encodes a flat object as key=value pairs joined by ampersands', () => {
    expect(buildQuery({ orderId: '123', campaignId: '7' })).toBe('orderId=123&campaignId=7');
  });

  it('preserves insertion order, so credentials appended last stay last', () => {
    expect(buildQuery({ b: '2', a: '1' })).toBe('b=2&a=1');
  });

  it('percent-encodes reserved characters in keys and values', () => {
    expect(buildQuery({ 'a key': 'a/value&more' })).toBe('a+key=a%2Fvalue%26more');
  });

  it('encodes a space as a plus, as http_build_query does', () => {
    expect(buildQuery({ note: 'hello world' })).toBe('note=hello+world');
  });

  it('indexes array values explicitly', () => {
    expect(buildQuery({ ids: ['a', 'b'] })).toBe('ids%5B0%5D=a&ids%5B1%5D=b');
  });

  it('brackets nested object keys', () => {
    expect(buildQuery({ card: { number: '1', cvv: '2' } })).toBe('card%5Bnumber%5D=1&card%5Bcvv%5D=2');
  });

  it('nests recursively to arbitrary depth', () => {
    expect(buildQuery({ a: { b: { c: 'd' } } })).toBe('a%5Bb%5D%5Bc%5D=d');
  });

  it('renders booleans as 1 and 0, as PHP does', () => {
    expect(buildQuery({ yes: true, no: false })).toBe('yes=1&no=0');
  });

  it('renders numbers without quoting', () => {
    expect(buildQuery({ qty: 3, price: 9.5 })).toBe('qty=3&price=9.5');
  });

  it('skips null values, as http_build_query does', () => {
    expect(buildQuery({ a: '1', b: null, c: '2' })).toBe('a=1&c=2');
  });

  it('skips undefined values', () => {
    expect(buildQuery({ a: '1', b: undefined, c: '2' })).toBe('a=1&c=2');
  });

  it('skips a null nested inside an object', () => {
    expect(buildQuery({ card: { number: '1', cvv: null } })).toBe('card%5Bnumber%5D=1');
  });

  it('returns an empty string for an empty object', () => {
    expect(buildQuery({})).toBe('');
  });

  it('returns an empty string when every value is skipped', () => {
    expect(buildQuery({ a: null, b: undefined })).toBe('');
  });

  it('renders an empty nested array as nothing rather than an empty pair', () => {
    expect(buildQuery({ a: [], b: '1' })).toBe('b=1');
  });

  it('stringifies a Date via its ISO form rather than dropping it', () => {
    const value = new Date(Date.UTC(2026, 7, 16));
    expect(buildQuery({ at: value })).toBe(`at=${encodeURIComponent(value.toISOString())}`);
  });

  it('escapes the full set of characters PHP escapes but encodeURIComponent does not', () => {
    // urlencode() escapes everything but alphanumerics and -_.; encodeURIComponent
    // additionally leaves !~*'() unescaped, so http_build_query compatibility
    // requires all six to come out as their hex byte values: ! -> %21, ~ -> %7E,
    // * -> %2A, ' -> %27, ( -> %28, ) -> %29.
    expect(buildQuery({ value: "!~*'()" })).toBe('value=%21%7E%2A%27%28%29');
  });

  it('renders a bigint via its string form, like other scalars', () => {
    expect(buildQuery({ big: 10n })).toBe('big=10');
  });

  it('combines array indexing with nested object bracketing', () => {
    expect(buildQuery({ items: [{ a: '1' }] })).toBe('items%5B0%5D%5Ba%5D=1');
  });
});
