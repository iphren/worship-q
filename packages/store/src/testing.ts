/**
 * Test support: a driver over Node's built-in SQLite and a deterministic environment.
 * Not used by the app itself.
 */
import { createRequire } from 'node:module';
import type { SqlDriver, SqlValue, Statement } from './driver';
import { migrate } from './migrations';
import { Store, type StoreEnv } from './store';

interface NodeDatabase {
  prepare(sql: string): {
    all(...params: SqlValue[]): unknown[];
    run(...params: SqlValue[]): unknown;
  };
  exec(sql: string): void;
  close(): void;
}

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => NodeDatabase;
};

export interface NodeDriver extends SqlDriver {
  close(): void;
}

export function openNodeDriver(path = ':memory:'): NodeDriver {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  return {
    async select<Row>(sql: string, params: SqlValue[] = []) {
      return db
        .prepare(sql)
        .all(...params)
        .map((row) => ({ ...(row as object) })) as Row[];
    },
    async batch(statements: Statement[]) {
      db.exec('BEGIN');
      try {
        for (const { sql, params = [] } of statements) db.prepare(sql).run(...params);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    close: () => db.close(),
  };
}

export interface TestEnv extends StoreEnv {
  /** Sets the current instant. */
  setNow(iso: string): void;
  /** Moves the current instant forward. */
  advance(ms: number): void;
  date(): Date;
}

export function createTestEnv(start = '2026-10-11T09:00:00.000Z'): TestEnv {
  let now = Date.parse(start);
  let counter = 0;
  return {
    now: () => new Date(now).toISOString(),
    newId: () => `id-${++counter}`,
    setNow: (iso) => {
      now = Date.parse(iso);
    },
    advance: (ms) => {
      now += ms;
    },
    date: () => new Date(now),
  };
}

export async function createTestStore(path?: string, env = createTestEnv()) {
  const driver = openNodeDriver(path);
  await migrate(driver);
  return { driver, env, store: new Store(driver, env) };
}
