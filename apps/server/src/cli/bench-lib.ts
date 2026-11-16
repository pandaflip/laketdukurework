import {
  aspectRatio,
  buildSteps,
  createRng,
  DEFAULT_ASPECT,
  randomFocus,
  type Rect,
} from '@app/shared';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ZoomOutClues } from '../game/clues/zoom-out';
import { createLimiter, processUpload } from '../modules/images/processing';
import { FileStorage, newStorageKey } from '../modules/images/storage';

const EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

export interface BenchOptions {
  readonly dir: string;
  readonly rooms: number;
  readonly rounds: number;
  readonly steps: number;
  readonly limit: number;
  readonly concurrency: number;
  readonly maxPixels: number;
  readonly minSide: number;
  readonly names: boolean;
  readonly json: string | null;
}

export const BENCH_DEFAULTS = {
  rooms: 3,
  rounds: 2,
  steps: 10,
  limit: 12,
  concurrency: 2,
  maxPixels: 40_000_000,
  minSide: 256,
} as const;

/** Reads `--name value` pairs. Throws a readable message for anything unexpected. */
export function parseBenchArgs(
  argv: readonly string[],
  env: Record<string, string | undefined> = {},
): BenchOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? '';
    if (arg === '--') continue;
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const name = arg.slice(2);
    if (name === 'names') {
      flags.add(name);
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    values.set(name, value);
    index += 1;
  }
  const known = new Set(['dir', 'rooms', 'rounds', 'steps', 'limit', 'concurrency', 'json']);
  for (const name of values.keys())
    if (!known.has(name)) throw new Error(`Unknown option: --${name}`);

  const number = (name: string, fallback: number, min: number, max: number): number => {
    const raw = values.get(name);
    const value = raw === undefined ? fallback : Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(`--${name} must be a whole number between ${min} and ${max}`);
    }
    return value;
  };
  const dir = values.get('dir');
  if (dir === undefined || dir === '') throw new Error('--dir <folder with pictures> is required');

  const fromEnv = (name: string, fallback: number): number => {
    const raw = env[name];
    return raw === undefined ? fallback : Number(raw);
  };
  return {
    dir,
    rooms: number('rooms', BENCH_DEFAULTS.rooms, 1, 50),
    rounds: number('rounds', BENCH_DEFAULTS.rounds, 1, 20),
    steps: number('steps', BENCH_DEFAULTS.steps, 3, 20),
    limit: number('limit', BENCH_DEFAULTS.limit, 1, 200),
    concurrency: number(
      'concurrency',
      fromEnv('IMAGE_CONCURRENCY', BENCH_DEFAULTS.concurrency),
      1,
      16,
    ),
    maxPixels: fromEnv('IMAGE_MAX_PIXELS', BENCH_DEFAULTS.maxPixels),
    minSide: fromEnv('IMAGE_MIN_SIDE', BENCH_DEFAULTS.minSide),
    names: flags.has('names'),
    json: values.get('json') ?? null,
  };
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

const mb = (bytes: number): number => Math.round((bytes / 1_048_576) * 10) / 10;

export interface ImageReport {
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly megapixels: number;
  readonly fileMb: number;
  readonly storedMb: number;
  readonly importMs: number;
}

export interface RoundReport {
  readonly room: number;
  readonly round: number;
  readonly image: string;
  readonly firstFrameMs: number;
  readonly allFramesMs: number;
}

export interface BenchReport {
  readonly environment: {
    readonly node: string;
    readonly platform: string;
    readonly cpus: number;
    readonly totalMemoryMb: number;
    readonly sharp: string;
  };
  readonly options: Omit<BenchOptions, 'dir' | 'json'>;
  readonly images: readonly ImageReport[];
  readonly rejected: number;
  readonly rounds: readonly RoundReport[];
  readonly summary: {
    readonly firstFrameMs: { p50: number; p95: number; max: number };
    readonly allFramesMs: { p50: number; p95: number; max: number };
    readonly wallMs: number;
    readonly baselineRssMb: number;
    readonly peakRssMb: number;
    readonly peakHeapMb: number;
    readonly peakExternalMb: number;
  };
}

/**
 * Plays rounds of Zoom Out rendering the way a server would, on real pictures:
 * every picture goes through the real import pipeline (decoded, validated,
 * stored as a lossless original), then `rooms` rooms start a round at the same
 * time, each cutting `steps` frames, all sharing `concurrency` image slots.
 *
 * The source folder is only READ. Everything written lives in a temporary
 * folder that is removed at the end.
 */
