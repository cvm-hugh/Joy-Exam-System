import { z } from 'zod';
import { configSchema, identitySchema, readiness, resultFor, studentInfoSchema } from './domain';
import { normalizeYearLevel, summarizeStudentInformation } from './student-information';
import {
  Store,
  Conflict,
  DuplicateStudent,
  TemplateNameConflict,
  type Database,
} from './store';
import { parseStudentEntry } from './student-entry';
import {
  templatePayloadSchema,
  templateNameSchema,
  withAnalysis,
  incompatibleStudents,
  thresholdTemplateSchema,
  withThresholds,
  paperTemplateSchema,
  withPaper,
} from './templates';
import {
  makeEvaluationWorkbook,
  parseEvaluations,
} from './evaluation-importer';
import {
  authenticated,
  cookie,
  constantEqual,
  csrfValid,
  digest,
  sessionToken,
  verifyPassword,
} from './security';
import { ImportError, parseFile, makeTemplate } from './importer';
export type ApiEnv = {
  DB: Database;
  FILES: R2Bucket;
  ADMIN_CREDENTIAL?: string;
  DEMO_MODE?: string;
  ALLOW_FORMAL_PUBLISH?: string;
  DESKTOP_BRIDGE_TOKEN?: string;
};
const headers = {
  'Cache-Control': 'no-store, private',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
function json(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(data, { status, headers: { ...headers, ...extra } });
}
class ApiError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
async function resolvePaper(
  store: Store,
  id: FormDataEntryValue | null,
  revision: FormDataEntryValue | null,
) {
  if (!id) return null;
  const key = z.uuid().parse(id);
  if (typeof revision !== 'string' || !/^\d+$/.test(revision))
    throw new ApiError('请选择试卷模板的已保存版本', 409);
  const paper = await store.template(key);
  if (paper?.kind !== 'paper')
    throw new ApiError('试卷模板已删除或不存在，请重新选择', 409);
  if (paper.revision !== Number(revision))
    throw new ApiError(
      '这套试卷已更新。请刷新并重新选择模板、下载成绩表后再导入，当前学生不变。',
      409,
    );
  return paper;
}
async function boundedRequest(request: Request) {
  if (!request.body) return request;
  const limit = request.headers
    .get('content-type')
    ?.includes('multipart/form-data')
    ? 3_200_000
    : 250_000;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new ApiError('请求内容超过大小限制', 413);
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: bytes,
  });
}
const revisionSchema = z.number().int().nonnegative();
const adminPreviewSchema = z
  .object({
    name: identitySchema.shape.name.optional(),
    examNo: identitySchema.shape.examNo.optional(),
  })
  .strict()
  .refine((value) => !!value.name || !!value.examNo, {
    message: '请至少填写学生姓名或考号',
  });
