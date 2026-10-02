import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStudentEntry } from '../lib/student-entry';
import { defaultAnalysis } from '../lib/domain';
import { fixture } from './helpers';
import { Conflict, DuplicateStudent } from '../lib/store';
const analysis = defaultAnalysis();
const input = () => ({
  name: '补录学生',
  branch: '中心分校', className: '一班', examSession: '2026-09-12 上午场', yearLevel: '七年级',
  examNo: '000009',
  scores: Object.fromEntries(analysis.parts.map((p) => [p.id, '0.1'])),
});

test('逐人录入保留前导零并精确合计，共享Part只算一次；非法分数和多余字段拒绝', () => {
  const student = parseStudentEntry(input(), analysis);
  assert.equal(student.examNo, '000009');
  assert.equal(student.total, '1.2');
  for (const value of ['', '-1', '6', 'NaN', '=1+1', '0.00001', '1e0']) {
    const bad = input();
    bad.scores.L1 = value;
    assert.throws(() => parseStudentEntry(bad, analysis));
  }
  const missing = input();
  delete missing.scores.L1;
  assert.throws(() => parseStudentEntry(missing, analysis));
  assert.throws(() =>
    parseStudentEntry({ ...input(), total: '100' }, analysis),
  );
  assert.throws(() => parseStudentEntry({ ...input(), examNo: 9 }, analysis));
  assert.throws(() =>
    parseStudentEntry(
      { ...input(), scores: { ...input().scores, EXTRA: '1' } },
      analysis,
    ),
  );
  const changed = structuredClone(analysis);
  changed.parts[0].max = 0.05;
  assert.throws(() => parseStudentEntry(input(), changed));
});

test('补录事务只追加、保留批次与配置；重复、过期、错批次和开放查询均不写入', async (t) => {
  const { store, DB } = await fixture();
  t.after(() => DB.sqlite.close());
  const original = parseStudentEntry(
    { ...input(), examNo: '000001' },
    analysis,
  );
  const added = parseStudentEntry(input(), analysis);
  await store.replace([original], 0, false);
  const before = await store.state();
  await store.appendStudent(added, before.revision, before.batchId!);
  const after = await store.state();
  assert.equal(after.count, 2);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.batchId, before.batchId);
  assert.equal(after.importedAt, before.importedAt);
  assert.equal(after.isDemoData, false);
  assert.deepEqual(after.config, before.config);
  assert.deepEqual(
    await store.student(original.name, original.examNo),
    original,
  );
  await assert.rejects(
    () =>
      store.appendStudent(
        { ...added, name: '同考号另名' },
        after.revision,
        after.batchId!,
      ),
    DuplicateStudent,
  );
  await assert.rejects(
    () =>
      store.appendStudent(
        { ...added, examNo: 'stale' },
        before.revision,
        before.batchId!,
      ),
    Conflict,
  );
  await assert.rejects(
    () =>
      store.appendStudent(
        { ...added, examNo: 'wrongbatch' },
        after.revision,
        'wrong',
      ),
    Conflict,
  );
  assert.deepEqual(await store.state(), after);
  await store.publish('demo', after.revision);
  await assert.rejects(
    () =>
      store.appendStudent(
        { ...added, examNo: 'blocked' },
        after.revision + 1,
        after.batchId!,
      ),
    Conflict,
  );
  assert.equal((await store.state()).count, 2);
});

test('补录第二条数据库语句失败时完整回滚，且2000人上限不会产生额外记录', async (t) => {
  const { store, DB } = await fixture();
  t.after(() => DB.sqlite.close());
  const student = parseStudentEntry(input(), analysis);
  await store.replace([{ ...student, examNo: 'first' }], 0, false);
  const before = await store.state();
  DB.sqlite.exec(
    "CREATE TRIGGER reject_append BEFORE UPDATE ON exam_state BEGIN SELECT RAISE(ABORT, 'simulated failure'); END",
  );
  await assert.rejects(() =>
    store.appendStudent(student, before.revision, before.batchId!),
  );
  assert.deepEqual(await store.state(), before);
  assert.equal(await store.hasExamNo(student.examNo), false);
  DB.sqlite.exec('DROP TRIGGER reject_append');
  await store.replace(
    Array.from({ length: 2000 }, (_, i) => ({ ...student, examNo: String(i) })),
    before.revision,
    false,
  );
  const full = await store.state();
  await assert.rejects(
    () =>
      store.appendStudent(
        { ...student, examNo: 'overflow' },
        full.revision,
        full.batchId!,
      ),
    Conflict,
  );
  assert.deepEqual(await store.state(), full);
  assert.equal(await store.hasExamNo('overflow'), false);
});
