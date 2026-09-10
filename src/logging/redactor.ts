/**
 * Masks credentials and sensitive fields in copies of a URL, headers and bodies.
 *
 * Every method returns new values. Nothing here mutates the request that is
 * actually sent or the response that is actually returned to the caller — the
 * redacted text exists only inside a log entry, and the test suite asserts it.
 *
 * Scope note, and the reason this class is unusual: Checkout Champ carries
 * every parameter — credentials, personal data and cardholder data alike — in
 * the URL query string. Logging a URL verbatim would therefore write the
 * account password and full card numbers to disk on every call, so
 * {@link Redactor.redactUrl} masks sensitive query parameters too. The scheme,
 * host and path survive, along with every non-sensitive parameter, so a log
 * entry still says which endpoint was called with which order ID.
 *
 * Known limitation: a parameter whose own value is itself a URL-encoded query
 * — for example `redirectUrl=https%3A%2F%2Fexample.test%2F%3Ftoken%3Dsecret`
 * — is not decoded and walked recursively. {@link Redactor.redactUrl} only
 * reads one flat level of query parameters, so a sensitive value nested
 * inside an encoded URL parameter is not masked. This is a deliberate
 * omission rather than an oversight: decomposing arbitrary encoded values
 * would add heuristics that risk mangling legitimate parameters, for a
 * parameter shape this API does not otherwise use. Anyone adding a callback
 * or redirect-URL parameter to this client should keep it in mind.
 */
export class Redactor {
  /** Replacement written in place of a sensitive value. */
  public static readonly MASK = '[REDACTED]';

  /**
   * Placeholder used when a body cannot be parsed and therefore cannot be
   * field-masked. Dropping it whole is the safe direction.
   */
  public static readonly UNPARSEABLE = '[REDACTED: body is not JSON]';

  /** Header names whose value is replaced entirely, after normalisation. */
  private static readonly SENSITIVE_HEADERS: readonly string[] = [
    'apikey',
    'xapikey',
    'xauthtoken',
    'xaccesstoken',
    'xsessiontoken',
    'cookie',
    'setcookie',
  ];

  /** Header names whose value keeps its scheme, e.g. `Bearer [REDACTED]`. */
  private static readonly SCHEME_PRESERVING_HEADERS: readonly string[] = ['authorization', 'proxyauthorization'];

  /** Keys whose value is replaced entirely, after normalisation. */
  private static readonly SENSITIVE_KEYS: readonly string[] = [
    // Credentials
    'apikey',
    'xapikey',
    'apisecret',
    'secret',
    'clientsecret',
    'password',
    'passwd',
    'pwd',
    'passphrase',
    'signature',
    'auth',
    'authorization',
    'loginid',
    'login',
    'username',
    // Tokens
    'token',
    'accesstoken',
    'refreshtoken',
    'idtoken',
    'bearertoken',
    'sessiontoken',
    'paymenttoken',
    'paymenttokenid',
    'carttoken',
    // Cardholder data
    'cardnumber',
    'cardno',
    'ccnumber',
    'creditcard',
    'creditcardnumber',
    'pan',
    'cvv',
    'cvv2',
    'cvc',
    'cvc2',
    'csc',
    'cardcode',
    'securitycode',
    'expmonth',
    'expyear',
    'expirationmonth',
    'expirationyear',
    'expirationdate',
    'expirydate',
    'cardexpiry',
    // Bank data
    'accountnumber',
    'bankaccount',
    'bankaccountnumber',
    'routingnumber',
    'aba',
    'abanumber',
    'iban',
    'swift',
    'swiftcode',
    'sortcode',
    // Government and identity data
    'ssn',
    'socialsecuritynumber',
    'taxid',
    'ein',
    'nationalid',
    'passportnumber',
    'driverslicense',
    'driverslicensenumber',
    'dob',
    'dateofbirth',
    'birthdate',
  ];

  /**
   * Parent keys under which otherwise-generic child keys become sensitive.
   *
   * Catches shapes like `{"card": {"number": "…", "cvv": "…"}}` where the child
   * key alone would be too generic to mask safely.
   */
  private static readonly SENSITIVE_PARENTS: readonly string[] = [
    'card',
    'creditcard',
    'debitcard',
    'paymentcard',
    'paymentmethod',
    'paymentsource',
    'bankaccount',
    'ach',
    'billingsource',
  ];

  /** Child keys masked when nested under one of {@link Redactor.SENSITIVE_PARENTS}. */
  private static readonly SENSITIVE_CHILDREN: readonly string[] = [
    'number',
    'code',
    'month',
    'year',
    'expiry',
    'expiration',
    'last4',
  ];

