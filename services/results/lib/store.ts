import {
  configSchema,
  defaultConfig,
  type Config,
  type State,
  type Student,
} from './domain';
import {
  templatePayloadSchema,
  type TemplatePayload,
  type SavedTemplate,
} from './templates';
import type { StudentInformation } from './student-information';
export interface Statement {
  bind(...args: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
export interface Database {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<{ meta: { changes: number } }[]>;
}
export const DDL = [
  `CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, payload TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, UNIQUE(kind,name))`,
  `CREATE TABLE IF NOT EXISTS exam_state (id INTEGER PRIMARY KEY CHECK(id=1), config TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, published TEXT NOT NULL DEFAULT 'closed', batch_id TEXT, imported_at TEXT, is_demo INTEGER NOT NULL DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS students (exam_no TEXT PRIMARY KEY, name TEXT NOT NULL, branch TEXT NOT NULL DEFAULT 'XX 分校', scores TEXT NOT NULL, total TEXT NOT NULL, source_data TEXT NOT NULL DEFAULT '{}')`,
  `CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
];
export class Conflict extends Error {
  constructor() {
    super('数据已被另一次操作更新，请刷新后重试');
  }
}
export class DuplicateStudent extends Error {
  constructor() {
    super('该考号已存在，未覆盖原学生。请核对考号后补录。');
  }
}
export class Store {
  constructor(public db: Database) {}
  async init() {
    await this.db.batch(DDL.map((sql) => this.db.prepare(sql)));
    const columns = await this.db.prepare('PRAGMA table_info(students)').all<{ name: string }>();
    if (!columns.results.some((column) => column.name === 'branch'))
      await this.db.prepare("ALTER TABLE students ADD COLUMN branch TEXT NOT NULL DEFAULT 'XX 分校'").run();
    for (const name of ['class_name', 'exam_session', 'year_level']) {
      if (!columns.results.some((column) => column.name === name))
        await this.db.prepare(`ALTER TABLE students ADD COLUMN ${name} TEXT NOT NULL DEFAULT ''`).run();
    }
    if (!columns.results.some((column) => column.name === 'source_data'))
      await this.db.prepare("ALTER TABLE students ADD COLUMN source_data TEXT NOT NULL DEFAULT '{}'").run();
    await this.db
      .prepare('INSERT OR IGNORE INTO exam_state(id,config) VALUES(1,?)')
      .bind(JSON.stringify(defaultConfig()))
      .run();
  }
  async state(): Promise<State> {
    const row = await this.db
      .prepare(
        'SELECT *, (SELECT COUNT(*) FROM students) AS count FROM exam_state WHERE id=1',
      )
      .first<{
        config: string;
        revision: number;
        published: State['published'];
        batch_id: string | null;
        imported_at: string | null;
        is_demo: number;
        count: number;
      }>();
    if (!row) throw new Error('数据库尚未初始化');
    return {
      config: configSchema.parse(JSON.parse(row.config)),
      revision: row.revision,
      published: row.published,
      batchId: row.batch_id,
      importedAt: row.imported_at,
      isDemoData: !!row.is_demo,
      count: row.count,
    };
  }
  async saveConfig(config: Config, revision: number) {
    const r = await this.db
      .prepare(
        "UPDATE exam_state SET config=?,revision=revision+1 WHERE id=1 AND revision=? AND published='closed'",
      )
      .bind(JSON.stringify(config), revision)
      .run();
    if (!r.meta.changes) throw new Conflict();
  }
  async replace(
    students: Student[],
    revision: number,
    isDemo: boolean,
    config?: Config,
    paper?: { id: string; revision: number },
  ) {
    // All three statements execute as one D1 transaction. Optimistic guard prevents stale replacements.
    const paperGuard = paper
      ? " AND EXISTS(SELECT 1 FROM templates WHERE id=? AND revision=? AND kind='paper')"
      : '';
    const guard =
      "EXISTS(SELECT 1 FROM exam_state WHERE id=1 AND revision=? AND published='closed')" +
      paperGuard;
    const bindings = paper ? [revision, paper.id, paper.revision] : [revision];
    const results = await this.db.batch([
      this.db.prepare(`DELETE FROM students WHERE ${guard}`).bind(...bindings),
      this.db
        .prepare(
          `INSERT INTO students(exam_no,name,branch,class_name,exam_session,year_level,scores,total,source_data) SELECT json_extract(value,'$.examNo'),json_extract(value,'$.name'),COALESCE(json_extract(value,'$.branch'),'XX 分校'),COALESCE(json_extract(value,'$.className'),''),COALESCE(json_extract(value,'$.examSession'),''),COALESCE(json_extract(value,'$.yearLevel'),''),json_extract(value,'$.scores'),json_extract(value,'$.total'),COALESCE(json_extract(value,'$.sourceData'),'{}') FROM json_each(?) WHERE ${guard}`,
        )
        .bind(JSON.stringify(students), ...bindings),
      this.db
        .prepare(
          "UPDATE exam_state SET batch_id=?,imported_at=?,is_demo=?,config=COALESCE(?,config),revision=revision+1 WHERE id=1 AND revision=? AND published='closed'" +
            paperGuard,
        )
        .bind(
          crypto.randomUUID(),
          new Date().toISOString(),
          isDemo ? 1 : 0,
          config ? JSON.stringify(config) : null,
          ...bindings,
        ),
    ]);
    if (!results[2].meta.changes) throw new Conflict();
  }
  async publish(mode: State['published'], revision: number) {
    const r = await this.db
      .prepare(
        'UPDATE exam_state SET published=?,revision=revision+1 WHERE id=1 AND revision=?',
      )
      .bind(mode, revision)
      .run();
    if (!r.meta.changes) throw new Conflict();
  }
  async hasExamNo(examNo: string) {
    return !!(await this.db
      .prepare('SELECT 1 FROM students WHERE exam_no=?')
      .bind(examNo)
      .first());
  }
  async appendStudent(student: Student, revision: number, batchId: string) {
    // INSERT and revision update share one transaction; never UPDATE or REPLACE a student.
    const guard =
      "EXISTS(SELECT 1 FROM exam_state WHERE id=1 AND revision=? AND batch_id=? AND published='closed')";
    try {
      const result = await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO students(exam_no,name,branch,class_name,exam_session,year_level,scores,total,source_data) SELECT ?,?,?,?,?,?,?,?,? WHERE ${guard} AND (SELECT COUNT(*) FROM students)<2000`,
          )
          .bind(
            student.examNo,
            student.name,
            student.branch || 'XX 分校',
            student.className || '',
            student.examSession || '',
            student.yearLevel || '',
            JSON.stringify(student.scores),
            student.total,
            JSON.stringify(student.sourceData ?? {}),
            revision,
            batchId,
          ),
        this.db
          .prepare(
            "UPDATE exam_state SET revision=revision+1 WHERE changes()=1 AND id=1 AND revision=? AND batch_id=? AND published='closed'",
          )
          .bind(revision, batchId),
      ]);
      if (!result[0].meta.changes || !result[1].meta.changes)
        throw new Conflict();
    } catch (e) {
      if (/UNIQUE constraint failed: students.exam_no/.test(String(e)))
        throw new DuplicateStudent();
      throw e;
    }
  }
  async updateStudentInformation(examNo: string, information: StudentInformation, revision: number, batchId: string) {
    // Metadata and the version advance together; original columns and scores stay intact.
    const result = await this.db.batch([
      this.db.prepare(
        "UPDATE students SET branch=?,class_name=?,exam_session=?,year_level=? WHERE exam_no=? AND EXISTS(SELECT 1 FROM exam_state WHERE id=1 AND revision=? AND batch_id=? AND published='closed')",
      ).bind(information.branch ?? '', information.className ?? '', information.examSession ?? '', information.yearLevel ?? '', examNo, revision, batchId),
      this.db.prepare(
        "UPDATE exam_state SET revision=revision+1 WHERE changes()=1 AND id=1 AND revision=? AND batch_id=? AND published='closed'",
      ).bind(revision, batchId),
    ]);
    if (!result[0].meta.changes || !result[1].meta.changes) throw new Conflict();
  }
  async student(name: string, examNo: string): Promise<Student | null> {
    const row = await this.db
      .prepare(
        'SELECT exam_no,name,branch,class_name AS className,exam_session AS examSession,year_level AS yearLevel,scores,total,source_data AS sourceData FROM students WHERE exam_no=? AND name=?',
      )
      .bind(examNo, name)
      .first<{
        exam_no: string;
        name: string;
        branch: string;
        className: string;
        examSession: string;
        yearLevel: string;
        scores: string;
        total: string;
        sourceData: string;
      }>();
    return row
      ? {
          examNo: row.exam_no,
          name: row.name,
          branch: row.branch,
          className: row.className,
          examSession: row.examSession,
          yearLevel: row.yearLevel,
          scores: JSON.parse(row.scores),
          total: row.total,
          ...(row.sourceData && row.sourceData !== '{}'
            ? { sourceData: JSON.parse(row.sourceData) }
            : {}),
        }
      : null;
  }
  async list(page: number, pageSize = 10) {
    return (
      await this.db
        .prepare(
          'SELECT exam_no AS examNo,name,branch,class_name AS className,exam_session AS examSession,year_level AS yearLevel,total FROM students ORDER BY exam_no LIMIT ? OFFSET ?',
        )
        .bind(pageSize, (page - 1) * pageSize)
        .all()
    ).results;
  }
  async allStudents(): Promise<Student[]> {
    const rows = await this.db
      .prepare('SELECT exam_no AS examNo,name,branch,class_name AS className,exam_session AS examSession,year_level AS yearLevel,scores,total,source_data AS sourceData FROM students ORDER BY exam_no')
      .all<{ examNo: string; name: string; branch: string; scores: string; total: string; sourceData: string }>();
    return rows.results.map((r) => {
      const { sourceData, ...student } = r;
      return {
        ...student,
        scores: JSON.parse(r.scores),
        ...(sourceData && sourceData !== '{}'
          ? { sourceData: JSON.parse(sourceData) }
          : {}),
      };
    });
  }
  async templates(): Promise<SavedTemplate[]> {
    const rows = await this.db
      .prepare('SELECT * FROM templates ORDER BY updated_at DESC,id')
      .all<{
        id: string;
        name: string;
        payload: string;
        revision: number;
        updated_at: string;
      }>();
    return rows.results.map((r) => ({
      ...templatePayloadSchema.parse(JSON.parse(r.payload)),
      id: r.id,
      name: r.name,
      revision: r.revision,
      updatedAt: r.updated_at,
    }));
  }
  async template(id: string): Promise<SavedTemplate | null> {
    const row = await this.db
      .prepare('SELECT * FROM templates WHERE id=?')
      .bind(id)
      .first<{
        id: string;
        name: string;
        payload: string;
        revision: number;
        updated_at: string;
      }>();
    return row
      ? {
          ...templatePayloadSchema.parse(JSON.parse(row.payload)),
          id: row.id,
          name: row.name,
          revision: row.revision,
          updatedAt: row.updated_at,
        }
      : null;
  }
  async saveTemplate(name: string, payload: TemplatePayload) {
    const id = crypto.randomUUID();
    const result = await this.db
      .prepare(
        'INSERT OR IGNORE INTO templates(id,kind,name,payload,updated_at) VALUES(?,?,?,?,?)',
      )
      .bind(
        id,
        payload.kind,
        name,
        JSON.stringify(payload),
        new Date().toISOString(),
      )
      .run();
    if (!result.meta.changes) throw new TemplateNameConflict();
    return id;
  }
  async renameTemplate(id: string, name: string, revision: number) {
    const result = await this.db
      .prepare(
        'UPDATE OR IGNORE templates SET name=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?',
      )
      .bind(name, new Date().toISOString(), id, revision)
      .run();
    if (!result.meta.changes) throw new TemplateNameConflict();
  }
  async updatePaper(
    id: string,
    name: string,
    revision: number,
    payload: TemplatePayload,
  ) {
    if (payload.kind !== 'paper') throw new Error('仅配套试卷支持更新默认版本');
    const result = await this.db
      .prepare(
        "UPDATE OR IGNORE templates SET name=?,payload=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND kind='paper'",
      )
      .bind(
        name,
        JSON.stringify(payload),
        new Date().toISOString(),
        id,
        revision,
      )
      .run();
    if (!result.meta.changes) throw new Conflict();
  }
  async deleteTemplate(id: string, revision: number) {
    // Live exams store independent snapshots. Never delete students, configuration or images.
    const result = await this.db
      .prepare('DELETE FROM templates WHERE id=? AND revision=?')
      .bind(id, revision)
      .run();
    if (!result.meta.changes) throw new Conflict();
  }
  async limit(key: string, limit: number, seconds: number) {
    const now = Date.now();
    const row = await this.db
      .prepare(
        'INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING count',
      )
      .bind(key, now + seconds * 1000, now, now)
      .first<{ count: number }>();
    return (row?.count ?? limit + 1) <= limit;
  }
}
export class TemplateNameConflict extends Error {
  constructor() {
    super('模板名称已存在或模板已被更新，请换一个名称或刷新后重试');
  }
}
