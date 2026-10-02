import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { pbkdf2Sync } from 'node:crypto';
import { Store, type Database, type Statement } from '../lib/store';
import type { ApiEnv } from '../lib/api';
export class SqliteD1 implements Database {
  sqlite = new DatabaseSync(':memory:');
  prepare(sql: string): Statement {
    const db = this.sqlite;
    let args: SQLInputValue[] = [];
    const st: Statement = {
      bind(...values: unknown[]) {
        args = values as SQLInputValue[];
        return st;
      },
      async first<T>() {
        return (db.prepare(sql).get(...args) ?? null) as T | null;
      },
      async all<T>() {
        return { results: db.prepare(sql).all(...args) as T[] };
      },
      async run() {
        const r = db.prepare(sql).run(...args);
        return { meta: { changes: Number(r.changes) } };
      },
    };
    return st;
  }
  async batch(statements: Statement[]) {
    this.sqlite.exec('BEGIN');
    try {
      const results = [];
      for (const s of statements) results.push(await s.run());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (e) {
      this.sqlite.exec('ROLLBACK');
      throw e;
    }
  }
}
export async function fixture() {
  const DB = new SqliteD1();
  const store = new Store(DB);
  await store.init();
  const files = new Map<
    string,
    { bytes: Uint8Array; httpMetadata: { contentType: string } }
  >();
  const FILES = {
    async put(
      key: string,
      bytes: Uint8Array,
      options: { httpMetadata: { contentType: string } },
    ) {
      files.set(key, { bytes, httpMetadata: options.httpMetadata });
    },
    async head(key: string) {
      return files.get(key) ?? null;
    },
    async get(key: string) {
      const item = files.get(key);
      return item
        ? { body: item.bytes, httpMetadata: item.httpMetadata }
        : null;
    },
  };
  const password = 'Local-test-fixture-only-123';
  const salt = 'test-only';
  const env = {
    DB,
    FILES: FILES as unknown as R2Bucket,
    DEMO_MODE: 'true',
    ALLOW_FORMAL_PUBLISH: 'false',
    ADMIN_CREDENTIAL: `${salt}:${pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex')}`,
  } satisfies ApiEnv;
  return { DB, store, env, password, files };
}
