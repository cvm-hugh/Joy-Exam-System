import { z } from 'zod';
import {
  paperTemplateSchema,
  templateNameSchema,
  type PaperTemplate,
} from './templates';

export const PAPER_FILE_FORMAT = 'joy-exam-paper-template';
export const PAPER_FILE_VERSION = 1;

const portableAssetSchema = z
  .object({
    source: z.string().min(1),
    mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    base64: z.string().min(1).max(2_700_000),
  })
  .strict();

export const paperTemplateFileSchema = z
  .object({
    format: z.literal(PAPER_FILE_FORMAT),
    version: z.literal(PAPER_FILE_VERSION),
    name: templateNameSchema,
    exportedAt: z.iso.datetime(),
    paper: paperTemplateSchema,
    assets: z.array(portableAssetSchema).max(24),
  })
  .strict()
  .superRefine((bundle, ctx) => {
    const available = new Set(bundle.assets.map((asset) => asset.source));
    for (const ref of paperImageRefs(bundle.paper)) {
      if (!available.has(ref))
        ctx.addIssue({
          code: 'custom',
          path: ['assets'],
          message: `套卷文件缺少评价图片：${ref}`,
        });
    }
  });

export type PaperTemplateFile = z.infer<typeof paperTemplateFileSchema>;

export function paperImageRefs(paper: PaperTemplate) {
  return [
    ...new Set(
      paper.dimensions
        .flatMap((dimension) =>
          dimension.evaluations.map((evaluation) => evaluation.image),
        )
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

export function makePaperTemplateFile(
  name: string,
  paper: PaperTemplate,
  assets: PaperTemplateFile['assets'],
): PaperTemplateFile {
  return paperTemplateFileSchema.parse({
    format: PAPER_FILE_FORMAT,
    version: PAPER_FILE_VERSION,
    name,
    exportedAt: new Date().toISOString(),
    paper,
    assets,
  });
}

export function parsePaperTemplateFile(text: string): PaperTemplateFile {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('这不是有效的试卷模板文件');
  }
  const parsed = paperTemplateFileSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      `试卷模板文件内容不完整或版本不兼容：${parsed.error.issues[0]?.message ?? '未知错误'}`,
    );
  return parsed.data;
}

export function replacePaperImageRefs(
  paper: PaperTemplate,
  replacements: ReadonlyMap<string, string>,
) {
  const next = structuredClone(paper);
  for (const dimension of next.dimensions)
    for (const evaluation of dimension.evaluations)
      if (evaluation.image)
        evaluation.image =
          replacements.get(evaluation.image) ?? evaluation.image;
  return paperTemplateSchema.parse(next);
}
