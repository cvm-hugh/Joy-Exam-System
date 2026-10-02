import ExcelJS from 'exceljs';
import { DIMENSIONS, GRADES, type Config } from './domain';
import { ImportError, readRows } from './importer';
import {
  evaluationFrom,
  evaluationTemplateSchema,
  type EvaluationTemplate,
} from './templates';

const HEADERS = ['维度', '等级', '能力描述', '学习建议', '下一步建议'];
const aliases: Record<string, string> = {
  词汇应用: 'vocabulary',
  语言运用: 'grammar',
  情景交际: 'communication',
};
export type EvaluationImport = {
  data: EvaluationTemplate;
  warnings: string[];
  rows: { dimension: string; grade: string; paragraphs: string[] }[];
};
export function validateEvaluationRows(
  rows: unknown[][],
  config: Config,
): EvaluationImport {
  const issues: string[] = [],
    warnings = new Set<string>();
  if (rows.length < 2) throw new ImportError(['评价文件为空']);
  const header = rows[0].map((v) => (typeof v === 'string' ? v.trim() : ''));
  if (
    header.length !== 5 ||
    header.some((v, i) => v !== HEADERS[i] && !(i === 3 && v === '进步方向'))
  )
    throw new ImportError([
      '请使用固定5列：维度、等级、能力描述、学习建议、下一步建议。每行都填写维度和等级，不合并单元格。',
    ]);
  if (header[3] === '进步方向')
    warnings.add('“进步方向”导入到第二段“学习建议”');
  const data = evaluationFrom(config);
  data.paragraphTitles = ['能力描述', '学习建议', '下一步建议'];
  const seen = new Set<string>();
  rows.slice(1).forEach((row, index) => {
    const line = index + 2;
    if (row.every((v) => v == null || v === '')) return;
    if (row.length !== 5 || row.some((v) => typeof v !== 'string')) {
      issues.push(`第${line}行：须为5列纯文字，不接受公式、合并或错位行`);
      return;
    }
    const cells = (row as string[]).map((s) => s.trim());
    const name = cells[0].replace(/^\d+[.．、]\s*/, '');
    const exact = config.analysis.dimensions.filter((d) => d.name === name);
    const legacy = DIMENSIONS.find((d) => d.name === name)?.id ?? aliases[name];
    const d =
      exact[0] ?? config.analysis.dimensions.find((d) => d.id === legacy);
    if (!d) {
      issues.push(`第${line}行：未知维度“${cells[0]}”，请使用当前六维名称`);
      return;
    }
    if (d.name !== cells[0]) warnings.add(`维度“${cells[0]}” → “${d.name}”`);
    const grade = cells[1] === '良' ? '良好' : cells[1];
    if (grade !== cells[1]) warnings.add('等级“良” → “良好”');
    const g = GRADES.findIndex((value) => value === grade);
    if (g < 0) {
      issues.push(`第${line}行：等级应为卓越、优秀、良好、待加强`);
      return;
    }
    const key = `${d.id}:${g}`;
    if (seen.has(key)) issues.push(`第${line}行：${d.name} × ${grade}重复`);
    seen.add(key);
    const paragraphs = cells
      .slice(2)
      .map((s) => s.replace(/<br\s*\/?\s*>/gi, '\n')) as [
      string,
      string,
      string,
    ];
    if (paragraphs.some((s) => !s || s.length > 2000))
      issues.push(`第${line}行：三段评价均必填，每段最多2000字`);
    if (paragraphs.some((s, i) => s !== cells[i + 2]))
      warnings.add('正文中的<br>已转为换行，未改写文字内容');
    if (paragraphs.some((s) => /如[:：]\s*$/.test(s)))
      warnings.add(
        `${d.name} × ${grade}：正文以“如：”结尾，请核对是否缺少例子`,
      );
    const dim = data.dimensions.find((x) => x.id === d.id)!;
    // Spreadsheet import replaces text only; custom titles/images remain under staff control.
    dim.evaluations[g] = {
      ...dim.evaluations[g],
      paragraphs,
      placeholder: false,
    };
  });
  config.analysis.dimensions.forEach((d) =>
    GRADES.forEach((g, i) => {
      if (!seen.has(`${d.id}:${i}`)) issues.push(`缺少 ${d.name} × ${g}`);
    }),
  );
  if (issues.length) throw new ImportError(issues.slice(0, 100));
  evaluationTemplateSchema.parse(data);
  return {
    data,
    warnings: [...warnings],
    rows: data.dimensions.flatMap((d) =>
      d.evaluations.map((e, i) => ({
        dimension: d.name,
        grade: GRADES[i],
        paragraphs: e.paragraphs,
      })),
    ),
  };
}
export async function parseEvaluations(
  name: string,
  bytes: Uint8Array,
  config: Config,
) {
  return validateEvaluationRows(
    await readRows(name, bytes, '评价内容', 5, 100),
    config,
  );
}
export async function makeEvaluationWorkbook(config: Config, filled = false) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('评价内容');
  sheet.addRow(HEADERS);
  config.analysis.dimensions.forEach((d, i) =>
    GRADES.forEach((g, j) => {
      const row = sheet.addRow([
        d.name,
        g,
        ...(filled
          ? config.dimensions[i].evaluations[j].paragraphs
          : ['', '', '']),
      ]);
      row.height = filled ? 140 : 70;
    }),
  );
  sheet.columns = [18, 12, 60, 60, 50].map((width) => ({ width }));
  sheet.eachRow((row) => {
    row.alignment = { wrapText: true, vertical: 'top' };
  });
  sheet.getRow(1).height = 28;
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF23664F' },
  };
  sheet.views = [{ state: 'frozen', ySplit: 1, xSplit: 2 }];
  sheet.autoFilter = 'A1:E25';
  const guide = book.addWorksheet('填写说明');
  [
    '每行一套评价，共6个维度×4个等级=24行。不要合并单元格，维度与等级每行必填。',
    '三段正文均须填写，每段最多2000字；只填纯文字，不接受公式。',
    '上传后先检查24行预览及名称映射，再载入编辑区或另存评价模板，不会直接覆盖当前评价。',
    '导入只替换三段正文，保留当前自定义评价标题和图片；段落标题统一为能力描述、学习建议、下一步建议。',
    '保存评价模板包含24套文字、评价标题、图片引用和段落标题，不含成绩或等级阈值。',
    ...(filled
      ? [`导出正文的原段落标题：${config.paragraphTitles.join(' / ')}`]
      : []),
  ].forEach((s) => guide.addRow([s]));
  guide.getColumn(1).width = 110;
  return new Uint8Array((await book.xlsx.writeBuffer()) as ArrayBuffer);
}
