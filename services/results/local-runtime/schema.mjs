// Shared by D1 and the desktop SQLite runtime. This module contains no user data.
export const DDL = [
  `CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, payload TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, UNIQUE(kind,name))`,
  `CREATE TABLE IF NOT EXISTS exam_state (id INTEGER PRIMARY KEY CHECK(id=1), config TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, published TEXT NOT NULL DEFAULT 'closed', batch_id TEXT, imported_at TEXT, source_file_name TEXT, is_demo INTEGER NOT NULL DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS students (exam_no TEXT PRIMARY KEY, name TEXT NOT NULL, branch TEXT NOT NULL DEFAULT 'XX 分校', scores TEXT NOT NULL, total TEXT NOT NULL, source_data TEXT NOT NULL DEFAULT '{}')`,
  `CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
];

export async function initializeSchema(db, initialConfig) {
  await db.batch(DDL.map((sql) => db.prepare(sql)));
  const stateColumns = await db.prepare('PRAGMA table_info(exam_state)').all();
  if (!stateColumns.results.some((column) => column.name === 'source_file_name'))
    await db.prepare('ALTER TABLE exam_state ADD COLUMN source_file_name TEXT').run();
  const columns = await db.prepare('PRAGMA table_info(students)').all();
  if (!columns.results.some((column) => column.name === 'branch'))
    await db.prepare("ALTER TABLE students ADD COLUMN branch TEXT NOT NULL DEFAULT 'XX 分校'").run();
  for (const name of ['class_name', 'exam_session', 'year_level']) {
    if (!columns.results.some((column) => column.name === name))
      await db.prepare(`ALTER TABLE students ADD COLUMN ${name} TEXT NOT NULL DEFAULT ''`).run();
  }
  if (!columns.results.some((column) => column.name === 'source_data'))
    await db.prepare("ALTER TABLE students ADD COLUMN source_data TEXT NOT NULL DEFAULT '{}'").run();
  if (initialConfig !== undefined)
    await db.prepare('INSERT OR IGNORE INTO exam_state(id,config) VALUES(1,?)')
      .bind(initialConfig).run();
}
