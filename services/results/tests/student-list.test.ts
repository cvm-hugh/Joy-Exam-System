import { test } from 'node:test';
import assert from 'node:assert/strict';
import { directPageNumbers, locateStudentInList } from '../lib/student-list';

test('学生列表提供首页、末页和当前页附近的直接页码入口', () => {
  assert.deepEqual(directPageNumbers(1, 24), [1, 2, 3, 24]);
  assert.deepEqual(directPageNumbers(12, 24), [1, 10, 11, 12, 13, 14, 24]);
  assert.deepEqual(directPageNumbers(24, 24), [1, 22, 23, 24]);
});

test('搜索结果定位到对应名单页并勾选，且不清空原选择', () => {
  assert.deepEqual(
    locateStudentInList(['000003'], { examNo: '000025', listIndex: 24 }, 10),
    { selectedExamNos: ['000003', '000025'], page: 3 },
  );
  assert.deepEqual(
    locateStudentInList(['000025'], { examNo: '000025', listIndex: 24 }, 10),
    { selectedExamNos: ['000025'], page: 3 },
  );
});
