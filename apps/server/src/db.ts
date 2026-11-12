import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from './generated/prisma/client';

export type Db = PrismaClient;
/** Either the client or an open transaction. */
export type DbOrTx = PrismaClient | Prisma.TransactionClient;

export function createDb(databaseUrl: string): Db {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 }),
  });
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
