import { writeFile } from 'node:fs/promises';
import { formatReport, parseBenchArgs, runBench } from './bench-lib';

/**
 * Measures memory and rendering time of Zoom Out on YOUR pictures, with
 * several rooms playing at the same time. The folder is only read, never
 * modified, and nothing is uploaded or kept: temporary files are removed.
 *
 *   pnpm bench:render -- --dir "C:\path\to\pictures" --rooms 3 --rounds 2
 *
 * Options: --dir (required), --rooms (3), --rounds (2), --steps (10),
 * --limit (12 pictures, in name order), --concurrency (IMAGE_CONCURRENCY, 2),
 * --json <file> (also write the report), --names (show file names).
 */
try {
  const options = parseBenchArgs(process.argv.slice(2), process.env);
  const report = await runBench(options, (line) => {
    console.log(line);
  });
  console.log(`\n${formatReport(report)}`);
  if (options.json !== null) {
    await writeFile(options.json, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`\nReport written to ${options.json}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error('Usage: pnpm bench:render -- --dir <folder> [--rooms 3] [--rounds 2] [--steps 10]');
  process.exit(1);
}