async function body(request: Request) {
  if (!request.headers.get('content-type')?.includes('application/json'))
    throw new ApiError('请求必须为JSON', 415);
  const text = await request.text();
  if (text.length > 250_000) throw new ApiError('请求内容过大', 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError('JSON格式错误');
  }
}
function closed(state: { published: string }) {
  if (state.published !== 'closed')
    throw new ApiError('请先关闭查询，再修改配置或替换成绩', 409);
}
function desktopAuthorized(request: Request, env: ApiEnv) {
  const supplied = request.headers.get('x-joy-desktop-token') ?? '';
  return !!env.DESKTOP_BRIDGE_TOKEN && constantEqual(supplied, env.DESKTOP_BRIDGE_TOKEN);
}
async function createAdminSession(store: Store, request: Request) {
  const token = Array.from(
    crypto.getRandomValues(new Uint8Array(32)),
    (x) => x.toString(16).padStart(2, '0'),
  ).join('');
  await store.db.batch([
    store.db.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(Date.now()),
    store.db.prepare('DELETE FROM rate_limits WHERE expires_at<=?').bind(Date.now()),
    store.db
      .prepare('INSERT INTO sessions(token_hash,expires_at) VALUES(?,?)')
      .bind(await digest(token), Date.now() + 8 * 3600000),
  ]);
  return cookie(token, request.url);
}
function validImage(bytes: Uint8Array) {
  if (
    bytes.length >= 8 &&
    bytes[0] === 137 &&
    bytes[1] === 80 &&
    bytes[2] === 78 &&
    bytes[3] === 71 &&
    bytes[4] === 13 &&
    bytes[5] === 10 &&
    bytes[6] === 26 &&
    bytes[7] === 10
  )
    return { ext: 'png', type: 'image/png' };
  if (
    bytes.length >= 4 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return { ext: 'jpg', type: 'image/jpeg' };
  if (
    bytes.length >= 12 &&
    new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
    new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
  )
    return { ext: 'webp', type: 'image/webp' };
  return null;
}
export async function handleApi(
  request: Request,
  env: ApiEnv,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/?/, '');
    const method = request.method;
    if (Number(request.headers.get('content-length') ?? 0) > 3_200_000)
      return json({ error: '请求超过大小限制' }, 413);
    request = await boundedRequest(request);
    const store = new Store(env.DB);
    await store.init();
    const state = await store.state();
    const demo = env.DEMO_MODE === 'true';
    if (path === 'health' && method === 'GET')
      return json({
        ok: true,
        environment: demo ? 'local-demo' : 'production',
      });
    if (path === 'public/status' && method === 'GET')
      return json({
        title: state.config.queryTitle,
        description: state.config.queryDescription,
        greeting: state.config.pageCopy.greeting,
        welcome: state.config.pageCopy.welcome,
        footer: state.config.pageCopy.queryFooter,
        open: state.published !== 'closed',
        isDemo: state.published === 'demo',
        message: state.published === 'closed' ? state.config.closedMessage : '',
        revision: state.revision,
      });
    if (path === 'public/query' && method === 'POST') {
      // One conservative global bucket is intentional until deployment supplies a trusted client identity.
      if (!(await store.limit('public-query-global', 120, 60)))
        return json({ error: '查询较频繁，请稍后再试' }, 429, {
          'Retry-After': '60',
        });
      if (state.published === 'closed')
        return json({ error: state.config.closedMessage }, 403);
      const parsed = identitySchema.safeParse(await body(request));
      if (!parsed.success)
        return json({ error: state.config.failedMessage }, 400);
      if (
        !(await store.limit(
          `student:${await digest(parsed.data.examNo)}`,
          12,
          60,
        ))
      )
        return json({ error: '查询较频繁，请稍后再试' }, 429, {
          'Retry-After': '60',
        });
      const student = await store.student(parsed.data.name, parsed.data.examNo);
      // Recheck state after lookup to prevent a concurrently closed/replaced batch leaking a stale result.
      const latest = await store.state();
      if (latest.revision !== state.revision || latest.published === 'closed')
        return json({ error: '查询状态已更新，请重新查询' }, 409);
      if (!student) return json({ error: state.config.failedMessage }, 404);
      return json(resultFor(student, state.config, state.published === 'demo'));
    }
    if (path === 'desktop/session' && method === 'GET') {
      if (!desktopAuthorized(request, env))
        return json({ error: '桌面会话无效' }, 401);
      return new Response(null, {
        status: 303,
        headers: {
          ...headers,
          Location: '/',
          'Set-Cookie': await createAdminSession(store, request),
        },
      });
    }
    if (path === 'desktop/handoff' && method === 'POST') {
      if (!desktopAuthorized(request, env))
        return json({ error: '桌面交接通道无效' }, 401);
      closed(state);
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File) || file.size > 3_000_000)
        throw new ApiError('内部成绩数据无效或超过3MB');
      const students = await parseFile(
        file.name,
        new Uint8Array(await file.arrayBuffer()),
        state.config.analysis,
      );
      const sourceFileName = z.string().trim().max(512).optional().parse(form.get('sourceFileName') ?? undefined);
      await store.replace(students, state.revision, false, state.config, undefined, sourceFileName || null);
      return json({ ok: true, count: students.length, information: summarizeStudentInformation(students) });
    }
    if (path === 'admin/login' && method === 'POST') {
      if (!csrfValid(request)) return json({ error: '无效请求来源' }, 403);
      if (!env.ADMIN_CREDENTIAL)
        return json({ error: '管理员尚未初始化，请先运行本地初始化脚本' }, 503);
      if (!(await store.limit('admin-login', 10, 900)))
        return json({ error: '登录尝试过多，请15分钟后重试' }, 429, {
          'Retry-After': '900',
        });
      const parsed = z
        .object({ password: z.string().min(1).max(256) })
        .strict()
        .safeParse(await body(request));
      if (
        !parsed.success ||
        !(await verifyPassword(parsed.data.password, env.ADMIN_CREDENTIAL))
      )
        return json({ error: '登录信息不正确' }, 401);
      return json({ ok: true }, 200, {
        'Set-Cookie': await createAdminSession(store, request),
      });
    }
    const admin = await authenticated(request, store);
    if (path.startsWith('assets/') && method === 'GET') {
      const key = path.slice(7);
      if (!/^[a-f0-9-]+\.(png|jpg|webp)$/.test(key))
        return json({ error: '图片不存在' }, 404);
      const refs = [
        state.config.headerImage,
        state.config.footerImage,
        state.config.coverBackgroundImage,
        state.config.coverQrImage,
        ...state.config.dimensions.flatMap((d) =>
          d.evaluations.map((e) => e.image),
        ),
      ];
      if (
        !admin &&
        (state.published === 'closed' || !refs.includes(`/api/assets/${key}`))
      )
        return json({ error: '图片不存在' }, 404);
      const file = await env.FILES.get(key);
      if (!file) return json({ error: '图片不存在' }, 404);
      return new Response(file.body as BodyInit, {
        headers: {
          ...headers,
          'Content-Type':
            file.httpMetadata?.contentType ?? 'application/octet-stream',
          'Content-Security-Policy': "default-src 'none'",
        },
      });
    }
    if (!path.startsWith('admin/')) return json({ error: '接口不存在' }, 404);
    if (!admin) return json({ error: '请先登录管理后台' }, 401);
    if (method !== 'GET' && !csrfValid(request))
      return json({ error: '无效请求来源' }, 403);
    if (path === 'admin/logout' && method === 'POST') {
      await store.db
        .prepare('DELETE FROM sessions WHERE token_hash=?')
        .bind(await digest(sessionToken(request)))
        .run();
      return json({ ok: true }, 200, {
        'Set-Cookie': cookie('', request.url, 0),
      });
    }
    if (path === 'admin/state' && method === 'GET')
      return json({
        ...state,
        readiness: readiness(state),
        demoAllowed: demo,
        formalAllowed: env.ALLOW_FORMAL_PUBLISH === 'true',
        parts: state.config.analysis.parts,
        dimensions: state.config.analysis.dimensions,
      });
    if (path === 'admin/templates' && method === 'GET')
      return json({ templates: await store.templates() });
    if (path === 'admin/templates' && method === 'POST') {
      const input = z
        .object({ name: templateNameSchema, payload: templatePayloadSchema })
        .strict()
        .parse(await body(request));
      // Saving a reusable template never changes the published exam or students.
      if (
        input.payload.kind === 'evaluation' ||
        input.payload.kind === 'paper'
      ) {
        for (const ref of new Set(
          input.payload.data.dimensions
            .flatMap((d) => d.evaluations.map((e) => e.image))
            .filter(Boolean),
        )) {
          if (!(await env.FILES.head(ref.slice('/api/assets/'.length))))
            throw new ApiError('模板引用的图片不存在，请重新上传');
        }
      }
      const id = await store.saveTemplate(input.name, input.payload);
      return json({ ok: true, id });
    }
    if (path === 'admin/papers' && method === 'PUT') {
      const input = z
        .object({
          id: z.uuid(),
          name: templateNameSchema,
          revision: revisionSchema,
          data: paperTemplateSchema,
        })
        .strict()
        .parse(await body(request));
      for (const ref of new Set(
        input.data.dimensions
          .flatMap((d) => d.evaluations.map((e) => e.image))
          .filter(Boolean),
      )) {
        if (!(await env.FILES.head(ref.slice('/api/assets/'.length))))
          throw new ApiError('模板引用的图片不存在，请重新上传');
      }
      await store.updatePaper(input.id, input.name, input.revision, {
        kind: 'paper',
        data: input.data,
      });
      return json({ ok: true });
    }
    if (path === 'admin/templates' && method === 'PUT') {
      const input = z
        .object({
          id: z.uuid(),
          name: templateNameSchema,
          revision: revisionSchema,
        })
        .strict()
        .parse(await body(request));
      await store.renameTemplate(input.id, input.name, input.revision);
      return json({ ok: true });
    }
    if (path === 'admin/templates' && method === 'DELETE') {
      const input = z
        .object({
          id: z.uuid(),
          revision: revisionSchema,
          confirmDelete: z.literal(true),
        })
        .strict()
        .parse(await body(request));
      await store.deleteTemplate(input.id, input.revision);
      return json({ ok: true });
    }
    if (
      (path === 'admin/evaluation-template' && method === 'GET') ||
      (path === 'admin/paper-evaluation-template' && method === 'POST')
    ) {
      const input =
        method === 'POST'
          ? z
              .object({ data: paperTemplateSchema, filled: z.boolean() })
              .strict()
              .parse(await body(request))
          : null;
      const bytes = await makeEvaluationWorkbook(
        input ? withPaper(state.config, input.data) : state.config,
        input ? input.filled : url.searchParams.get('filled') === '1',
      );
      return new Response(bytes as BodyInit, {
        headers: {
          ...headers,
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition':
            'attachment; filename="evaluation-template.xlsx"',
        },
      });
    }
    if (
      (path === 'admin/evaluations-preview' ||
        path === 'admin/paper-evaluations-preview') &&
      method === 'POST'
    ) {
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File) || file.size > 3_000_000)
        throw new ApiError('请选择3MB以内的评价Excel文件');
      let paperData = null;
      if (path === 'admin/paper-evaluations-preview') {
        const encoded = form.get('paper');
        if (typeof encoded !== 'string')
          throw new ApiError('缺少本套卷编辑配置', 422);
        let parsed: unknown;
        try {
          parsed = JSON.parse(encoded);
        } catch {
          throw new ApiError('本套卷编辑配置格式错误', 422);
        }
        paperData = paperTemplateSchema.parse(parsed);
      }
      if (!paperData && Number(form.get('revision')) !== state.revision)
        throw new Conflict();
      const preview = await parseEvaluations(
        file.name,
        new Uint8Array(await file.arrayBuffer()),
        paperData ? withPaper(state.config, paperData) : state.config,
      );
      return json({ ...preview, revision: state.revision });
    }
    if (path === 'admin/thresholds' && method === 'PUT') {
      closed(state);
      const input = z
        .object({
          revision: revisionSchema,
          data: thresholdTemplateSchema,
          confirmApply: z.literal(true),
        })
        .strict()
        .parse(await body(request));
      if (input.revision !== state.revision) throw new Conflict();
      await store.saveConfig(
        configSchema.parse(withThresholds(state.config, input.data)),
        input.revision,
      );
      return json({ ok: true });
    }
    if (path === 'admin/config' && method === 'PUT') {
      closed(state);
      const input = z
        .object({
          revision: revisionSchema,
          config: configSchema,
          confirmAnalysis: z.boolean().optional(),
        })
        .strict()
        .parse(await body(request));
      if (input.revision !== state.revision) throw new Conflict();
      if (
        JSON.stringify(input.config.analysis) !==
          JSON.stringify(state.config.analysis) &&
        state.count
      ) {
        if (!input.confirmAnalysis)
          throw new ApiError(
            '修改计算规则会重新计算当前成绩，请明确确认后再应用',
            409,
          );
        if (incompatibleStudents(await store.allStudents(), input.config))
          throw new ApiError(
            '新Part结构或满分与当前成绩不兼容。请保存为分析模板，在下次成绩导入时选择，当前成绩不变。',
            409,
          );
      }
      const refs = [
        input.config.headerImage,
        input.config.footerImage,
        input.config.coverBackgroundImage,
        input.config.coverQrImage,
        ...input.config.dimensions.flatMap((d) =>
          d.evaluations.map((e) => e.image),
        ),
      ].filter(Boolean);
      for (const ref of new Set(refs))
        if (!(await env.FILES.head(ref.slice('/api/assets/'.length))))
          throw new ApiError('配置引用的图片不存在，请重新上传');
      await store.saveConfig(input.config, input.revision);
      return json({ ok: true });
    }
    if (path === 'admin/template' && method === 'GET') {
      const format = url.searchParams.get('format') === 'csv' ? 'csv' : 'xlsx';
      const templateId = url.searchParams.get('analysisTemplateId');
      const paper = await resolvePaper(
        store,
        url.searchParams.get('paperTemplateId'),
        url.searchParams.get('paperRevision'),
      );
      if (paper && templateId)
        throw new ApiError('请选择一套完整试卷，不可混用分析模板');
      const template = templateId ? await store.template(templateId) : null;
      if (templateId && template?.kind !== 'analysis')
        throw new ApiError('分析模板不存在', 404);
      const bytes = await makeTemplate(
        format,
        paper
          ? paper.data.analysis
          : template?.kind === 'analysis'
            ? template.data.analysis
            : state.config.analysis,
      );
      return new Response(bytes as BodyInit, {
        headers: {
          ...headers,
          'Content-Type':
            format === 'csv'
              ? 'text/csv; charset=utf-8'
              : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="scores-template.${format}"`,
        },
      });
    }
    if (path === 'admin/import' && method === 'POST') {
      closed(state);
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File) || file.size > 3_000_000)
        throw new ApiError('请选择3MB以内的.xlsx或.csv成绩文件');
      const revision = revisionSchema.parse(Number(form.get('revision')));
      if (revision !== state.revision) throw new Conflict();
      const templateId = form.get('analysisTemplateId');
      const paper = await resolvePaper(
        store,
        form.get('paperTemplateId'),
        form.get('paperRevision'),
      );
      if (paper && templateId)
        throw new ApiError('请选择一套完整试卷，不可混用分析模板');
      const template =
        typeof templateId === 'string' && templateId
          ? await store.template(templateId)
          : null;
      if (templateId && template?.kind !== 'analysis')
        throw new ApiError('分析模板不存在', 404);
      // Atomic import activates the chosen rules only after the entire roster validates.
      const config = configSchema.parse(
        paper
          ? {
              ...withPaper(state.config, paper.data),
              paperSource: {
                id: paper.id,
                name: paper.name,
                revision: paper.revision,
              },
            }
          : template?.kind === 'analysis'
            ? withAnalysis(state.config, template.data)
            : state.config,
      );
      const flag = form.get('isDemo');
      if (flag !== 'true' && flag !== 'false')
        throw new ApiError('请标明是否为测试数据');
      const students = await parseFile(
        file.name,
        new Uint8Array(await file.arrayBuffer()),
        config.analysis,
      );
      // Recheck the paper version inside the same transaction as the roster replacement.
      await store.replace(
        students,
        revision,
        flag === 'true',
        config,
        paper ?? undefined,
        file.name,
      );
      return json({ ok: true, count: students.length, information: summarizeStudentInformation(students) });
    }
    if (path === 'admin/students/append' && method === 'POST') {
      closed(state);
      const input = z
        .object({
          revision: revisionSchema,
          batchId: z.string().min(1),
          student: z.unknown(),
        })
        .strict()
        .parse(await body(request));
      if (!state.batchId || !state.count)
        throw new ApiError('请先导入当前考试的首批成绩，再补录个别学生');
      if (input.revision !== state.revision || input.batchId !== state.batchId)
        throw new Conflict();
      if (state.count >= 2000)
        throw new ApiError('当前批次已达2000人上限，未新增学生');
      const student = parseStudentEntry(input.student, state.config.analysis);
      if (await store.hasExamNo(student.examNo)) throw new DuplicateStudent();
      await store.appendStudent(student, input.revision, input.batchId);
      return json({ ok: true });
    }
    if (path === 'admin/students/information' && method === 'PUT') {
      closed(state);
      const input = z.object({
        revision: revisionSchema,
        batchId: z.string().min(1),
        examNo: z.string().trim().min(1).max(64),
        information: studentInfoSchema,
      }).strict().parse(await body(request));
      if (input.revision !== state.revision || input.batchId !== state.batchId) throw new Conflict();
      if (!(await store.hasExamNo(input.examNo))) throw new ApiError('未找到该学生，请刷新名单', 404);
      await store.updateStudentInformation(input.examNo, {
        ...input.information, yearLevel: normalizeYearLevel(input.information.yearLevel),
      }, input.revision, input.batchId);
      return json({ ok: true });
    }
    if (path === 'admin/export-information' && method === 'POST') {
      const input = z.object({
        revision: revisionSchema,
        examNos: z.array(z.string().trim().min(1).max(64)).max(2000).default([]),
      }).strict().parse(await body(request));
      if (input.revision !== state.revision) throw new Conflict();
      const students = await store.allStudents();
      const selected = input.examNos.length
        ? students.filter((student) => input.examNos.includes(student.examNo)) : students;
      if (input.examNos.length && selected.length !== new Set(input.examNos).size)
        throw new ApiError('所选学生名单已变化，请刷新后重新选择', 409);
      if ((await store.state()).revision !== input.revision) throw new Conflict();
      return json({ count: selected.length, ...summarizeStudentInformation(selected) });
    }
    if (path === 'admin/report-batch' && method === 'POST') {
      const input = z.object({
        revision: revisionSchema,
        offset: z.number().int().min(0).max(2000),
        examNos: z.array(z.string().trim().min(1).max(64)).max(2000).default([]),
      }).strict().parse(await body(request));
      if (input.revision !== state.revision) throw new Conflict();
      const students = await store.allStudents();
      const selected = input.examNos.length
        ? students.filter((student) => input.examNos.includes(student.examNo))
        : students;
      if (input.examNos.length && selected.length !== new Set(input.examNos).size)
        throw new ApiError('所选学生名单已变化，请刷新后重新选择', 409);
      const records = selected.slice(input.offset, input.offset + 10).map((s) => ({
        examNo: s.examNo,
        result: resultFor(s, state.config, state.isDemoData),
      }));
      if ((await store.state()).revision !== input.revision) throw new Conflict();
      return json({ count: selected.length, records });
    }
    if (path === 'admin/dimension-coefficient-batch' && method === 'POST') {
      const input = z.object({
        revision: revisionSchema,
        offset: z.number().int().min(0).max(2000),
        examNos: z.array(z.string().trim().min(1).max(64)).max(2000).default([]),
      }).strict().parse(await body(request));
      if (input.revision !== state.revision) throw new Conflict();
      const students = await store.allStudents();
      const selected = input.examNos.length
        ? students.filter((student) => input.examNos.includes(student.examNo))
        : students;
      if (input.examNos.length && selected.length !== new Set(input.examNos).size)
        throw new ApiError('所选学生名单已变化，请刷新后重新选择', 409);
      const records = selected.slice(input.offset, input.offset + 100).map((student) => ({
        examNo: student.examNo,
        name: student.name,
        branch: student.branch,
        className: student.className,
        examSession: student.examSession,
        yearLevel: student.yearLevel,
        sourceData: student.sourceData,
        scores: student.scores,
        total: student.total,
        qualifiedForInterview:
          resultFor(student, state.config, state.isDemoData).admission
            ?.qualifiedForInterview ?? null,
      }));
      if ((await store.state()).revision !== input.revision) throw new Conflict();
      return json({
        count: selected.length,
        examName: state.config.examName,
        sourceFileName: state.sourceFileName ?? null,
        analysis: state.config.analysis,
        records,
      });
    }
    if (path === 'admin/admission-summary' && method === 'GET') {
      const students = await store.allStudents();
      if (!state.config.admission.enabled)
        return json({ enabled: false, total: students.length, interviewCount: 0, interviewStudents: [] });
      const interviewStudents = students.filter(
        (student) =>
          resultFor(student, state.config, state.isDemoData).admission
            ?.qualifiedForInterview,
      ).map(({ examNo, name, branch }) => ({ examNo, name, branch }));
      return json({
        enabled: true,
        total: students.length,
        interviewCount: interviewStudents.length,
        interviewStudents,
      });
    }
    if (path === 'admin/students' && method === 'GET') {
      const requestedPage = z.coerce
        .number()
        .int()
        .min(1)
        .max(10000)
        .parse(url.searchParams.get('page') ?? 1);
      const pageSize = z.coerce
        .number()
        .int()
        .min(10)
        .max(url.searchParams.get('all') === 'true' ? 2000 : 50)
        .parse(url.searchParams.get('pageSize') ?? 10);
      const page = Math.min(
        requestedPage,
        Math.max(1, Math.ceil(state.count / pageSize)),
      );
      return json({
        students: await store.list(page, pageSize),
        count: state.count,
        page,
        pageSize,
      });
    }
    if (path === 'admin/preview' && method === 'POST') {
      const raw = z.object({ name: z.unknown().optional(), examNo: z.unknown().optional() }).strict().parse(await body(request));
      const input = adminPreviewSchema.parse({
        name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : undefined,
        examNo: typeof raw.examNo === 'string' && raw.examNo.trim() ? raw.examNo : undefined,
      });
      const allStudents = await store.allStudents();
      const matches = allStudents.filter(
        (student) =>
          (!input.name || student.name === input.name) &&
          (!input.examNo || student.examNo === input.examNo),
      );
      if (!matches.length) return json({ error: state.config.failedMessage }, 404);
      if (matches.length > 1)
        throw new ApiError(`找到${matches.length}名同名学生，请补充考号后预览`, 409);
      const matched = matches[0];
      return json({
        ...resultFor(matched, state.config, state.isDemoData),
        adminMatch: {
          examNo: matched.examNo,
          listIndex: allStudents.findIndex((student) => student.examNo === matched.examNo),
        },
      });
    }
    if (path === 'admin/publish' && method === 'POST') {
      const input = z
        .object({
          revision: revisionSchema,
          mode: z.enum(['closed', 'demo', 'formal']),
        })
        .strict()
        .parse(await body(request));
      if (input.revision !== state.revision) throw new Conflict();
      if (input.mode !== 'closed' && !state.count)
        throw new ApiError('请先导入成绩');
      if (input.mode === 'demo' && !demo)
        throw new ApiError('当前环境不允许演示发布', 403);
      if (input.mode === 'formal') {
        if (env.ALLOW_FORMAL_PUBLISH !== 'true')
          throw new ApiError(
            '本地基础版未开放正式发布；需完成线上环境和安全验收',
            403,
          );
        const missing = readiness(state);
        if (missing.length)
          return json({ error: '尚不具备正式发布条件', issues: missing }, 409);
      }
      await store.publish(input.mode, input.revision);
      return json({ ok: true });
    }
    if (
      (path === 'admin/assets' || path === 'admin/paper-assets') &&
      method === 'POST'
    ) {
      if (path === 'admin/assets') closed(state);
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File) || file.size > 2_000_000)
        throw new ApiError('请上传2MB以内的PNG、JPEG或WebP图片');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const type = validImage(bytes);
      if (!type)
        throw new ApiError('仅接受PNG、JPEG、WebP图片，不支持SVG或可执行内容');
      const key = `${crypto.randomUUID()}.${type.ext}`;
      await env.FILES.put(key, bytes, {
        httpMetadata: { contentType: type.type },
      });
      return json({ url: `/api/assets/${key}` });
    }
    return json({ error: '接口不存在或请求方法不支持' }, 404);
  } catch (error) {
    if (error instanceof ImportError)
      return json({ error: error.message, issues: error.issues }, 422);
    if (error instanceof z.ZodError)
      return json(
        {
          error: '配置或输入格式不正确',
          issues: error.issues.map((i) => i.message),
        },
        422,
      );
    if (
      error instanceof Conflict ||
      error instanceof TemplateNameConflict ||
      error instanceof DuplicateStudent
    )
      return json({ error: error.message }, 409);
    if (error instanceof ApiError)
      return json({ error: error.message }, error.status);
    console.error(
      'Exam API internal failure',
      error instanceof Error ? error.name : 'unknown',
    );
    return json({ error: '服务暂时不可用，请稍后重试' }, 500);
  }
}
