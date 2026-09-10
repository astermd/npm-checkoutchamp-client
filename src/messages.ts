/**
 * Every message this package can raise, in one place.
 *
 * The Composer package keeps these in `config/Messages.php` because a
 * microframework was removed from it and the string table survived. Here they
 * are a frozen constant: same strings, no lookup machinery.
 *
 * `apiInvokedFailure` has no trigger in the Node port — the client-level
 * accessors that raised it are gone, and a call object cannot exist before a
 * method is invoked. It stays for parity with the Composer package's table.
 */
export const MESSAGES = Object.freeze({
  methodNotFound: 'No such method found',
  invalidApiAuth: 'A login ID and password are required',
  apiInvokedFailure: 'No API method has been invoked yet',
  jsonFormatError: 'API response is not valid JSON',
  invalidHost: 'The host must be a bare hostname such as "api.checkoutchamp.com", without a scheme or path',
  debugFileRequired: 'Debug logging needs either a "debugFile" base path or a "debugSink" callable',
  invalidDebugSink: 'The "debugSink" option must be callable',
  invalidTimezone: 'The configured timezone is not a recognised IANA identifier',
});
