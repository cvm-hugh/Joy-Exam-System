export type AdminStudentMatch = { examNo: string; listIndex: number };

export function directPageNumbers(current: number, total: number) {
  const pages = new Set([
    1,
    total,
    current - 2,
    current - 1,
    current,
    current + 1,
    current + 2,
  ]);
  return [...pages]
    .filter((page) => page >= 1 && page <= total)
    .sort((a, b) => a - b);
}

export function locateStudentInList(
  selectedExamNos: string[],
  match: AdminStudentMatch,
  pageSize: number,
) {
  return {
    selectedExamNos: [...new Set([...selectedExamNos, match.examNo])],
    page: Math.floor(match.listIndex / pageSize) + 1,
  };
}