  /**
   * Redact a set of raw `Name: value` header lines.
   *
   * Each line is inspected independently and, when its name matches one of
   * the sensitive lists, its value is replaced or partially masked. Anything
   * that does not match — including a line with no colon — is passed through
   * unchanged into the new array.
   *
   * @param headers Raw header lines.
   *
   * @returns A new array; the input is untouched.
   */
  public redactHeaders(headers: readonly string[]): string[] {
    return headers.map(line => this.redactHeaderLine(line));
  }

  /**
   * Mask sensitive parameters in a URL's query string and fragment.
   *
   * This API puts credentials, personal data and cardholder data in the query
   * string, so a verbatim URL would leak all three. The scheme, host and path
   * are preserved, as are parameter names and every non-sensitive value, which
   * keeps a log entry readable and reproducible once the reader substitutes
   * their own credentials.
   *
   * The fragment (the part after a `#`, if any) is cut off before the query is
   * parsed, so a raw `#` — which a well-formed request built by this client
   * never contains, since its query builder percent-encodes it, but which a
   * caller of this exported class can still hand in directly — cannot corrupt
   * the query split: it can no longer be swallowed into the preceding
   * parameter's value, nor let a later `&`-separated chunk of itself escape
   * key-matching. The fragment itself is handled fail-closed rather than
   * parsed: see {@link Redactor.maskFragment} for why it is not treated as a
   * second query string.
   *
   * Values are masked in place rather than percent-encoded, because the result
   * is a log line rather than a URL to be re-issued.
   *
   * @param url The URL as it will actually be requested.
   *
   * @returns A new string; the input is untouched.
   */
  public redactUrl(url: string): string {
    const fragmentIndex = url.indexOf('#');
    const withoutFragment = fragmentIndex === -1 ? url : url.slice(0, fragmentIndex);
    const fragment = fragmentIndex === -1 ? null : url.slice(fragmentIndex + 1);

    const separator = withoutFragment.indexOf('?');
    const prefix = separator === -1 ? withoutFragment : withoutFragment.slice(0, separator);
    const query = separator === -1 ? null : withoutFragment.slice(separator + 1);

    const queryIsEmpty = query === null || query === '';
    const fragmentIsEmpty = fragment === null || fragment === '';
    if (queryIsEmpty && fragmentIsEmpty) {
      return url;
    }

    const queryPart = query === null ? '' : `?${this.maskQueryComponent(query)}`;
    const fragmentPart = fragment === null ? '' : `#${this.maskFragment(fragment)}`;

    return `${prefix}${queryPart}${fragmentPart}`;
  }

  /**
   * Redact a JSON body.
   *
   * A body that is not decodable JSON cannot be field-masked, so it is replaced
   * wholesale rather than logged on the chance it is harmless. A `null` or
   * blank body carries nothing to mask and is returned as given.
   *
   * @param body The body as it will actually be sent or as it was received.
   *
   * @returns A new string; the input is untouched. `null` in, `null` out.
   */
  public redactBody(body: string | null): string | null {
    if (body === null || body.trim() === '') {
      return body;
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(body);
    } catch {
      return Redactor.UNPARSEABLE;
    }

    const clean = this.redactValue(decoded, null);

    return JSON.stringify(clean);
  }

  /**
   * Mask sensitive `name=value` pairs in the URL's real query string.
   *
   * A pair with no `=` — a bare flag, or an empty segment from a leading,
   * trailing, or doubled `&` — is passed through unchanged, since there is no
   * value to judge or mask. Percent-decoding happens only for the sensitivity
   * check; the parameter name and, when not sensitive, its value are written
   * back exactly as given. This method is only ever applied to the part of
   * the URL before a `#`: see {@link Redactor.maskFragment} for why the
   * fragment, if any, is never run through this same key/value logic.
   *
   * A bracket-nested name such as `card[cvv]` — the shape
   * {@link ../support/build-query.js} produces for a nested object — is
   * decomposed into its key path so the leaf and its immediate parent get the
   * same {@link Redactor.isSensitiveKey} check `redactBody` already applies to
   * a parsed JSON object's nested keys, rather than being compared whole
   * against the sensitive-key lists (where `card[number]` would never match
   * anything).
   *
   * @param component A raw query string, without its leading `?`.
   *
   * @returns The component with each sensitive pair's value replaced.
   */
  private maskQueryComponent(component: string): string {
    return component
      .split('&')
      .map(pair => {
        const equals = pair.indexOf('=');
        if (equals === -1) {
          return pair;
        }

        const name = pair.slice(0, equals);
        const value = pair.slice(equals + 1);

        const path = Redactor.splitKeyPath(Redactor.decode(name));
        const leaf = path.at(-1) ?? '';
        const parent = path.length > 1 ? Redactor.normalise(path.at(-2) ?? '') : null;

        const sensitive = this.isSensitiveKey(leaf, parent) || this.looksLikeCardNumber(Redactor.decode(value));

        return sensitive ? `${name}=${Redactor.MASK}` : pair;
      })
      .join('&');
  }

