import { randomBytes } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Private file storage. Every path is built from a random key generated here
 * and a fixed list of kinds, never from anything a client sent, so there is no
 * way to reach another file (`../`, absolute paths, odd names...).
 *
 *   <root>/original/<key>.webp   normalized source (metadata stripped)
 *   <root>/display/<key>.webp    reduced picture used by the editor
 *   <root>/thumb/<key>.webp      thumbnail for lists
 */
export const STORED_KINDS = ['original', 'display', 'thumb'] as const;
export type StoredKind = (typeof STORED_KINDS)[number];

const KEY_PATTERN = /^[a-f0-9]{32}$/;
const EXTENSION = '.webp';

export function isStorageKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}

export function newStorageKey(): string {
  return randomBytes(16).toString('hex');
}

export class FileStorage {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private filePath(kind: StoredKind, key: string): string {
    if (!isStorageKey(key) || !STORED_KINDS.includes(kind)) {
      throw new Error('invalid storage key');
    }
    return path.join(this.root, kind, `${key}${EXTENSION}`);
  }

  /** Writes through a temporary file and renames it: a reader never sees half a file. */
  async write(kind: StoredKind, key: string, data: Buffer): Promise<void> {
    const target = this.filePath(kind, key);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await writeFile(temporary, data, { flag: 'wx', mode: 0o600 });
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  /** Removes every file of a key. Missing files are fine. */
  async remove(key: string): Promise<void> {
    await Promise.all(STORED_KINDS.map((kind) => rm(this.filePath(kind, key), { force: true })));
  }

  async size(kind: StoredKind, key: string): Promise<number> {
    return (await stat(this.filePath(kind, key))).size;
  }

  open(kind: StoredKind, key: string): ReadStream {
    return createReadStream(this.filePath(kind, key));
  }

  /** Every file in the storage with its age marker (temporary files included). */
  async list(): Promise<{ kind: StoredKind; name: string; modifiedMs: number }[]> {
    const files: { kind: StoredKind; name: string; modifiedMs: number }[] = [];
    for (const kind of STORED_KINDS) {
      // A directory that does not exist yet simply holds nothing.
      const names = await readdir(path.join(this.root, kind)).catch(() => null);
      if (names === null) continue;
      for (const name of names) {
        const info = await stat(path.join(this.root, kind, name)).catch(() => null);
        if (info?.isFile()) files.push({ kind, name, modifiedMs: info.mtimeMs });
      }
    }
    return files;
  }

  async removeByName(kind: StoredKind, name: string): Promise<void> {
    // Only plain names found by `list` are accepted.
    if (name !== path.basename(name) || name.startsWith('.')) throw new Error('invalid file name');
    await rm(path.join(this.root, kind, name), { force: true });
  }
}
