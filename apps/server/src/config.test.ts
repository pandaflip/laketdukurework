import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';

const valid = {
  WEB_ORIGIN: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://app:s3cret-value@127.0.0.1:5432/app_dev',
};

function problemsOf(env: Record<string, string | undefined>): readonly string[] {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  throw new Error('expected loadConfig to throw');
}

describe('loadConfig', () => {
  it('applies safe defaults for non-secret settings', () => {
    const config = loadConfig(valid);
    expect(config).toMatchObject({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: 3001,
      TRUST_PROXY: false,
    });
  });

  it('refuses to start without DATABASE_URL or WEB_ORIGIN', () => {
    expect(problemsOf({})).toEqual(
      expect.arrayContaining(['WEB_ORIGIN: missing', 'DATABASE_URL: missing']),
    );
  });

  it('rejects a non-postgres database URL and a WEB_ORIGIN with a path', () => {
    expect(problemsOf({ ...valid, DATABASE_URL: 'mysql://u:p@h/db' })).toHaveLength(1);
    expect(problemsOf({ ...valid, WEB_ORIGIN: 'http://localhost:5173/app' })).toHaveLength(1);
    expect(problemsOf({ ...valid, WEB_ORIGIN: '*' })).toHaveLength(1);
  });

  it('rejects invalid ports and flags', () => {
    expect(problemsOf({ ...valid, PORT: '99999' })).toHaveLength(1);
    expect(problemsOf({ ...valid, TRUST_PROXY: 'yes' })).toHaveLength(1);
  });

  it('never echoes variable values in error messages', () => {
    const problems = problemsOf({ ...valid, DATABASE_URL: 'mysql://user:s3cret-value@h/db' });
    expect(problems.join('\n')).not.toContain('s3cret-value');
  });

  it('returns a frozen object', () => {
    expect(Object.isFrozen(loadConfig(valid))).toBe(true);
  });
});
