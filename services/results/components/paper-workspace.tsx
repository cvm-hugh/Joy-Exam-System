'use client';
import { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
  Download,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { api, RequestError } from '@/lib/client';
import { GRADES, fullMark, continuousRules, type Config } from '@/lib/domain';
import {
  paperFrom,
  paperTemplateSchema,
  templateNameSchema,
  type PaperTemplate,
  type SavedTemplate,
} from '@/lib/templates';
import type { EvaluationImport } from '@/lib/evaluation-importer';
import {
  makePaperTemplateFile,
  paperImageRefs,
  parsePaperTemplateFile,
  replacePaperImageRefs,
} from '@/lib/paper-template-file';
import { TemplateSelect } from './template-library';
import { ThresholdEditor } from './threshold-editor';
import { useConfirm } from './confirm-action';

type Section = 'overview' | 'structure' | 'thresholds' | 'evaluations' | 'release';
const sections: { id: Section; label: string; detail: string }[] = [
  { id: 'overview', label: '套卷总览', detail: '一套配齐，统一保存' },
  { id: 'structure', label: '题型与满分', detail: 'Part、满分、评价维度' },
  { id: 'thresholds', label: '系数阈值', detail: '按完整原始系数划分等级' },
  { id: 'evaluations', label: '评价管理', detail: '24套评语与评价图片' },
  { id: 'release', label: '结果发布', detail: '口试线与资格文案' },
];

export function PaperWorkspace({
  config,
  templates,
  reload,
  onDirtyChange,
  onBusyChange,
  onApply,
  applyDisabled = false,
}: {
  config: Config;
  templates: SavedTemplate[];
  reload: () => Promise<void>;
  onDirtyChange: (v: boolean) => void;
  onBusyChange?: (v: boolean) => void;
  onApply?: (paper: Extract<SavedTemplate, { kind: 'paper' }>) => Promise<boolean>;
  applyDisabled?: boolean;
}) {
  const confirm = useConfirm();
  const [selected, setSelected] = useState('');
  const [loaded, setLoaded] = useState<Extract<
    SavedTemplate,
    { kind: 'paper' }
  > | null>(null);
  const [draft, setDraft] = useState<PaperTemplate | null>(null);
  const [name, setName] = useState('');
  const [copyName, setCopyName] = useState('');
  const [copying, setCopying] = useState(false);
  const [section, setSection] = useState<Section>('overview');
  const [editing, setEditing] = useState(false);
  const [dimension, setDimension] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [admissionSummary, setAdmissionSummary] = useState<{
    enabled: boolean;
    total: number;
    interviewCount: number;
    interviewStudents: { examNo: string; name: string; branch: string }[];
  } | null>(null);
  const [importing, setImporting] = useState(false);
  const [importedFile, setImportedFile] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<EvaluationImport | null>(null);
  const [defaultInitialized, setDefaultInitialized] = useState(false);
  const paperFileInput = useRef<HTMLInputElement>(null);
  if (!defaultInitialized && !busy) {
    if (selected || draft) {
      setDefaultInitialized(true);
    } else {
      const preferred = templates.find(
        (t) =>
          t.kind === 'paper' &&
          ['学业水平统测｜英语2608', '学业水平统测｜2608'].includes(t.name),
      );
      // Templates arrive asynchronously. Initialize once, without replacing later edits.
      if (preferred?.kind === 'paper') {
        setDefaultInitialized(true);
        setSelected(preferred.id);
        setLoaded(preferred);
        setDraft(structuredClone(preferred.data));
        setName(preferred.name);
      }
    }
  }
  const dirty =
    !!draft &&
    (!loaded ||
      name !== loaded.name ||
      JSON.stringify(draft) !== JSON.stringify(loaded.data));
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (section !== 'release') return;
    let active = true;
    api<{
      enabled: boolean;
      total: number;
      interviewCount: number;
      interviewStudents: { examNo: string; name: string; branch: string }[];
    }>('admission-summary')
      .then((summary) => {
        if (active) setAdmissionSummary(summary);
      })
      .catch(() => {
        if (active) setAdmissionSummary(null);
      });
    return () => {
      active = false;
    };
  }, [section, config]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  const papers = templates.filter((t) => t.kind === 'paper');
  const chosen = papers.find((t) => t.id === selected);
  const valid = draft ? paperTemplateSchema.safeParse(draft) : null;
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作未完成，请重试');
    } finally {
      setBusy(false);
    }
  }
  function edit(fn: (d: PaperTemplate) => void) {
    if (!draft || busy) return;
    const next = structuredClone(draft);
    fn(next);
    setDraft(next);
    setPreview(null);
    setNotice('');
    setError('');
  }
  async function mayReplace() {
    return (
      !dirty ||
      (await confirm(
        '本套卷有未保存修改。继续将放弃这些修改，已保存模板和学生数据不变。',
      ))
    );
  }
  function enter(data: PaperTemplate, source: typeof loaded, title: string) {
    setDefaultInitialized(true);
    setDraft(structuredClone(data));
    setLoaded(source);
    setName(title);
    setSection('overview');
    setEditing(false);
    setCopying(false);
    setPreview(null);
    setFile(null);
    setImporting(false);
    setImportedFile(false);
    setError('');
    setNotice('');
  }
  async function selectPaper(id: string) {
    if (busy) return;
    const next = papers.find((t) => t.id === id);
    if (id && !next) return;
    setDefaultInitialized(true);
    if (id === selected && loaded && next?.revision === loaded.revision) return;
    await run(async () => {
      if (!(await mayReplace())) return;
      // Commit the selection together with the draft, so cancelling keeps both unchanged.
      setSelected(id);
      if (next) enter(next.data, next, next.name);
      else {
        setDraft(null);
        setLoaded(null);
        setImportedFile(false);
        setEditing(false);
        setPreview(null);
        setFile(null);
        setImporting(false);
      }
    });
  }
  async function save(asCopy = false) {
    if (!draft) return;
    const title = templateNameSchema.parse(asCopy ? copyName : name);
    const data = paperTemplateSchema.parse(draft);
    const applyAfterSave = importedFile && !asCopy && !!onApply;
    let id = loaded?.id ?? '';
    let revision = (loaded?.revision ?? -1) + 1;
    if (loaded && !asCopy) {
      if (
        !(await confirm(
          onApply
            ? `保存“${title}”的默认版本？本套卷的全部配套内容一起保存；保存后可点击“用于当前考试”应用，当前学生结果不会自动改动。`
            : `保存“${title}”的默认版本？本套卷的全部配套内容一起保存，供后续导入使用；当前已导入学生结果不变。保存模板后，需重新导入学生成绩才可生效。`,
        ))
      )
        return;
      await api('papers', 'PUT', {
        id,
        name: title,
        revision: loaded.revision,
        data,
      });
    } else {
      const result = await api<{ id: string }>('templates', 'POST', {
        name: title,
        payload: { kind: 'paper', data },
      });
      id = result.id;
      revision = 0;
    }
    const saved: Extract<SavedTemplate, { kind: 'paper' }> = {
      id,
      name: title,
      revision,
      updatedAt: new Date().toISOString(),
      kind: 'paper',
      data,
    };
    setLoaded(saved);
    setDraft(structuredClone(data));
    setSelected(id);
    setName(title);
    setCopyName('');
    setCopying(false);
    setEditing(false);
    setPreview(null);
    setImporting(false);
    setNotice(
      onApply
        ? '已保存为这套试卷的默认版本。可点击“用于当前考试”更新资格和评价；当前学生结果未改动。'
        : '已保存为这套试卷的默认版本。保存模板后，需重新导入学生成绩才可生效；当前学生结果未改动。',
    );
    await reload();
    if (applyAfterSave && onApply) {
      setImportedFile(false);
      const applied = await onApply(saved);
      setNotice(applied
        ? '导入的套卷已保存并用于当前考试，资格结果默认显示。'
        : '套卷已保存；尚未用于当前考试，可点击“用于当前考试”继续。');
    }
  }
  async function download(filled: boolean) {
    if (!draft) return;
    const response = await fetch('/api/admin/paper-evaluation-template', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'x-exam-request': '1' },
      body: JSON.stringify({ data: paperTemplateSchema.parse(draft), filled }),
    });
    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      throw new RequestError(data.error ?? '下载失败', response.status);
    }
    const url = URL.createObjectURL(await response.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = filled ? '本套卷评价内容.xlsx' : '评价导入模板.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function blobAsBase64(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('读取评价图片失败'));
      reader.onload = () => {
        const value = typeof reader.result === 'string' ? reader.result : '';
        resolve(value.slice(value.indexOf(',') + 1));
      };
      reader.readAsDataURL(blob);
    });
  }
  async function exportPaperFile() {
    if (!draft) return;
    const title = templateNameSchema.parse(name);
    const paper = paperTemplateSchema.parse(draft);
    const assets = [];
    for (const source of paperImageRefs(paper)) {
      const response = await fetch(source, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`无法读取套卷中的评价图片：${source}`);
      const blob = await response.blob();
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type))
        throw new Error('套卷中包含不支持的评价图片格式');
      assets.push({
        source,
        mediaType: blob.type as 'image/png' | 'image/jpeg' | 'image/webp',
        base64: await blobAsBase64(blob),
      });
    }
    const bundle = makePaperTemplateFile(title, paper, assets);
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(bundle)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[\\/:*?"<>|]/g, '_')}.试卷模板.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('整套试卷模板已导出，可在其他电脑的本系统中导入。');
  }
  async function importPaperFile(importFile: File) {
    if (!(await mayReplace())) return;
    if (importFile.size > 70_000_000)
      throw new Error('套卷文件过大，请确认文件来自本系统且未被修改');
    const bundle = parsePaperTemplateFile(await importFile.text());
    const replacements = new Map<string, string>();
    for (const asset of bundle.assets) {
      const bytes = Uint8Array.from(atob(asset.base64), (char) =>
        char.charCodeAt(0),
      );
      const form = new FormData();
      form.set(
        'file',
        new File([bytes], '评价图片', { type: asset.mediaType }),
      );
      const { url } = await api<{ url: string }>('paper-assets', 'POST', form);
      replacements.set(asset.source, url);
    }
    enter(replacePaperImageRefs(bundle.paper, replacements), null, bundle.name);
    setSelected('');
    setEditing(true);
    setImportedFile(true);
    setNotice(
      `已导入“${bundle.name}”并打开为可编辑副本。资格结果默认显示；确认内容后点击“保存并用于当前考试”，会使用本套卷的分数线和评价，不覆盖已有模板。`,
    );
  }
  return (
    <div className="paper-workspace">
      <section className="panel paper-library">
        <div className="panel-title">
          <div>
            <p className="eyebrow">TEACHING SUPPORT</p>
            <h2>试卷模板库</h2>
          </div>
          <span className="pill">{papers.length} 套配套试卷</span>
        </div>
        <p className="muted">
          教学支撑先配好一整套卷，行政服务再选卷导入。保存后成为本套卷的默认版本，不自动改动当前考试。
        </p>
        <div className="paper-picker paper-picker-auto">
          <TemplateSelect
            templates={papers}
            value={selected}
            disabled={busy}
            onChange={(id) => void selectPaper(id)}
            label="选择一套试卷"
            empty="请选择配套试卷"
          />
        </div>
        <p className="mini-label">
          选择后自动载入；如有未保存修改，会先提醒确认。
        </p>
        <div className="paper-library-actions">
          <input
            ref={paperFileInput}
            hidden
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const importFile = event.target.files?.[0];
              event.target.value = '';
              if (importFile) void run(() => importPaperFile(importFile));
            }}
          />
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => paperFileInput.current?.click()}
          >
            <Upload />
            导入套卷文件
          </Button>
          <Button
            variant="outline"
            disabled={busy || !draft}
            onClick={() => void run(exportPaperFile)}
          >
            <Download />
            导出套卷文件
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void run(reload)}
          >
            刷新模板列表
          </Button>
          <Button
            variant="outline"
            disabled={busy || !loaded}
            onClick={() =>
              void run(async () => {
                if (loaded && (await mayReplace())) {
                  enter(
                    loaded.data,
                    null,
                    `${loaded.name.slice(0, 75)} · 副本`,
                  );
                  setSelected('');
                  setEditing(true);
                  setNotice(
                    `已从“${loaded.name}”的已保存版本复制新建。修改名称与内容后保存，原模板不变。`,
                  );
                }
              })
            }
          >
            <Plus />
            从当前试卷模板复制新建
          </Button>
          {chosen && (
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (
                    !(await confirm(
                      `删除试卷模板“${chosen.name}”？仅删除这份模板；当前考试、学生结果和旧版组件模板均保留。${loaded?.id === chosen.id && dirty ? '本套卷未保存的编辑也将关闭。' : ''}`,
                    ))
                  )
                    return;
                  await api('templates', 'DELETE', {
                    id: chosen.id,
                    revision: chosen.revision,
                    confirmDelete: true,
                  });
                  if (loaded?.id === chosen.id) {
                    setDraft(null);
                    setLoaded(null);
                    setEditing(false);
                  }
                  setSelected('');
                  await reload();
                  setNotice('已删除选中的试卷模板，当前学生结果不变。');
                })
              }
            >
              <Trash2 />
              删除选中套卷
            </Button>
          )}
        </div>
        {!papers.length && (
          <div className="paper-empty">
            <p>
              还没有保存过试卷模板，可先用当前考试配置建立首套模板。已有学生结果不变。
            </p>
            <Button
              className="template-primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (await mayReplace()) {
                    enter(paperFrom(config), null, '');
                    setSelected('');
                    setEditing(true);
                  }
                })
              }
            >
              建立首套试卷模板
            </Button>
          </div>
        )}
      </section>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {notice && <output className="success">{notice}</output>}
      {draft && (
        <>
          <section className="paper-context">
            <div>
              <span className="mini-label">
                当前教学套卷 ·{' '}
                {loaded ? `已保存版本 ${loaded.revision + 1}` : '尚未保存'}
              </span>
              <h2>
                <BookOpen />
                {name || '未命名试卷'}
              </h2>
              <p>卷内内容统一保存，供后续考试调用。</p>
            </div>
            <div className="actions">
              <span className={dirty ? 'pill paper-unsaved' : 'pill'}>
                {dirty ? '有未保存修改' : '已保存'}
              </span>
              <Button
                className="template-primary"
                disabled={busy || !dirty || !name.trim() || !valid?.success || (importedFile && !!onApply && applyDisabled)}
                onClick={() => void run(() => save())}
              >
                <Save />
                {importedFile && onApply ? '保存并用于当前考试' : '保存本套卷'}
              </Button>
              {onApply && loaded && (
                <Button
                  variant="outline"
                  disabled={busy || dirty || applyDisabled}
                  onClick={() => void run(async () => {
                    if (await onApply(loaded))
                      setNotice('本套卷已用于当前考试，资格结果默认显示。');
                  })}
                >
                  用于当前考试
                </Button>
              )}
              {onApply && applyDisabled && (
                <span className="mini-label">请先关闭查询并保存当前页面或学生信息，再应用套卷。</span>
              )}
            </div>
          </section>
          <nav className="paper-sections" aria-label="本套卷教学配置">
            {sections.map((s) => (
              <Button
                key={s.id}
                variant={section === s.id ? 'default' : 'outline'}
                aria-current={section === s.id ? 'page' : undefined}
                disabled={busy}
                onClick={() => {
                  setSection(s.id);
                  setEditing(false);
                  setImporting(false);
                  setPreview(null);
                  setFile(null);
                  setError('');
                }}
              >
                <span>
                  {s.label}
                  <small>{s.detail}</small>
                </span>
              </Button>
            ))}
          </nav>
          <section className="panel">
            <div className="panel-title">
              <h2>{sections.find((s) => s.id === section)?.label}</h2>
              <Button
                variant={editing ? 'outline' : 'default'}
                disabled={busy}
                onClick={() => setEditing(!editing)}
              >
                {editing ? <X /> : <Pencil />}
                {editing
                  ? '收起编辑'
                  : section === 'overview'
                    ? '编辑名称 / 另存套卷'
                    : '进入编辑'}
              </Button>
            </div>
            {!editing && section !== 'overview' && (
              <p className="muted">
                当前为查看状态。点击“进入编辑”再修改，保存时整套卷一起保存。
              </p>
            )}
            {section === 'overview' && (
              <>
                {editing && (
                  <div className="stack">
                    <label htmlFor="paper-name">
                      本套卷名称
                      <Input
                        id="paper-name"
                        value={name}
                        maxLength={80}
                        disabled={busy}
                        placeholder="例如：英语学业水平测试 · 七年级"
                        onChange={(e) => setName(e.target.value)}
                      />
                    </label>
                    {loaded && (
                      <>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => setCopying(!copying)}
                        >
                          另存为另一套试卷
                        </Button>
                        {copying && (
                          <div className="template-inline-form">
                            <label htmlFor="paper-copy-name">
                              新套卷名称
                              <Input
                                id="paper-copy-name"
                                value={copyName}
                                maxLength={80}
                                disabled={busy}
                                onChange={(e) => setCopyName(e.target.value)}
                              />
                            </label>
                            <Button
                              disabled={
                                busy || !copyName.trim() || !valid?.success
                              }
                              onClick={() => void run(() => save(true))}
                            >
                              <Save />
                              另存套卷
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
                <div className="paper-summary">
                  <div>
                    <small>题型结构</small>
                    <strong>{draft.analysis.parts.length} 个 Part</strong>
                    <span>总分上限 {fullMark(draft.analysis)} 分</span>
                  </div>
                  <div>
                    <small>评价维度</small>
                    <strong>6 个维度</strong>
                    <span>
                      {draft.analysis.dimensions.map((d) => d.name).join('、')}
                    </span>
                  </div>
                  <div>
                    <small>等级设置</small>
                    <strong>4 级独立分档</strong>
                    <span>按完整原始系数判断</span>
                  </div>
                  <div>
                    <small>配套评价</small>
                    <strong>24 套 · 72 段</strong>
                    <span>
                      {draft.contentConfirmed
                        ? '已核对正式内容'
                        : '待核对正式内容'}
                    </span>
                  </div>
                </div>
                <p className="mini-label">
                  “保存本套卷”更新默认版本；“另存套卷”保留原卷并建立独立副本。已有考试使用导入时的配套配置，不受后续模板编辑或删除影响。
                </p>
                {valid && !valid.success && (
                  <div className="error" role="alert">
                    {[
                      ...new Set(valid.error.issues.map((i) => i.message)),
                    ].join('；')}
                  </div>
                )}
              </>
            )}
            {section === 'structure' && (
              <>
                {editing && (
                  <LegacySource
                    kind="analysis"
                    templates={templates}
                    reload={reload}
                    busy={busy}
                    run={run}
                    onLoad={(t) => {
                      if (t.kind === 'analysis')
                        edit((d) => {
                          d.analysis = structuredClone(t.data.analysis);
                          d.contentConfirmed = false;
                        });
                    }}
                  />
                )}
                <p className="mini-label">
                  题型结构与满分只在这里维护。一个 Part
                  可以参与多个维度计算，总分不重复累加。
                </p>
                {editing ? (
                  <>
                    <div className="actions">
                      <Button
                        variant="outline"
                        disabled={busy || draft.analysis.parts.length >= 60}
                        onClick={() =>
                          edit((d) => {
                            let n = 1;
                            while (
                              d.analysis.parts.some((p) => p.id === `P${n}`)
                            )
                              n++;
                            d.analysis.parts.push({
                              id: `P${n}`,
                              label: `新增Part${n}`,
                              max: 5,
                            });
                          })
                        }
                      >
                        <Plus />
                        添加Part
                      </Button>
                    </div>
                    <div className="part-editor">
                      {draft.analysis.parts.map((p, i) => (
                        <div className="part-row" key={p.id}>
                          <span className="mini-label">{p.id}</span>
                          <label htmlFor={`paper-part-label-${p.id}`}>
                            Part名称
                            <Input
                              id={`paper-part-label-${p.id}`}
                              value={p.label}
                              maxLength={160}
                              disabled={busy}
                              onChange={(e) =>
                                edit((d) => {
                                  d.analysis.parts[i].label = e.target.value;
                                })
                              }
                            />
                          </label>
                          <label htmlFor={`paper-part-max-${p.id}`}>
                            满分上限
                            <Input
                              id={`paper-part-max-${p.id}`}
                              type="number"
                              value={p.max}
                              min={0.0001}
                              max={10000}
                              step="any"
                              disabled={busy}
                              onChange={(e) =>
                                edit((d) => {
                                  d.analysis.parts[i].max = Number(
                                    e.target.value,
                                  );
                                })
                              }
                            />
                          </label>
                          <Button
                            variant="destructive"
                            disabled={busy || draft.analysis.parts.length <= 1}
                            onClick={() =>
                              void run(async () => {
                                if (
                                  await confirm(
                                    `从本套卷移除“${p.label}”及其维度关联？学生数据不变。`,
                                  )
                                ) {
                                  const next = structuredClone(draft);
                                  next.analysis.parts.splice(i, 1);
                                  next.analysis.dimensions.forEach((dim) => {
                                    dim.parts = dim.parts.filter(
                                      (id) => id !== p.id,
                                    );
                                  });
                                  setDraft(next);
                                }
                              })
                            }
                          >
                            移除
                          </Button>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="paper-parts">
                    {draft.analysis.parts.map((p) => (
                      <span key={p.id}>
                        {p.label}
                        <b>{p.max} 分</b>
                      </span>
                    ))}
                  </div>
                )}
                <h3 className="paper-subheading">评价维度与题型关联</h3>
                <div className="analysis-dimensions">
                  {draft.analysis.dimensions.map((d, i) => (
                    <div className="analysis-dimension" key={d.id}>
                      {editing ? (
                        <>
                          <label>
                            维度 {i + 1} 名称
                            <Input
                              value={d.name}
                              maxLength={160}
                              disabled={busy}
                              onChange={(e) =>
                                edit((n) => {
                                  n.analysis.dimensions[i].name =
                                    e.target.value;
                                  n.contentConfirmed = false;
                                })
                              }
                            />
                          </label>
                          <div className="part-choices">
                            {draft.analysis.parts.map((p) => (
                              <label className="check-row" key={p.id}>
                                <Checkbox
                                  checked={d.parts.includes(p.id)}
                                  disabled={busy}
                                  onCheckedChange={(v) =>
                                    edit((n) => {
                                      n.analysis.dimensions[i].parts =
                                        v === true
                                          ? [...d.parts, p.id]
                                          : d.parts.filter((id) => id !== p.id);
                                    })
                                  }
                                />
                                <span>
                                  {p.label} · {p.max}分
                                </span>
                              </label>
                            ))}
                          </div>
                        </>
                      ) : (
                        <>
                          <h3>
                            {i + 1}. {d.name}
                          </h3>
                          <p className="muted">
                            {d.parts
                              .map(
                                (id) =>
                                  draft.analysis.parts.find((p) => p.id === id)
                                    ?.label,
                              )
                              .join(' + ')}
                          </p>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
            {section === 'thresholds' && (
              <>
                <p className="muted">
                  等级按完整原始系数判断；页面系数直接截断至小数点后1位展示。下限包含，最高上限1包含，其余上限不包含。
                </p>
                {editing && (
                  <>
                    <LegacySource
                      kind="thresholds"
                      templates={templates}
                      reload={reload}
                      busy={busy}
                      run={run}
                      onLoad={(t) => {
                        if (t.kind === 'thresholds')
                          edit((d) => {
                            d.dimensions.forEach((dim, i) => {
                              dim.rules = structuredClone(
                                t.data.dimensions[i].rules,
                              );
                            });
                          });
                      }}
                    />
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        edit((d) => {
                          d.dimensions.forEach((dim) => {
                            dim.rules = continuousRules();
                          });
                        })
                      }
                    >
                      六维统一采用 0.8 / 0.6 / 0.4 分档
                    </Button>
                  </>
                )}
                {draft.dimensions.map((d, i) => (
                  <div className="paper-rule" key={d.id}>
                    <h3>{draft.analysis.dimensions[i].name}</h3>
                    {editing ? (
                      <ThresholdEditor
                        rules={d.rules}
                        idPrefix={`paper-${i}`}
                        disabled={busy}
                        onChange={(rules) =>
                          edit((n) => {
                            n.dimensions[i].rules = rules;
                          })
                        }
                      />
                    ) : (
                      <div className="paper-rule-summary">
                        {d.rules.map((r, j) => (
                          <span key={j}>
                            <b>{GRADES[j]}</b>
                            {r.min.toFixed(1)} ≤ 系数 {r.includeMax ? '≤' : '<'}{' '}
                            {r.max.toFixed(1)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
            {section === 'evaluations' && (
              <>
                <p className="muted">
                  本套卷的六维评语、三段标题和评价图片在这里管理。保留逐维编辑，也可通过
                  Excel 一次导入24套评价。
                </p>
                {editing && (
                  <>
                    <LegacySource
                      kind="evaluation"
                      templates={templates}
                      reload={reload}
                      busy={busy}
                      run={run}
                      onLoad={(t) => {
                        if (t.kind === 'evaluation')
                          edit((d) => {
                            d.paragraphTitles = structuredClone(
                              t.data.paragraphTitles,
                            );
                            d.dimensions.forEach((dim, i) => {
                              dim.evaluations = structuredClone(
                                t.data.dimensions[i].evaluations,
                              );
                            });
                            d.contentConfirmed = false;
                          });
                      }}
                    />
                    <div className="actions">
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => setImporting(!importing)}
                      >
                        <Upload />
                        Excel批量导入评价
                      </Button>
                    </div>
                    {importing && (
                      <div className="paper-import stack">
                        <div className="actions">
                          <Button
                            variant="outline"
                            disabled={busy || !valid?.success}
                            onClick={() => void run(() => download(false))}
                          >
                            <Download />
                            下载空白上传模板
                          </Button>
                          <Button
                            variant="outline"
                            disabled={busy || !valid?.success}
                            onClick={() => void run(() => download(true))}
                          >
                            导出本套卷评价
                          </Button>
                        </div>
                        <label>
                          选择评价Excel
                          <input
                            type="file"
                            className="file-input"
                            accept=".xlsx"
                            disabled={busy}
                            onChange={(e) => {
                              setFile(e.target.files?.[0] ?? null);
                              setPreview(null);
                            }}
                          />
                        </label>
                        <Button
                          disabled={busy || !file || !valid?.success}
                          onClick={() =>
                            void run(async () => {
                              const form = new FormData();
                              form.set('file', file!);
                              form.set('paper', JSON.stringify(draft));
                              setPreview(
                                await api<EvaluationImport>(
                                  'paper-evaluations-preview',
                                  'POST',
                                  form,
                                ),
                              );
                            })
                          }
                        >
                          校验评价文件
                        </Button>
                        {preview && (
                          <>
                            <p className="success">
                              已校验 {preview.rows.length}{' '}
                              套评价，尚未覆盖编辑内容。
                            </p>
                            {preview.warnings.map((w) => (
                              <p className="mini-label" key={w}>
                                {w}
                              </p>
                            ))}
                            <div className="paper-import-preview">
                              {preview.rows.map((row, i) => (
                                <details key={i}>
                                  <summary>
                                    {row.dimension} · {row.grade}
                                  </summary>
                                  {row.paragraphs.map((p, j) => (
                                    <p key={j}>{p}</p>
                                  ))}
                                </details>
                              ))}
                            </div>
                            <Button
                              onClick={() =>
                                void run(async () => {
                                  if (
                                    !(await confirm(
                                      '将校验通过的24套评价载入本套卷编辑区？当前学生结果不变，载入后请点击“保存本套卷”。',
                                    ))
                                  )
                                    return;
                                  const next = structuredClone(draft);
                                  next.paragraphTitles =
                                    preview.data.paragraphTitles;
                                  next.dimensions.forEach((d, i) => {
                                    d.evaluations =
                                      preview.data.dimensions[i].evaluations;
                                  });
                                  next.contentConfirmed = false;
                                  setDraft(next);
                                  setPreview(null);
                                  setImporting(false);
                                  setNotice(
                                    '评价已载入本套卷，请核对后点击“保存本套卷”。',
                                  );
                                })
                              }
                            >
                              载入本套卷评价
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                    <div className="form-grid paper-subheading">
                      {draft.paragraphTitles.map((title, i) => (
                        <label key={i}>
                          第{i + 1}段标题
                          <Input
                            value={title}
                            maxLength={40}
                            disabled={busy}
                            onChange={(e) =>
                              edit((d) => {
                                d.paragraphTitles[i] = e.target.value;
                                d.contentConfirmed = false;
                              })
                            }
                          />
                        </label>
                      ))}
                    </div>
                  </>
                )}
                <div className="dimension-tabs">
                  {draft.analysis.dimensions.map((d, i) => (
                    <Button
                      key={d.id}
                      variant={dimension === i ? 'default' : 'outline'}
                      disabled={busy}
                      onClick={() => setDimension(i)}
                    >
                      {d.name}
                    </Button>
                  ))}
                </div>
                {draft.dimensions[dimension].evaluations.map((ev, i) => (
                  <article
                    className="paper-evaluation"
                    key={`${dimension}-${i}`}
                  >
                    <div className="panel-title">
                      <h3>
                        {draft.analysis.dimensions[dimension].name} ·{' '}
                        {GRADES[i]}
                      </h3>
                      <span className="pill">
                        {ev.placeholder ? '测试占位' : '已填内容'}
                      </span>
                    </div>
                    {editing ? (
                      <div className="stack">
                        <label
                          htmlFor={`paper-evaluation-title-${dimension}-${i}`}
                        >
                          评价标题
                          <Input
                            id={`paper-evaluation-title-${dimension}-${i}`}
                            value={ev.title}
                            disabled={busy}
                            onChange={(e) =>
                              edit((d) => {
                                d.dimensions[dimension].evaluations[i].title =
                                  e.target.value;
                                d.contentConfirmed = false;
                              })
                            }
                          />
                        </label>
                        <div className="evaluation-edit">
                          {ev.paragraphs.map((p, j) => (
                            <label key={j}>
                              {draft.paragraphTitles[j]}
                              <Textarea
                                value={p}
                                maxLength={2000}
                                disabled={busy}
                                onChange={(e) =>
                                  edit((d) => {
                                    d.dimensions[dimension].evaluations[
                                      i
                                    ].paragraphs[j] = e.target.value;
                                    d.contentConfirmed = false;
                                  })
                                }
                              />
                            </label>
                          ))}
                        </div>
                        <label
                          className="check-row"
                          htmlFor={`paper-placeholder-${dimension}-${i}`}
                        >
                          <Checkbox
                            id={`paper-placeholder-${dimension}-${i}`}
                            checked={ev.placeholder}
                            disabled={busy}
                            onCheckedChange={(v) =>
                              edit((d) => {
                                d.dimensions[dimension].evaluations[
                                  i
                                ].placeholder = v === true;
                                d.contentConfirmed = false;
                              })
                            }
                          />
                          这是测试占位内容（正式内容填写后取消）
                        </label>
                        <label>
                          评价图片（可选，PNG / JPG / WebP，最大2MB）
                          <span className="image-size-guide">
                            标准尺寸：750 × 1000
                            像素（建议）；等比完整显示，可按内容调整高度。
                          </span>
                          <input
                            className="file-input"
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            disabled={busy}
                            onChange={(e) => {
                              const imageFile = e.target.files?.[0];
                              if (imageFile)
                                void run(async () => {
                                  const form = new FormData();
                                  form.set('file', imageFile);
                                  const { url } = await api<{ url: string }>(
                                    'paper-assets',
                                    'POST',
                                    form,
                                  );
                                  const next = structuredClone(draft);
                                  next.dimensions[dimension].evaluations[
                                    i
                                  ].image = url;
                                  next.contentConfirmed = false;
                                  setDraft(next);
                                });
                            }}
                          />
                        </label>
                      </div>
                    ) : (
                      <>
                        <h4>{ev.title}</h4>
                        <div className="evaluation-edit">
                          {ev.paragraphs.map((p, j) => (
                            <div key={j}>
                              <small>{draft.paragraphTitles[j]}</small>
                              <p className="paper-paragraph">
                                {p || '尚未填写'}
                              </p>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    {ev.image && (
                      <div>
                        {/* Protected assets need the administrator's browser cookie, not an image optimizer request. */}
                        <img
                          className="asset-preview"
                          src={ev.image}
                          alt={`${GRADES[i]}评价图片`}
                        />
                        {editing && (
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              edit((d) => {
                                d.dimensions[dimension].evaluations[i].image =
                                  '';
                                d.contentConfirmed = false;
                              })
                            }
                          >
                            移除图片引用
                          </Button>
                        )}
                      </div>
                    )}
                  </article>
                ))}
                {editing && (
                  <label
                    className="check-row"
                    htmlFor="paper-content-confirmed"
                  >
                    <Checkbox
                      id="paper-content-confirmed"
                      checked={draft.contentConfirmed}
                      disabled={busy}
                      onCheckedChange={(v) =>
                        edit((d) => {
                          d.contentConfirmed = v === true;
                        })
                      }
                    />
                    已核对本套卷24套正式评价，三段内容完整且不含测试占位
                  </label>
                )}
              </>
            )}
            {section === 'release' && (
              <>
                <p className="muted">
                  资格结果随本套试卷默认显示，无需另行启用。学生未达线时显示“高阶入学资格”；总分（可不填）及六个维度都达到分数线时，显示“精修班口试资格”。
                </p>
                {editing ? (
                  <div className="stack">
                    <label htmlFor="paper-admission-total-cutoff">
                      精修班口试资格总分线（选填；达到此分数）
                      <Input
                        id="paper-admission-total-cutoff"
                        type="number"
                        min={0}
                        max={fullMark(draft.analysis)}
                        step="0.1"
                        value={draft.admission.oralInterviewCutoff ?? ''}
                        disabled={busy}
                        onChange={(e) => edit((d) => { d.admission.oralInterviewCutoff = e.target.value === '' ? null : Number(e.target.value); })}
                      />
                    </label>
                    <div className="stack">
                      <small className="muted">精修班口试资格六维系数线（六项均须大于等于）</small>
                      {draft.analysis.dimensions.map((item, index) => (
                        <label key={item.id} htmlFor={`paper-admission-cutoff-${item.id}`}>
                          {item.name}（0–1）
                          <Input
                            id={`paper-admission-cutoff-${item.id}`}
                            type="number"
                            min={0}
                            max={1}
                            step="0.1"
                            value={draft.admission.dimensionCutoffs[index]}
                            disabled={busy}
                            onChange={(e) => edit((d) => { d.admission.dimensionCutoffs[index] = Number(e.target.value); })}
                          />
                        </label>
                      ))}
                    </div>
                    <label htmlFor="paper-admission-interview-message">
                      精修考试资格文案
                      <Textarea id="paper-admission-interview-message" rows={6} value={draft.admission.interviewMessage} maxLength={160} disabled={busy} onChange={(e) => edit((d) => { d.admission.interviewMessage = e.target.value; })}/>
                    </label>
                    <label htmlFor="paper-admission-course-message">
                      高阶入学资格文案
                      <Textarea id="paper-admission-course-message" rows={4} value={draft.admission.courseMessage} maxLength={160} disabled={busy} onChange={(e) => edit((d) => { d.admission.courseMessage = e.target.value; })}/>
                    </label>
                    <label htmlFor="paper-admission-note">
                      补充说明（可留空）
                      <Textarea id="paper-admission-note" value={draft.admission.note} maxLength={200} disabled={busy} onChange={(e) => edit((d) => { d.admission.note = e.target.value; })}/>
                    </label>
                  </div>
                ) : (
                  <div className="paper-summary">
                    <div>
                      <small>资格发布页</small>
                      <strong>默认显示</strong>
                      <span>{`${draft.admission.oralInterviewCutoff === null ? '不设总分线' : `总分达到 ${draft.admission.oralInterviewCutoff} 分`}，且六维均达线`}</span>
                    </div>
                    <div>
                      <small>当前考试 · 精修班口试资格过线人数</small>
                      <strong>{admissionSummary ? `${admissionSummary.interviewCount} / ${admissionSummary.total} 人` : '暂无统计'}</strong>
                      <span>{admissionSummary ? '按当前考试已应用的分数线及学生成绩计算' : '当前考试资格统计暂未载入'}</span>
                      {admissionSummary && (
                        <div className="admission-student-list" aria-label="精修班口试资格过线学生名单">
                          {admissionSummary.interviewStudents.length ? (
                            admissionSummary.interviewStudents.map((student) => (
                              <div className="admission-student-row" key={student.examNo}>
                                <b>{student.name}</b>
                                <span>{student.examNo} · {student.branch}</span>
                              </div>
                            ))
                          ) : (
                            <span>当前批次暂无学生达到精修班口试资格线。</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div>
                      <small>高阶入学资格说明</small>
                      <strong>{draft.admission.courseMessage}</strong>
                      <span>未达到精修班口试资格线的学生，显示此资格。</span>
                    </div>
                    <div>
                      <small>精修班口试资格说明</small>
                      <strong>{draft.admission.interviewMessage}</strong>
                      <span>{draft.admission.note || '总分（如设置）及六个维度均达到分数线时，显示此资格。'}</span>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
          {dirty && (
            <div className="paper-savebar">
              <span>
                {!name.trim()
                  ? '请在套卷总览填写名称后保存。'
                  : !valid?.success
                    ? '本套卷有未完成配置，请在套卷总览查看具体提示。'
                    : '本套卷的修改尚未保存。'}
              </span>
              <Button
                className="template-primary"
                disabled={busy || !name.trim() || !valid?.success}
                onClick={() => void run(() => save())}
              >
                <Save />
                保存本套卷
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function LegacySource({
  kind,
  templates,
  reload,
  busy,
  run,
  onLoad,
}: {
  kind: 'analysis' | 'evaluation' | 'thresholds';
  templates: SavedTemplate[];
  reload: () => Promise<void>;
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
  onLoad: (t: SavedTemplate) => void;
}) {
  const [selected, setSelected] = useState('');
  const confirm = useConfirm();
  const choices = templates.filter((t) => t.kind === kind);
  const chosen = choices.find((t) => t.id === selected);
  if (!choices.length) return null;
  return (
    <details className="paper-legacy">
      <summary>
        复用 / 管理旧版
        {kind === 'evaluation' ? '评价' : kind === 'analysis' ? '分析' : '阈值'}
        模板（已保留 {choices.length} 份）
      </summary>
      <p className="mini-label">
        {kind === 'analysis'
          ? '仅复制题型、满分和维度关联，不带入旧的等级分档。'
          : '按六个维度的对应顺序复制，请核对后保存本套卷。'}
        旧模板不会自动与套卷同步。
      </p>
      <div className="paper-picker">
        <TemplateSelect
          templates={choices}
          value={selected}
          disabled={busy}
          onChange={setSelected}
        />
        <Button
          disabled={busy || !chosen}
          onClick={async () => {
            if (!chosen) return;
            const names =
              chosen.kind === 'analysis'
                ? chosen.data.analysis.dimensions
                : chosen.kind === 'paper'
                  ? chosen.data.analysis.dimensions
                  : chosen.data.dimensions;
            if (
              await confirm(
                `将“${chosen.name}”复制到本套卷对应编辑区？原有编辑内容将被替换。六维顺序：${names.map((d) => d.name).join('、')}。请核对目标维度，当前学生不变。`,
              )
            )
              onLoad(chosen);
          }}
        >
          复制到本套卷
        </Button>
      </div>
      <div className="actions">
        <Button
          variant="destructive"
          disabled={busy || !chosen}
          onClick={() =>
            void run(async () => {
              if (
                !chosen ||
                !(await confirm(
                  `删除旧模板“${chosen.name}”？已复制到套卷的内容与当前学生结果均保留。`,
                ))
              )
                return;
              await api('templates', 'DELETE', {
                id: chosen.id,
                revision: chosen.revision,
                confirmDelete: true,
              });
              setSelected('');
              await reload();
            })
          }
        >
          <Trash2 />
          删除选中旧模板
        </Button>
      </div>
    </details>
  );
}