  /**
   * Decompose a query parameter name into its bracket-nested key path.
   *
   * PHP's `http_build_query` — and this package's own `buildQuery`, which
   * mirrors it — renders a nested object or array as `a[b][c]`. Splitting
   * that back into `["a", "b", "c"]` is what lets {@link
   * Redactor.maskQueryComponent} check a nested query key with the same
   * leaf/parent logic {@link Redactor.redactValue} already applies to a
   * parsed JSON body, instead of comparing the whole bracketed string against
   * the sensitive-key lists, where it would never match.
   *
   * An unclosed bracket is not treated as an error: only well-formed
   * `[...]` groups are recognised as further segments, so malformed input —
   * which this method must still handle, since a query string can come from
   * a caller-built URL rather than only from `buildQuery` — is decomposed as
   * far as it validly parses rather than throwing.
   *
   * @param key A single, already percent-decoded query parameter name.
   *
   * @returns The ordered key path. A name with no brackets returns a single-
   *          element array containing the whole name.
   */
  private static splitKeyPath(key: string): string[] {
    const baseMatch = /^[^[]*/.exec(key);
    const segments = [baseMatch === null ? key : baseMatch[0]];

    const bracketPattern = /\[([^[\]]*)\]/g;
    for (const match of key.matchAll(bracketPattern)) {
      segments.push(match[1] ?? '');
    }

    return segments;
  }

  /**
   * Replace an entire non-empty URL fragment with the mask.
   *
   * A fragment has no protocol-defined internal structure — RFC 3986 leaves
   * everything after `#` to the application — so no shape-based test of its
   * content can be trusted to find every value worth masking. Earlier
   * versions of this method tried exactly that, and each one was beaten by a
   * narrower shape: matching sensitive key names failed on a hash-based route
   * such as `#/dashboard?password=hunter2xyz`, where `/dashboard?password` is
   * not a recognised key; checking for a literal `=` then failed on a
   * percent-encoded pair such as `#password%3Dhunter2xyz`, which contains no
   * literal `=` at all. Decoding first would only move the same problem to
   * double encoding, and so on indefinitely — there is no shape test that
   * survives an adversary choosing the next one.
   *
   * So, as with this package's host-allowlist validation, the rule enumerates
   * what is known to be safe rather than what looks dangerous: the only safe
   * fragment is an empty one. Any fragment with content at all — regardless
   * of whether it looks like a key/value pair, an encoded one, or a plain
   * anchor — is replaced in full. A Checkout Champ API request or response
   * URL never depends on fragment content, so nothing of diagnostic value is
   * lost by refusing to show any of it.
   *
   * @param fragment A raw fragment, without its leading `#`.
   *
   * @returns {@link Redactor.MASK} for any non-empty fragment. An empty
   *          fragment — a bare trailing `#` with nothing after it — carries
   *          no content to leak and is returned as given.
   */
  private maskFragment(fragment: string): string {
    return fragment === '' ? fragment : Redactor.MASK;
  }

  /**
   * Redact one header line, preserving the scheme on authorization headers.
   *
   * Splits the line on its first colon to separate the header name from its
   * value, normalises the name for comparison against the sensitive lists,
   * and either masks the value wholesale, masks it while preserving a leading
   * scheme token, or leaves the line untouched.
   *
   * @param line A raw `Name: value` header line.
   *
   * @returns The redacted line, or the input when the name is not sensitive.
   */
  private redactHeaderLine(line: string): string {
    const separator = line.indexOf(':');
    if (separator === -1) {
      return line;
    }

    const name = line.slice(0, separator);
    const value = line.slice(separator + 1);
    const normalised = Redactor.normalise(name);

    if (Redactor.SCHEME_PRESERVING_HEADERS.includes(normalised)) {
      const trimmed = value.trim();
      const space = trimmed.indexOf(' ');
      const masked = space === -1 ? Redactor.MASK : `${trimmed.slice(0, space)} ${Redactor.MASK}`;

      return `${name}: ${masked}`;
    }

    if (Redactor.SENSITIVE_HEADERS.includes(normalised)) {
      return `${name}: ${Redactor.MASK}`;
    }

    return line;
  }

  /**
   * Recursively mask sensitive entries in a decoded JSON value.
   *
   * Arrays are walked element by element without changing the parent context
   * they carry forward. Objects are walked key by key: a key that is sensitive
   * on its own, or generic but sensitive under its parent, has its value
   * replaced outright; every other key is recursed into with its own
   * normalised name passed down as the new parent. A bare string or number
   * value that looks like a card number is masked even when its key gave no
   * indication.
   *
   * Checking numbers as well as strings is a deliberate divergence from the
   * PHP original, which only ever checks strings. This class's documented
   * guarantee is that it masks "any 13–19 digit value that passes a Luhn
   * check," with no qualification of type, and a card number reaching a log
   * file — whether the caller happened to encode it as a JSON string or a
   * JSON number, e.g. `{"cardNumber": 4111111111111111}` — is a PCI incident
   * either way. Masking a numeric identifier that happens to pass Luhn is a
   * false-positive cost this class already accepts for string identifiers, so
   * paying the same cost for numbers is consistent, not new risk.
   *
   * @param value     The decoded value.
   * @param parentKey Normalised key of the containing object, or `null`.
   *
   * @returns A new value with sensitive entries replaced.
   */
  private redactValue(value: unknown, parentKey: string | null): unknown {
    if (Array.isArray(value)) {
      return value.map(item => this.redactValue(item, parentKey));
    }

    if (value !== null && typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        if (this.isSensitiveKey(key, parentKey)) {
          result[key] = Redactor.MASK;
          continue;
        }
        result[key] = this.redactValue(item, Redactor.normalise(key));
      }

      return result;
    }

    if (typeof value === 'string' && this.looksLikeCardNumber(value)) {
      return Redactor.MASK;
    }

    if (typeof value === 'number' && this.looksLikeCardNumber(String(value))) {
      return Redactor.MASK;
    }

    return value;
  }