export async function runBench(
  options: BenchOptions,
  log: (line: string) => void = () => undefined,
): Promise<BenchReport> {
  const entries = (await readdir(options.dir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, options.limit);
  if (entries.length === 0) throw new Error('No JPEG, PNG or WebP picture found in that folder');

  const scratch = await mkdtemp(path.join(os.tmpdir(), 'ressa-bench-'));
  try {
    const storage = new FileStorage(scratch);
    const limit = createLimiter(options.concurrency);

    log(`Importing ${entries.length} picture(s) through the real import pipeline...`);
    const prepared: {
      label: string;
      key: string;
      width: number;
      height: number;
      rects: Rect[];
    }[] = [];
    const images: ImageReport[] = [];
    let rejected = 0;
    for (const [index, name] of entries.entries()) {
      const label = options.names ? name : `#${index + 1}`;
      const bytes = await readFile(path.join(options.dir, name));
      const started = performance.now();
      try {
        const processed = await processUpload(bytes, {
          maxPixels: options.maxPixels,
          minSide: options.minSide,
        });
        const key = newStorageKey();
        await storage.write('original', key, processed.original);
        await storage.write('display', key, processed.display);
        const built = buildSteps({
          image: processed,
          ratio: aspectRatio(DEFAULT_ASPECT),
          focus: randomFocus(createRng(index + 1)),
          start: { kind: 'zoom', zoom: 12 },
          end: { kind: 'zoom', zoom: 1 },
          steps: options.steps,
        });
        prepared.push({
          label,
          key,
          width: processed.width,
          height: processed.height,
          rects: built.steps.map((step) => step.rect),
        });
        images.push({
          label,
          width: processed.width,
          height: processed.height,
          megapixels: Math.round((processed.width * processed.height) / 1e5) / 10,
          fileMb: mb(bytes.length),
          storedMb: mb(processed.original.length),
          importMs: Math.round(performance.now() - started),
        });
      } catch {
        rejected += 1;
        log(`  ${label}: refused by the import rules (size, format or damaged); skipped`);
      }
    }
    if (prepared.length === 0) throw new Error('Every picture was refused by the import rules');

    log(`Playing ${options.rounds} round(s) in ${options.rooms} room(s) at the same time...`);
    global.gc?.();
    const baseline = process.memoryUsage();
    let peakRss = baseline.rss;
    let peakHeap = baseline.heapUsed;
    let peakExternal = baseline.external;
    const sampler = setInterval(() => {
      const usage = process.memoryUsage();
      peakRss = Math.max(peakRss, usage.rss);
      peakHeap = Math.max(peakHeap, usage.heapUsed);
      peakExternal = Math.max(peakExternal, usage.external);
    }, 25);

    const rounds: RoundReport[] = [];
    const wallStart = performance.now();
    for (let round = 1; round <= options.rounds; round++) {
      await Promise.all(
        Array.from({ length: options.rooms }, async (_unused, room) => {
          const picked = prepared[(round * options.rooms + room) % prepared.length];
          if (!picked) return;
          const clues = new ZoomOutClues({
            storage,
            storageKey: picked.key,
            width: picked.width,
            height: picked.height,
            rects: picked.rects,
            limit,
          });
          const started = performance.now();
          await clues.render(0);
          const firstFrameMs = Math.round(performance.now() - started);
          clues.prefetch();
          await Promise.all(picked.rects.map((_rect, index) => clues.render(index)));
          rounds.push({
            room: room + 1,
            round,
            image: picked.label,
            firstFrameMs,
            allFramesMs: Math.round(performance.now() - started),
          });
          clues.release();
        }),
      );
    }
    const wallMs = Math.round(performance.now() - wallStart);
    clearInterval(sampler);

    const first = rounds.map((entry) => entry.firstFrameMs);
    const all = rounds.map((entry) => entry.allFramesMs);
    const stats = (values: number[]) => ({
      p50: percentile(values, 50),
      p95: percentile(values, 95),
      max: Math.max(0, ...values),
    });
    return {
      environment: {
        node: process.version,
        platform: `${process.platform} ${os.release()}`,
        cpus: os.cpus().length,
        totalMemoryMb: Math.round(os.totalmem() / 1_048_576),
        sharp: sharp.versions.sharp,
      },
      options: {
        rooms: options.rooms,
        rounds: options.rounds,
        steps: options.steps,
        limit: options.limit,
        concurrency: options.concurrency,
        maxPixels: options.maxPixels,
        minSide: options.minSide,
        names: options.names,
      },
      images,
      rejected,
      rounds,
      summary: {
        firstFrameMs: stats(first),
        allFramesMs: stats(all),
        wallMs,
        baselineRssMb: mb(baseline.rss),
        peakRssMb: mb(peakRss),
        peakHeapMb: mb(peakHeap),
        peakExternalMb: mb(peakExternal),
      },
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export function formatReport(report: BenchReport): string {
  const lines: string[] = [];
  const { environment: env, summary } = report;
  lines.push(
    `Machine: Node ${env.node}, ${env.platform}, ${env.cpus} CPU, ${env.totalMemoryMb} MB RAM, sharp ${env.sharp}`,
    `Settings: ${report.options.rooms} room(s) x ${report.options.rounds} round(s), ${report.options.steps} frames, ${report.options.concurrency} image slot(s)`,
    '',
    'Pictures (through the real import pipeline):',
  );
  for (const image of report.images) {
    lines.push(
      `  ${image.label.padEnd(8)} ${String(image.width).padStart(5)} x ${String(image.height).padEnd(5)} ${String(image.megapixels).padStart(5)} MP  file ${image.fileMb} MB  stored ${image.storedMb} MB  import ${image.importMs} ms`,
    );
  }
  if (report.rejected > 0) lines.push(`  (${report.rejected} refused by the import rules)`);
  lines.push(
    '',
    `First frame (round start):  p50 ${summary.firstFrameMs.p50} ms  p95 ${summary.firstFrameMs.p95} ms  max ${summary.firstFrameMs.max} ms`,
    `All frames ready:           p50 ${summary.allFramesMs.p50} ms  p95 ${summary.allFramesMs.p95} ms  max ${summary.allFramesMs.max} ms`,
    `Total time for all rounds:  ${summary.wallMs} ms`,
    `Memory (process): ${summary.baselineRssMb} MB at rest, peak ${summary.peakRssMb} MB (+${Math.round((summary.peakRssMb - summary.baselineRssMb) * 10) / 10} MB); heap peak ${summary.peakHeapMb} MB, native buffers peak ${summary.peakExternalMb} MB`,
  );
  return lines.join('\n');
}
