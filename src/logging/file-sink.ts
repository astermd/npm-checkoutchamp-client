import { appendFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { CheckoutChampError } from '../errors.js';
import { MESSAGES } from '../messages.js';

/**
 * The built-in log destination: one file per calendar day, with retention.
 *
 * A base path of `/var/log/checkoutchamp/client.log` produces
 * `client-2026-08-16.log`, `client-2026-08-17.log`, and so on. Pruning only
 * ever considers files matching this sink's own dated pattern for that base
 * path, so a neighbouring file is never at risk, and it reads the age from the
 * filename rather than the filesystem mtime — an appended-to or restored file
 * keeps its true age. It runs at most once per process per base path, not once
 * per request.
 *
 * Writes are appended through a single promise chain. Node will happily
 * interleave two concurrent appends mid-line, which would corrupt the log;
 * chaining makes the order deterministic. Every failure is swallowed, because a
 * debug log that cannot be written must never fail the API call that produced
 * it.
 *
 * Retention is inclusive of its oldest edge: a file dated exactly
 * `retentionDays` days before the current date is kept, not deleted, so a
 * window of `retentionDays` in fact spans `retentionDays + 1` calendar dates
 * (e.g. `retentionDays: 7` keeps today's file and the seven days before it).
 * This matches the PHP original's own cutoff arithmetic and `>=` comparison
 * byte for byte; it is kept rather than tightened so that a client migrating
 * from the PHP package to this one sees the identical set of files survive on
 * the same configuration, and so documentation and support answers written
 * against one package still hold for the other.
 *
 * Supply a `debugSink` function instead of a base path to replace this class
 * entirely; the package then writes no files and retention becomes your concern.
 */
export class FileSink {
  /** Days of history kept when the caller does not say otherwise. */
  public static readonly DEFAULT_RETENTION_DAYS = 7;

  /** Base paths already pruned in this process. */
  private static pruned = new Set<string>();

  private readonly basePath: string;

  /**
   * Days of history to keep, clamped to a non-negative integer. The window
   * this defines is inclusive of its oldest edge: a file dated exactly this
   * many days before the current date is kept, not deleted, so the file
   * actually deleted is the one dated `retentionDays + 1` days back or
   * earlier. See {@link prune} for the exact comparison this produces.
   */
  private readonly retentionDays: number;

  private readonly timezone: string;

  /** Tail of the serialized write chain. */
  private chain: Promise<void> = Promise.resolve();

  /**
   * @param basePath      Caller-supplied path; the date is inserted before the extension.
   * @param retentionDays Days of history to keep. `0` keeps everything; otherwise a
   *                      file dated exactly `retentionDays` days before the current
   *                      date is kept, so the window spans `retentionDays + 1`
   *                      calendar dates. See {@link prune}.
   * @param timezone      IANA timezone used for both the filename date and pruning.
   *
   * @throws {CheckoutChampError} When the base path is empty or the timezone is
   *                              not a recognised IANA identifier.
   */
  public constructor(basePath: string, retentionDays: number = FileSink.DEFAULT_RETENTION_DAYS, timezone = 'UTC') {
    if (basePath.trim() === '') {
      throw new CheckoutChampError(MESSAGES.debugFileRequired);
    }

    try {
      // Constructing the formatter is the only reliable way to validate an
      // IANA identifier: an unrecognised zone throws a RangeError here rather
      // than surfacing later, mid-write. `new` expressions used for their
      // side effect are not flagged as unused by this project's lint config,
      // so no discard operator is needed for the instance itself.
      new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
    } catch {
      throw new CheckoutChampError(MESSAGES.invalidTimezone);
    }

    this.basePath = basePath;
    this.retentionDays = Math.max(0, retentionDays);
    this.timezone = timezone;
  }

  /**
   * Queue one entry for the current day's file, pruning old files on first use.
   *
   * Returns immediately. The write happens on the sink's serialized chain, so
   * two entries can never interleave — Node would otherwise happily start a
   * second `appendFile` before the first one's bytes land, and the two write
   * calls could complete in either order or mid-line. Nothing is thrown, ever;
   * a debug log that cannot be written must never fail the API call that
   * produced it.
   *
   * @param entry The formatted log entry.
   */
  public write(entry: string): void {
    this.chain = this.chain.then(async () => {
      try {
        const now = new Date();
        const path = this.pathForDate(now);

        await mkdir(dirname(path), { recursive: true, mode: 0o775 });
        await appendFile(path, entry, 'utf8');

        await this.pruneOnce(now);
      } catch {
        // Intentionally swallowed: logging must never break an API call.
      }
    });
  }

  /**
   * Wait for every queued write to land.
   *
   * A short-lived Node process can exit before an asynchronous append reaches
   * disk, which PHP's synchronous write could not do. Await this before exit if
   * the log matters.
   *
   * @returns A promise that settles once the chain is drained.
   */
  public async flush(): Promise<void> {
    await this.chain;
  }

  /**
   * Resolve the dated filename for a given moment.
   *
   * @param date The moment to name a file for.
   *
   * @returns Absolute path, e.g. `/var/log/client-2026-08-16.log`.
   */
  public pathForDate(date: Date): string {
    return join(this.directory(), `${this.stem()}-${this.formatDate(date)}${this.suffix()}`);
  }

  /**
   * Delete dated files older than the retention window.
   *
   * Only files matching this sink's own `<stem>-YYYY-MM-DD<.ext>` pattern in the
   * base path's directory are considered, so a neighbouring file with a
   * different stem or extension — or the base path itself, which carries no
   * date — is never at risk. The age comes from the date embedded in the
   * filename rather than the file's mtime, because appending to a log (or
   * restoring one from backup) updates its mtime without changing how old the
   * entries inside it actually are; mtime-based pruning would keep a
   * month-old, still-being-written file alive forever.
   *
   * The cutoff is `now` minus `retentionDays` days, and a file is deleted only
   * when its filename date is strictly earlier than that cutoff (`< cutoff`,
   * not `<=`). A file dated exactly on the cutoff — that is, exactly
   * `retentionDays` days before `now` — is therefore kept, so the window that
   * survives spans `retentionDays + 1` calendar dates, not `retentionDays`.
   * This mirrors the PHP original's identical cutoff and comparison; it is
   * intentional, not an off-by-one to be fixed, because changing it would make
   * this client delete a day earlier than the PHP client under the same
   * configuration.
   *
   * @param now The moment to measure the window from. Defaults to the present.
   *
   * @returns The number of files deleted.
   */
  public async prune(now: Date = new Date()): Promise<number> {
    if (this.retentionDays === 0) {
      return 0;
    }

    const directory = this.directory();
    const cutoff = this.formatDate(new Date(now.getTime() - this.retentionDays * 86_400_000));
    const pattern = new RegExp(
      `^${FileSink.escapeRegExp(this.stem())}-(\\d{4}-\\d{2}-\\d{2})${FileSink.escapeRegExp(this.suffix())}$`,
    );

    let entries: string[];
    try {
      entries = await readdir(directory);
    } catch {
      return 0;
    }

    let deleted = 0;
    for (const name of entries) {
      const matched = pattern.exec(name);
      // Y-m-d sorts correctly as a plain string comparison.
      if (matched === null || matched[1] === undefined || matched[1] >= cutoff) {
        continue;
      }

      try {
        await unlink(join(directory, name));
        deleted++;
      } catch {
        // A file we cannot delete is not a reason to fail.
      }
    }

    return deleted;
  }

  /**
   * Forget which base paths have been pruned.
   *
   * Pruning runs at most once per process per base path via a static set, so
   * a long-lived process does not re-scan its log directory on every request.
   * That guard is process-global state, which leaks between otherwise
   * independent test cases sharing the same process; this method clears it so
   * each test can observe pruning from a clean slate.
   *
   * @internal Exposed for the package's own test suite.
   */
  public static resetPruneState(): void {
    FileSink.pruned.clear();
  }

  /**
   * Prune at most once per process for this base path.
   *
   * Pruning is a directory scan plus a delete per stale file; running it on
   * every write would turn a cheap append into an O(n) filesystem walk for no
   * benefit once the directory is already clean. A static set remembers which
   * base paths have been handled so later writes skip straight to the append.
   *
   * @param now The moment to measure the window from.
   */
  private async pruneOnce(now: Date): Promise<void> {
    if (FileSink.pruned.has(this.basePath)) {
      return;
    }

    FileSink.pruned.add(this.basePath);
    await this.prune(now);
  }

  /**
   * Render a date as `YYYY-MM-DD` in the configured timezone.
   *
   * `en-CA` is used because its short date format is already ISO-ordered,
   * which avoids hand-rolling zero-padding and month/day reordering.
   *
   * @param date The moment to render.
   *
   * @returns The date portion, zero-padded.
   */
  private formatDate(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: this.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }

  /**
   * Resolve the directory the caller's base path lives in.
   *
   * `pathForDate` and `prune` both need to work in the same directory as the
   * configured base path — the former to write a dated file there, the latter
   * to list and delete them — so this is factored out once rather than
   * repeating `dirname(this.basePath)` at each call site.
   *
   * @returns The directory the dated files live in.
   */
  private directory(): string {
    return dirname(this.basePath);
  }

  /**
   * Split the base filename into the part that comes before the date.
   *
   * A base path of `client.log` yields the stem `client`, and one of `client`
   * (no extension) yields `client` unchanged. Both `pathForDate` and the
   * pruning pattern in `prune` need this piece on its own so the date can be
   * inserted between it and the extension rather than simply appended.
   *
   * @returns The base filename without its extension.
   */
  private stem(): string {
    const file = basename(this.basePath);
    const extension = extname(file);

    return extension === '' ? file : file.slice(0, -extension.length);
  }

  /**
   * Split the base filename into the extension that comes after the date.
   *
   * This is the counterpart to {@link stem}: `client.log` yields `.log`, and a
   * base path with no extension yields an empty string. Keeping the two halves
   * separate is what lets the date land between them instead of after the
   * whole filename.
   *
   * @returns The extension including its leading dot, or an empty string.
   */
  private suffix(): string {
    return extname(basename(this.basePath));
  }

  /**
   * Escape a literal for embedding in a regular expression.
   *
   * `stem()` and `suffix()` come from a caller-supplied path and may contain
   * characters that are meaningful in a regular expression, such as a literal
   * `.` in an extension. Without escaping them, `prune`'s dated-filename
   * pattern could match filenames it was never meant to, which is exactly the
   * kind of neighbouring-file damage the pruning contract promises never to
   * do.
   *
   * @param value The literal.
   *
   * @returns The escaped form.
   */
  private static escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
