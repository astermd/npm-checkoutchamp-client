/**
 * Every error this package raises.
 *
 * The Checkout Champ client deliberately keeps a single exception type rather
 * than a hierarchy, mirroring the Composer package it was ported from. There
 * are only four things that can go wrong before a request leaves the process —
 * an empty credential, a host that is not bare, an unknown method name, and a
 * response that is not JSON — and none of them benefits from a distinct class.
 *
 * Provider-side rejections are not errors: they arrive in the response body as
 * the provider's own `result` and `message` fields. Transport failures are not
 * errors either; they surface as a `curlError` key on the decoded response.
 */
export class CheckoutChampError extends Error {
  /**
   * Identifies the error when it is serialized or logged. Stored as an own
   * enumerable property so it survives `JSON.stringify`, where inherited
   * properties and the `message` and `stack` fields do not.
   */
  public override readonly name: string = 'CheckoutChampError';

  /**
   * @param message Human-readable description, drawn from {@link MESSAGES}.
   */
  public constructor(message: string) {
    super(message);

    // At this project's current build target, native class semantics already
    // give a correct prototype chain in both the ESM and CJS output, so this
    // call is inert here — no test currently fails if it is removed. It is
    // kept deliberately, as a cross-package convention: it becomes necessary
    // the moment the build target is lowered or a consumer's toolchain
    // downlevels the class, at which point `instanceof CheckoutChampError`
    // would otherwise silently break.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