  /**
   * Whether a key should have its value masked.
   *
   * A key is sensitive either on its own merits — it appears, once
   * normalised, in {@link Redactor.SENSITIVE_KEYS} — or because it is one of
   * the generic {@link Redactor.SENSITIVE_CHILDREN} names nested directly
   * under one of the {@link Redactor.SENSITIVE_PARENTS}, such as `number`
   * inside `card`.
   *
   * @param key       The raw key.
   * @param parentKey Already-normalised key of the containing object.
   *
   * @returns `true` when the key is sensitive on its own or under this parent.
   */
  private isSensitiveKey(key: string, parentKey: string | null): boolean {
    const normalised = Redactor.normalise(key);

    if (Redactor.SENSITIVE_KEYS.includes(normalised)) {
      return true;
    }

    return (
      parentKey !== null &&
      Redactor.SENSITIVE_PARENTS.includes(parentKey) &&
      Redactor.SENSITIVE_CHILDREN.includes(normalised)
    );
  }

  /**
   * Catch card numbers arriving under an unexpected key name.
   *
   * Requires both a plausible PAN length and a valid Luhn check digit, which
   * keeps ordinary numeric identifiers out of the match while still catching
   * a card number that a caller placed under a key the sensitive lists do not
   * name.
   *
   * @param value Candidate value.
   *
   * @returns `true` when the value is 13–19 digits and passes Luhn.
   */
  private looksLikeCardNumber(value: string): boolean {
    const digits = value.replace(/[ -]/g, '');
    if (!/^\d{13,19}$/.test(digits)) {
      return false;
    }

    let sum = 0;
    let double = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let digit = Number(digits[i]);
      if (double) {
        digit *= 2;
        if (digit > 9) {
          digit -= 9;
        }
      }
      sum += digit;
      double = !double;
    }

    return sum % 10 === 0;
  }

  /**
   * Percent-decode a query component without throwing on malformed input.
   *
   * A query string may contain sequences that are not valid percent-encoding;
   * rather than let that abort redaction, the raw value is returned as a
   * fallback so the caller can still compare it against the sensitive lists.
   *
   * @param value Raw component.
   *
   * @returns The decoded value, or the input when it will not decode.
   */
  private static decode(value: string): string {
    try {
      return decodeURIComponent(value.replace(/\+/g, ' '));
    } catch {
      return value;
    }
  }

  /**
   * Lowercase and strip separators so `X-Api-Key`, `api_key` and `apiKey` all
   * compare equal.
   *
   * Trims surrounding whitespace first, then removes hyphens, underscores,
   * spaces and dots, and finally lowercases the result, so every key list can
   * be written once and matched regardless of the caller's naming style.
   *
   * @param name Raw key or header name.
   *
   * @returns The normalised form.
   */
  private static normalise(name: string): string {
    return name
      .trim()
      .replace(/[-_ .]/g, '')
      .toLowerCase();
  }
}
