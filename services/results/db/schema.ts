import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
export const templates = sqliteTable(
  'templates',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    payload: text('payload').notNull(),
    revision: integer('revision').notNull().default(0),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('templates_kind_name_unique').on(t.kind, t.name)],
);
export const examState = sqliteTable('exam_state', {
  id: integer('id').primaryKey(),
  config: text('config').notNull(),
  revision: integer('revision').notNull().default(0),
  published: text('published').notNull().default('closed'),
  batchId: text('batch_id'),
  importedAt: text('imported_at'),
  sourceFileName: text('source_file_name'),
  isDemo: integer('is_demo').notNull().default(1),
});
export const students = sqliteTable('students', {
  examNo: text('exam_no').primaryKey(),
  name: text('name').notNull(),
  scores: text('scores').notNull(),
  total: text('total').notNull(),
});
export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  expiresAt: integer('expires_at').notNull(),
});
export const rateLimits = sqliteTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
