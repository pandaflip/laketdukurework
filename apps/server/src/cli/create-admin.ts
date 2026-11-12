import { createInterface } from 'node:readline/promises';
import { loadConfig } from '../config';
import { createDb } from '../db';
import { hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../modules/auth/password';
import { normalizeUsername } from '../modules/auth/service';

/**
 * Creates an administrator, or resets the password of an existing one
 * (`--reset`). The password is typed interactively, hidden, and never passed
 * on the command line, so it does not end up in the shell history.
 *
 *   pnpm admin:create
 *   pnpm admin:create --reset
 */

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

let pipedLines: Promise<string[]> | undefined;

/** When stdin is not a terminal (scripts, tests), answers are read line by line from it. */
async function nextPipedLine(question: string): Promise<string> {
  process.stdout.write(question);
  pipedLines ??= (async () => {
    let text = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) text += String(chunk);
    return text.split(/\r?\n/);
  })();
  const line = (await pipedLines).shift();
  process.stdout.write('\n');
  if (line === undefined) throw new Error('Missing answer on standard input.');
  return line;
}

async function ask(question: string): Promise<string> {
  if (!process.stdin.isTTY) return (await nextPipedLine(question)).trim();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/** Reads a line without echoing it. */
function askHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) return nextPipedLine(question);

  return new Promise((resolve, reject) => {
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const finish = (error?: Error): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          finish();
          return;
        }
        if (char === '\u0003') {
          finish(new Error('Cancelled.'));
          return;
        }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');
  const config = loadConfig(process.env);
  const db = createDb(config.DATABASE_URL);

  try {
    const username = normalizeUsername(await ask('Username: '));
    if (!USERNAME_PATTERN.test(username)) {
      throw new Error('Username: 3 to 32 characters (a-z, 0-9, dot, dash, underscore).');
    }

    const existing = await db.adminUser.findUnique({ where: { username } });
    if (existing && !reset) {
      throw new Error(`"${username}" already exists. Use --reset to change the password.`);
    }
    if (!existing && reset) throw new Error(`"${username}" does not exist.`);

    const password = await askHidden(`Password (at least ${PASSWORD_MIN_LENGTH} characters): `);
    if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
      throw new Error(
        `Password must be ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters long.`,
      );
    }
    if ((await askHidden('Repeat password: ')) !== password) {
      throw new Error('The two passwords do not match.');
    }

    const passwordHash = await hashPassword(password);
    if (existing) {
      await db.$transaction([
        db.adminUser.update({
          where: { id: existing.id },
          data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
        }),
        // Changing the password signs every device out.
        db.adminSession.deleteMany({ where: { adminId: existing.id } }),
      ]);
      console.log(`Password updated for "${username}". Existing sessions were closed.`);
    } else {
      await db.adminUser.create({ data: { username, passwordHash } });
      console.log(`Administrator "${username}" created.`);
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Unexpected error.');
  process.exitCode = 1;
});
