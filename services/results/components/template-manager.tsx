'use client';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { api } from '@/lib/client';
import {
  fullMark,
  continuousRules,
  isComplete,
  ruleGaps,
  type Config,
} from '@/lib/domain';
import { ThresholdEditor } from './threshold-editor';
import {
  analysisFrom,
  analysisTemplateSchema,
  withAnalysis,
  withEvaluation,
  evaluationFrom,
  type AnalysisTemplate,
} from '@/lib/templates';
import type { EvaluationImport } from '@/lib/evaluation-importer';

import { TemplateLibrary, type Shared } from './template-library';
export { TemplateSelect } from './template-library';
import { useConfirm } from './confirm-action';

export function AnalysisEditor({
  config,
  revision,
  count,
  locked,
  parentDirty,
  onApplied,
  onDirtyChange,
  ...shared
}: Shared & {
  config: Config;
  revision: number;
  count: number;
  locked: boolean;
  parentDirty: boolean;
  onApplied: () => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<AnalysisTemplate>(() =>
    analysisFrom(config),
  );
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const listener = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  }, [dirty]);
  function edit(fn: (data: AnalysisTemplate) => void) {
    const next = structuredClone(draft);
    fn(next);
    setDraft(next);
    setDirty(true);
  }
  const validation = analysisTemplateSchema.safeParse(draft);
  return (
    <>
      <section className="panel">
        <div className="panel-title">
          <h2>分析模板 · 计算规则</h2>
          <span className="pill">
            6维 · {draft.analysis.parts.length}个Part ·{' '}
            {fullMark(draft.analysis)}分
          </span>
        </div>
        <p className="muted">
          编辑维度名称、各Part名称与满分、维度与Part的关联及等级阈值。一个Part可关联多个维度，总分只计一次。维度标识和顺序保留，避免评语串位。
        </p>
        <TemplateLibrary
          {...shared}
          editing={editing}
          onStart={() => setEditing(true)}
          onClose={() => setEditing(false)}
          saveDisabled={!validation.success}
          payload={{ kind: 'analysis', data: draft }}
          onSaved={() => setDirty(false)}
          locked={false}
          onLoad={async (t) => {
            if (
              t.kind !== 'analysis' ||
              (dirty &&
                !(await confirm(
                  '载入将替换计算规则编辑区的未保存修改，继续？',
                )))
            )
              return false;
            setDraft(structuredClone(t.data));
            setDirty(true);
            setEditing(true);
          }}
        />
        {locked && (
          <p className="notice">
            当前查询已开放：可以编辑、保存分析模板，但应用到当前考试仍需先关闭查询。这不会改变现有查询开关。
          </p>
        )}
      </section>
      {editing && (
        <div className="template-editor-surface">
          <section className="panel">
            <div className="panel-title">
              <h2>01 · 试卷Part与得分上限</h2>
              <Button
                variant="outline"
                disabled={shared.busy || draft.analysis.parts.length >= 60}
                onClick={() =>
                  edit((d) => {
                    let n = 1;
                    while (d.analysis.parts.some((p) => p.id === `P${n}`)) n++;
                    d.analysis.parts.push({
                      id: `P${n}`,
                      label: `新增Part${n}`,
                      max: 5,
                    });
                  })
                }
              >
                添加Part
              </Button>
            </div>
            <div className="part-editor">
              {draft.analysis.parts.map((p, i) => (
                <div className="part-row" key={p.id}>
                  <span className="mini-label">{p.id}</span>
                  <label htmlFor={`part-label-${p.id}`}>
                    Part名称
                    <Input
                      id={`part-label-${p.id}`}
                      maxLength={160}
                      value={p.label}
                      disabled={shared.busy}
                      onChange={(e) =>
                        edit((d) => {
                          d.analysis.parts[i].label = e.target.value;
                        })
                      }
                    />
                  </label>
                  <label htmlFor={`part-max-${p.id}`}>
                    满分
                    <Input
                      id={`part-max-${p.id}`}
                      type="number"
                      min={0.0001}
                      max={10000}
                      step="any"
                      value={p.max}
                      disabled={shared.busy}
                      onChange={(e) =>
                        edit((d) => {
                          d.analysis.parts[i].max = Number(e.target.value);
                        })
                      }
                    />
                  </label>
                  <Button
                    variant="ghost"
                    disabled={shared.busy || draft.analysis.parts.length === 1}
                    onClick={async () => {
                      if (
                        !(await confirm(
                          `从本编辑区移除“${p.label}”及其维度关联？不会删除学生。`,
                        ))
                      )
                        return;
                      edit((d) => {
                        d.analysis.parts.splice(i, 1);
                        d.analysis.dimensions.forEach((dim) => {
                          dim.parts = dim.parts.filter((id) => id !== p.id);
                        });
                      });
                    }}
                  >
                    移除
                  </Button>
                </div>
              ))}
            </div>
          </section>
          <section className="panel">
            <h2>02 · 六个维度与Part关联</h2>
            <div className="analysis-dimensions">
              {draft.analysis.dimensions.map((d, i) => (
                <div className="analysis-dimension" key={d.id}>
                  <label>
                    维度 {i + 1} 名称
                    <Input
                      value={d.name}
                      maxLength={160}
                      disabled={shared.busy}
                      onChange={(e) =>
                        edit((next) => {
                          next.analysis.dimensions[i].name = e.target.value;
                        })
                      }
                    />
                  </label>
                  <div className="part-choices">
                    {draft.analysis.parts.map((p) => (
                      <label className="check-row" key={p.id}>
                        <Checkbox
                          checked={d.parts.includes(p.id)}
                          disabled={shared.busy}
                          onCheckedChange={(v) =>
                            edit((next) => {
                              next.analysis.dimensions[i].parts =
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
                </div>
              ))}
            </div>
          </section>
          <section className="panel">
            <h2>03 · 等级阈值</h2>
            <p className="muted">
              等级按完整原始系数判断；页面系数直接截断至小数点后1位展示。下限均包含，最高上限1包含，其余上限不包含；阈值最多一位小数。
            </p>
            <div className="actions">
              <Button
                variant="outline"
                disabled={shared.busy}
                onClick={() =>
                  edit((data) => {
                    data.dimensions.forEach((d) => {
                      d.rules = continuousRules();
                    });
                    data.thresholdsConfirmed = true;
                  })
                }
              >
                六维统一采用本次确认分档：0.8 / 0.6 / 0.4
              </Button>
            </div>
            {draft.dimensions.map((d, i) => (
              <details key={d.id} className="threshold-details">
                <summary>
                  {draft.analysis.dimensions[i].name} ·{' '}
                  {isComplete(d.rules) ? '区间完整' : '有待确认边界'}
                </summary>
                <ThresholdEditor
                  rules={d.rules}
                  disabled={shared.busy}
                  idPrefix={`analysis-${i}`}
                  onChange={(rules) =>
                    edit((n) => {
                      n.dimensions[i].rules = rules;
                      n.thresholdsConfirmed = false;
                    })
                  }
                />
              </details>
            ))}
            <label
              className="check-row"
              htmlFor="analysis-thresholds-confirmed"
            >
              <Checkbox
                id="analysis-thresholds-confirmed"
                checked={draft.thresholdsConfirmed}
                disabled={shared.busy}
                onCheckedChange={(v) =>
                  edit((d) => {
                    d.thresholdsConfirmed = v === true;
                  })
                }
              />
              已确认六维0～1的全部等级区间
            </label>
          </section>
          <section className="panel">
            <h2>应用规则</h2>
            {draft.dimensions.some((d) => !isComplete(d.rules)) && (
              <div className="notice">
                <strong>
                  这个编辑副本仍包含旧阈值，不能直接覆盖当前已确认的分档。
                </strong>
                {draft.dimensions
                  .filter((d) => ruleGaps(d.rules).length)
                  .map((d, i) => (
                    <p key={d.id}>
                      {draft.analysis.dimensions.find((a) => a.id === d.id)
                        ?.name ?? `维度${i + 1}`}
                      ：{ruleGaps(d.rules).join('；')}
                    </p>
                  ))}
                请在上方“等级阈值”采用完整连续分档后再应用。现有考试不会自动回退到旧值。
              </div>
            )}
            <p className="muted">
              用于其他试卷：先另存分析模板，再到“成绩导入”选择该模板并下载对应成绩表。导入全部校验成功后，才一起切换规则和学生数据。
            </p>
            {!validation.success && (
              <p className="error" role="alert">
                {[
                  ...new Set(validation.error.issues.map((i) => i.message)),
                ].join('；')}
              </p>
            )}
            <div className="actions">
              <Button
                disabled={
                  shared.busy ||
                  locked ||
                  parentDirty ||
                  !validation.success ||
                  draft.dimensions.some((d) => !isComplete(d.rules))
                }
                onClick={async () => {
                  if (
                    !(await confirm(
                      `确认将编辑区规则应用到当前考试？${count ? `将重新计算当前${count}名学生的六维结果；不兼容时取消整个操作。` : ''}现有评价文字保持不变，请核对维度名称。`,
                    ))
                  )
                    return;
                  void shared.act(async () => {
                    await api('config', 'PUT', {
                      revision,
                      config: withAnalysis(config, draft),
                      confirmAnalysis: true,
                    });
                    setDirty(false);
                    await onApplied();
                  }, '计算规则已应用，学生成绩原始值保持不变。');
                }}
              >
                应用到当前考试
              </Button>
              <Button
                variant="outline"
                disabled={shared.busy}
                onClick={async () => {
                  if (
                    dirty &&
                    !(await confirm(
                      '放弃计算规则编辑区的修改，恢复当前已保存规则？',
                    ))
                  )
                    return;
                  setDraft(analysisFrom(config));
                  setDirty(false);
                }}
              >
                恢复当前规则
              </Button>
            </div>
            {parentDirty && (
              <p className="notice">
                请先保存“维度与评价”或“考试与发布”中的修改。
              </p>
            )}
          </section>
        </div>
      )}
    </>
  );
}
export function EvaluationTemplates({
  config,
  revision,
  dirty,
  locked,
  edit,
  editing,
  onStart,
  onClose,
  ...shared
}: Shared & {
  config: Config;
  revision: number;
  dirty: boolean;
  locked: boolean;
  edit: (mutator: (c: Config) => void) => void;
  editing: boolean;
  onStart: () => void;
  onClose: () => void;
}) {
  const confirm = useConfirm();
  const [importing, setImporting] = useState(false);
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState<
      (EvaluationImport & { revision: number }) | null
    >(null),
    [name, setName] = useState('');
  const stale = preview && preview.revision !== revision;
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>评价模板 · 24套评语</h2>
        <span className="pill">Excel 批量导入</span>
      </div>
      <p className="muted">
        先选择模板，再点击“载入并编辑”。也可从当前配置开始编辑，或通过Excel一次导入24套评价。
      </p>
      <TemplateLibrary
        {...shared}
        editing={editing}
        onStart={onStart}
        onClose={onClose}
        payload={{ kind: 'evaluation', data: evaluationFrom(config) }}
        locked={locked}
        onLoad={async (t) => {
          if (t.kind !== 'evaluation') return;
          const mapping = t.data.dimensions
            .map((d, i) => `${d.name} → ${config.analysis.dimensions[i].name}`)
            .join('\n');
          if (
            !(await confirm(
              `载入将替换当前编辑区24套评价和段落标题，保存配置后生效。\n维度对应：\n${mapping}${dirty ? '\n编辑区有尚未保存的修改。' : ''}`,
              { title: `编辑“${t.name}”`, confirmLabel: '载入并开始编辑' },
            ))
          )
            return false;
          edit((c) => Object.assign(c, withEvaluation(c, t.data)));
          onStart();
        }}
      />
      <Button
        variant="outline"
        disabled={shared.busy}
        onClick={() => setImporting(!importing)}
        aria-expanded={importing}
      >
        {importing ? '收起Excel导入' : '通过Excel批量导入评价'}
      </Button>
      {importing && (
        <div className="template-import-surface">
          <div className="actions">
            <a
              className="download"
              download
              href="/api/admin/evaluation-template"
            >
              下载评价Excel空模板
            </a>
            <a
              className="download"
              download
              href="/api/admin/evaluation-template?filled=1"
            >
              导出当前已保存正文
            </a>
          </div>
          <label style={{ display: 'block', marginTop: 20 }}>
            上传评价内容
            <input
              className="file-input"
              type="file"
              accept=".xlsx,.csv"
              disabled={shared.busy}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPreview(null);
              }}
            />
          </label>
          <div className="actions">
            <Button
              variant="outline"
              disabled={!file || shared.busy || dirty}
              onClick={() =>
                void shared.act(async () => {
                  setPreview(null);
                  const form = new FormData();
                  form.set('file', file!);
                  form.set('revision', String(revision));
                  setPreview(
                    await api<EvaluationImport & { revision: number }>(
                      'evaluations-preview',
                      'POST',
                      form,
                    ),
                  );
                }, '已校验24套评价。请核对预览和名称映射，再载入或另存模板。')
              }
            >
              校验并预览Excel
            </Button>
          </div>
          {dirty && (
            <p className="mini-label">
              先保存编辑区修改，再上传Excel，避免覆盖未保存内容。下载导出的是服务端已保存版本。
            </p>
          )}
          {preview && (
            <div className="import-preview">
              <h3>导入预览 · {preview.rows.length} / 24 套</h3>
              <p className="mini-label">
                只替换三段正文，保留当前评价标题与图片。不会直接应用到考试。
              </p>
              {preview.warnings.map((w) => (
                <p className="notice" key={w}>
                  {w}
                </p>
              ))}
              {stale && (
                <p className="error">考试配置已变化，请重新校验文件。</p>
              )}
              <div className="evaluation-preview-list">
                {preview.rows.map((r) => (
                  <details key={`${r.dimension}-${r.grade}`}>
                    <summary>
                      {r.dimension} · {r.grade}
                    </summary>
                    {r.paragraphs.map((p, i) => (
                      <p key={i}>
                        <small>{preview.data.paragraphTitles[i]}</small>
                        <br />
                        {p}
                      </p>
                    ))}
                  </details>
                ))}
              </div>
              <label htmlFor="evaluation-import-name">
                导入内容另存模板名称
                <Input
                  id="evaluation-import-name"
                  value={name}
                  maxLength={80}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：标准能力评价版"
                />
              </label>
              <div className="actions">
                <Button
                  disabled={shared.busy || !name.trim() || !!stale}
                  onClick={() =>
                    void shared.act(async () => {
                      await api('templates', 'POST', {
                        name,
                        payload: { kind: 'evaluation', data: preview.data },
                      });
                      await shared.reload();
                      setName('');
                    }, '导入内容已保存为评价模板，当前考试未改变。')
                  }
                >
                  保存为评价模板
                </Button>
                <Button
                  variant="outline"
                  disabled={shared.busy || locked || !!stale || dirty}
                  onClick={async () => {
                    if (
                      !(await confirm(
                        '已核对24套内容及名称映射？载入编辑区后仍需点击“保存配置”才生效。',
                      ))
                    )
                      return;
                    edit((c) =>
                      Object.assign(c, withEvaluation(c, preview.data)),
                    );
                    onStart();
                    setPreview(null);
                  }}
                >
                  确认载入编辑区
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
