import { describe, expect, it } from 'vitest';
import { CheckoutChampError } from '../src/errors.js';

describe('CheckoutChampError', () => {
  it('is an Error carrying the given message', () => {
    const error = new CheckoutChampError('boom');
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('boom');
  });

  it('is instanceof itself, so a catch block can narrow on it', () => {
    const error = new CheckoutChampError('boom');
    expect(error).toBeInstanceOf(CheckoutChampError);
  });

  it('reports its own name, so a serialized error is identifiable', () => {
    expect(new CheckoutChampError('boom').name).toBe('CheckoutChampError');
  });

  it('keeps the prototype chain intact through a subclass', () => {
    class Derived extends CheckoutChampError {}
    const error = new Derived('boom');
    expect(error).toBeInstanceOf(Derived);
    expect(error).toBeInstanceOf(CheckoutChampError);
  });

  it('captures a stack trace', () => {
    expect(new CheckoutChampError('boom').stack).toContain('CheckoutChampError');
  });
});
