import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CheckoutChampError } from '../../src/errors.js';
import { FileSink } from '../../src/logging/file-sink.js';
import { MESSAGES } from '../../src/messages.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ccc-sink-'));
  FileSink.resetPruneState();
});

afterEach(() => {
  FileSink.resetPruneState();
});

describe('FileSink', () => {
  it('rejects an empty base path', () => {
    expect(() => new FileSink('   ')).toThrow(new CheckoutChampError(MESSAGES.debugFileRequired));
  });

  it('rejects an unrecognised timezone', () => {
    expect(() => new FileSink(join(dir, 'client.log'), 7, 'Not/AZone')).toThrow(
      new CheckoutChampError(MESSAGES.invalidTimezone),
    );
  });

  it('inserts the date before the extension', () => {
    const sink = new FileSink(join(dir, 'client.log'));
    expect(sink.pathForDate(new Date(Date.UTC(2026, 7, 16)))).toBe(join(dir, 'client-2026-08-16.log'));
  });

  it('appends the date when the base path has no extension', () => {
    const sink = new FileSink(join(dir, 'client'));
    expect(sink.pathForDate(new Date(Date.UTC(2026, 7, 16)))).toBe(join(dir, 'client-2026-08-16'));
  });

  it('derives the filename date in the configured timezone', () => {
    const sink = new FileSink(join(dir, 'client.log'), 7, 'Asia/Kolkata');
    // 2026-08-16T20:00Z is already 2026-08-17 in Asia/Kolkata.
    expect(sink.pathForDate(new Date(Date.UTC(2026, 7, 16, 20, 0)))).toBe(join(dir, 'client-2026-08-17.log'));
  });

  it('writes an entry to the current day file', async () => {
    const sink = new FileSink(join(dir, 'client.log'));
    sink.write('entry one\n');
    await sink.flush();

    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(await readFile(join(dir, files[0]!), 'utf8')).toBe('entry one\n');
  });

  it('creates the directory when it does not exist', async () => {
    const sink = new FileSink(join(dir, 'nested', 'deep', 'client.log'));
    sink.write('entry\n');
    await sink.flush();

    expect(await readdir(join(dir, 'nested', 'deep'))).toHaveLength(1);
  });

  it('serializes concurrent writes so no line interleaves', async () => {
    const sink = new FileSink(join(dir, 'client.log'));
    for (let i = 0; i < 50; i++) {
      sink.write(`line-${String(i)}\n`);
    }
    await sink.flush();

    const files = await readdir(dir);
    const content = await readFile(join(dir, files[0]!), 'utf8');
    const lines = content.trimEnd().split('\n');

    expect(lines).toHaveLength(50);
    expect(lines[0]).toBe('line-0');
    expect(lines[49]).toBe('line-49');
  });

  it('never throws when the path cannot be written', async () => {
    // A path whose parent is an existing file cannot be created as a directory.
    const blocker = join(dir, 'blocker');
    await writeFile(blocker, 'x');
    const sink = new FileSink(join(blocker, 'client.log'));

    expect(() => {
      sink.write('entry\n');
    }).not.toThrow();
    await expect(sink.flush()).resolves.toBeUndefined();
  });

  it('prunes dated files older than the retention window', async () => {
    await writeFile(join(dir, 'client-2026-08-01.log'), 'old');
    await writeFile(join(dir, 'client-2026-08-15.log'), 'recent');
    const sink = new FileSink(join(dir, 'client.log'), 7);

    const deleted = await sink.prune(new Date(Date.UTC(2026, 7, 16)));

    expect(deleted).toBe(1);
    expect(await readdir(dir)).toEqual(['client-2026-08-15.log']);
  });

  it('reads the age from the filename, not the mtime, so an appended file still ages out', async () => {
    const stale = join(dir, 'client-2026-08-01.log');
    await writeFile(stale, 'old');
    await writeFile(stale, 'touched just now');
    const sink = new FileSink(join(dir, 'client.log'), 7);

    expect(await sink.prune(new Date(Date.UTC(2026, 7, 16)))).toBe(1);
  });

  it('keeps a file dated exactly the retention window and deletes one dated one day earlier', async () => {
    // With retentionDays 7 and now = 2026-08-16, the window's inclusive edge
    // is 2026-08-09 (16 - 7): that date is kept, one day older is not. The
    // window therefore spans retentionDays + 1 calendar dates, matching the
    // PHP original's >= comparison.
    await writeFile(join(dir, 'client-2026-08-09.log'), 'edge, kept');
    await writeFile(join(dir, 'client-2026-08-08.log'), 'one day older, deleted');
    const sink = new FileSink(join(dir, 'client.log'), 7);

    const deleted = await sink.prune(new Date(Date.UTC(2026, 7, 16)));

    expect(deleted).toBe(1);
    expect(await readdir(dir)).toEqual(['client-2026-08-09.log']);
  });

  it('keeps everything when retention is zero', async () => {
    await writeFile(join(dir, 'client-2020-01-01.log'), 'ancient');
    const sink = new FileSink(join(dir, 'client.log'), 0);

    expect(await sink.prune(new Date(Date.UTC(2026, 7, 16)))).toBe(0);
    expect(await readdir(dir)).toHaveLength(1);
  });

  it('never touches a file outside its own dated pattern', async () => {
    await writeFile(join(dir, 'other-2026-08-01.log'), 'not ours');
    await writeFile(join(dir, 'client-2026-08-01.txt'), 'wrong extension');
    await writeFile(join(dir, 'client.log'), 'the base path itself');
    const sink = new FileSink(join(dir, 'client.log'), 7);

    expect(await sink.prune(new Date(Date.UTC(2026, 7, 16)))).toBe(0);
    expect((await readdir(dir)).sort()).toEqual(['client-2026-08-01.txt', 'client.log', 'other-2026-08-01.log']);
  });

  it('prunes once per process per base path', async () => {
    await writeFile(join(dir, 'client-2026-08-01.log'), 'old');
    const sink = new FileSink(join(dir, 'client.log'), 7);

    sink.write('a\n');
    await sink.flush();
    await writeFile(join(dir, 'client-2026-08-02.log'), 'old too');
    sink.write('b\n');
    await sink.flush();

    // The second write must not have pruned again.
    expect(await readdir(dir)).toContain('client-2026-08-02.log');
  });

  it('returns zero when the directory does not exist', async () => {
    const sink = new FileSink(join(dir, 'missing', 'client.log'), 7);
    expect(await sink.prune(new Date(Date.UTC(2026, 7, 16)))).toBe(0);
  });

  it('inserts the date before the last extension of a multi-dot base path', () => {
    const sink = new FileSink(join(dir, 'client.v2.log'));
    expect(sink.pathForDate(new Date(Date.UTC(2026, 7, 16)))).toBe(join(dir, 'client.v2-2026-08-16.log'));
  });

  it('prunes only its own multi-dot files, leaving a similarly named neighbour untouched', async () => {
    await writeFile(join(dir, 'client.v2-2026-08-01.log'), 'ours, stale');
    await writeFile(join(dir, 'client-2026-08-01.log'), 'not ours: no ".v2" in the stem');
    const sink = new FileSink(join(dir, 'client.v2.log'), 7);

    const deleted = await sink.prune(new Date(Date.UTC(2026, 7, 16)));

    expect(deleted).toBe(1);
    expect(await readdir(dir)).toEqual(['client-2026-08-01.log']);
  });
});
