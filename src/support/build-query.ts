/**
 * Builds a query string the way PHP's `http_build_query` does.
 *
 * The Composer package this was ported from hands the caller's parameters
 * straight to `http_build_query`, so a consumer can legitimately pass a nested
 * structure and expect bracket notation on the wire. `URLSearchParams` will not
 * do: it renders a nested object as the literal string `[object Object]` and
 * joins an array with commas, both of which the provider would reject.
 *
 * Encoding follows RFC 1738, matching `http_build_query`'s default: a space
 * becomes `+` rather than `%20`.
 */

/**
 * Percent-encode one component in RFC 1738 form.
 *
 * `encodeURIComponent` produces RFC 3986, which differs from PHP in exactly one
 * place that matters here — the space — and leaves `!'()*~` unescaped where PHP's
 * `urlencode()` escapes them (it leaves only alphanumerics and `-_.` alone).
 *
 * @param value Raw key or value.
 *
 * @returns The encoded component.
 */
function encodeComponent(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, '+')
    .replace(/[!'()*~]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Render one scalar as PHP would.
 *
 * @param value A non-null, non-object value.
 *
 * @returns The string form, with booleans as `1` and `0`.
 */
function scalarToString(value: string | number | boolean | bigint): string {
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }

  return String(value);
}

/**
 * Append every pair produced by one value, recursing through arrays and objects.
 *
 * @param pairs Accumulator of already-encoded `key=value` strings.
 * @param key   Fully-qualified key for this value, e.g. `card[number]`.
 * @param value The value to render.
 *
 * @returns Nothing; `pairs` is appended to in place.
 */
function appendPairs(pairs: string[], key: string, value: unknown): void {
  if (value === null || value === undefined) {
    return;
  }

  if (value instanceof Date) {
    pairs.push(`${encodeComponent(key)}=${encodeComponent(value.toISOString())}`);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      appendPairs(pairs, `${key}[${String(index)}]`, item);
    });
    return;
  }

  if (typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      appendPairs(pairs, `${key}[${childKey}]`, childValue);
    }
    return;
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    pairs.push(`${encodeComponent(key)}=${encodeComponent(scalarToString(value))}`);
  }
}

/**
 * Build a URL query string from a parameter object.
 *
 * Key order is preserved, which the client relies on: credentials are merged in
 * last so a caller-supplied `password` cannot shadow the configured one, and
 * that guarantee is only visible if the order survives encoding. That said,
 * "preserved" means whatever order `Object.entries` yields, which is not
 * strictly insertion order: string keys that look like array indices (e.g.
 * `"0"`, `"1"`) are visited in ascending numeric order ahead of every other
 * key, regardless of when they were inserted. The credential-shadowing
 * guarantee is unaffected by this, since credential keys are alphabetic.
 *
 * @param params Caller parameters, possibly nested. `null` and `undefined`
 *               values are omitted entirely, as PHP omits `null`.
 *
 * @returns The encoded query string, without a leading `?`. Empty when every
 *          parameter was omitted.
 */
export function buildQuery(params: Record<string, unknown>): string {
  const pairs: string[] = [];

  for (const [key, value] of Object.entries(params)) {
    appendPairs(pairs, key, value);
  }

  return pairs.join('&');
}
