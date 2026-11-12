import { loadConfig } from '../config';
import { createDb } from '../db';
import { pruneOrphanFiles } from '../modules/images/service';
import { FileStorage } from '../modules/images/storage';

/**
 * Lists the stored files that no image points to, and removes them with
 * `--apply`. Files younger than ten minutes are left alone (an import may be
 * running). Nothing is removed without `--apply`.
 *
 *   pnpm storage:prune
 *   pnpm storage:prune --apply
 */
const apply = process.argv.includes('--apply');
const config = loadConfig(process.env);
const db = createDb(config.DATABASE_URL);
try {
  const storage = new FileStorage(config.STORAGE_DIR);
  const result = await pruneOrphanFiles({ db, storage }, apply);
  for (const file of result.orphans) console.log(file);
  console.log(
    apply
      ? `${result.removed} orphan file(s) removed from ${storage.root}.`
      : `${result.orphans.length} orphan file(s) in ${storage.root}. Nothing removed: run again with --apply.`,
  );
} finally {
  await db.$disconnect();
}
