import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeImage } from '../../test/fixtures';
import { formatReport, parseBenchArgs, percentile, runBench } from './bench-lib';

describe('parseBenchArgs', () => {
  it('needs a folder and applies defaults', () => {
    expect(() => parseBenchArgs([])).toThrow('--dir');
    expect(parseBenchArgs(['--', '--dir', 'C:\\Pictures\\Splash Arts'])).toMatchObject({
      dir: 'C:\\Pictures\\Splash Arts',
      rooms: 3,
      rounds: 2,
      steps: 10,
      limit: 12,
      concurrency: 2,
      names: false,
      json: null,
    });
  });

  it('reads the options and the image limits of the environment', () => {
    const options = parseBenchArgs(
      [
        '--dir',
        'x',
        '--rooms',
        '8',
        '--steps',
        '20',
        '--concurrency',
        '1',
        '--names',
        '--json',
        'r.json',
      ],
      { IMAGE_MAX_PIXELS: '65000000', IMAGE_CONCURRENCY: '4' },
    );
    expect(options).toMatchObject({
      rooms: 8,
      steps: 20,
      concurrency: 1,
      maxPixels: 65_000_000,
      names: true,
      json: 'r.json',
    });
    expect(parseBenchArgs(['--dir', 'x'], { IMAGE_CONCURRENCY: '4' }).concurrency).toBe(4);
  });

  it('refuses unknown, missing and out-of-range options', () => {
    for (const argv of [
      ['--dir', 'x', '--rooms', '0'],
      ['--dir', 'x', '--rooms', '51'],
      ['--dir', 'x', '--steps', '2'],
      ['--dir', 'x', '--rooms', 'many'],
      ['--dir', 'x', '--unknown', '1'],
      ['--dir'],
      ['stray'],
    ]) {
      expect(() => parseBenchArgs(argv), argv.join(' ')).toThrow();
    }
  });
});

describe('percentile', () => {
  it('is the nearest rank, and 0 for nothing', () => {
    expect(percentile([], 95)).toBe(0);
    expect(percentile([5], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 100], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 100], 95)).toBe(100);
  });
});

describe('runBench', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'bench-source-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const digest = async (): Promise<Record<string, string>> => {
    const result: Record<string, string> = {};
    for (const name of (await readdir(dir)).sort()) {
      result[name] = createHash('sha256')
        .update(await readFile(path.join(dir, name)))
        .digest('hex');
    }
    return result;
  };
  const scratchCount = async (): Promise<number> =>
    (await readdir(os.tmpdir())).filter((name) => name.startsWith('ressa-bench-')).length;

  it('measures real pictures, never touches them, and cleans up after itself', async () => {
    await writeFile(
      path.join(dir, 'a.png'),
      await makeImage({ width: 1600, height: 900, seed: 1 }),
    );
    await writeFile(
      path.join(dir, 'b.jpg'),
      await makeImage({ width: 1215, height: 717, seed: 2, format: 'jpeg' }),
    );
    await writeFile(path.join(dir, 'broken.png'), Buffer.from('not a picture'));
    await writeFile(path.join(dir, 'notes.txt'), 'ignored');
    const before = await digest();
    const scratchBefore = await scratchCount();

    const lines: string[] = [];
    const report = await runBench(
      {
        dir,
        rooms: 2,
        rounds: 2,
        steps: 4,
        limit: 12,
        concurrency: 2,
        maxPixels: 40_000_000,
        minSide: 256,
        names: false,
        json: null,
      },
      (line) => lines.push(line),
    );

    expect(report.images).toHaveLength(2);
    expect(report.rejected).toBe(1);
    expect(report.rounds).toHaveLength(4);
    expect(report.rounds.every((round) => round.allFramesMs >= round.firstFrameMs)).toBe(true);
    expect(report.summary.peakRssMb).toBeGreaterThan(0);
    // File names are not printed unless asked for.
    const text = formatReport(report) + lines.join('\n');
    expect(text).not.toContain('a.png');
    expect(text).toContain('#1');
    expect(await digest()).toEqual(before);
    expect(await scratchCount()).toBe(scratchBefore);
  }, 60_000);

  it('says so when there is nothing to measure', async () => {
    await expect(
      runBench({
        dir,
        rooms: 1,
        rounds: 1,
        steps: 3,
        limit: 12,
        concurrency: 1,
        maxPixels: 40_000_000,
        minSide: 256,
        names: false,
        json: null,
      }),
    ).rejects.toThrow('No JPEG, PNG or WebP');
  });
});
