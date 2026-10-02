'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { api } from '@/lib/client';
import { GRADES, continuousRules, ruleGaps, type Config } from '@/lib/domain';
import {
  completeThresholds,
  thresholdsFrom,
  thresholdSummary,
  thresholdTemplateSchema,
} from '@/lib/templates';
import { TemplateLibrary, type Shared } from './template-library';
import { ThresholdEditor } from './threshold-editor';
import { useConfirm } from './confirm-action';

export function ThresholdTemplates({
  config,
  revision,
  locked,
  parentDirty,
  onApplied,
  onDirtyChange,
  ...shared
}: Shared & {
  config: Config;
  revision: number;
  locked: boolean;
  parentDirty: boolean;
  onApplied: () => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => thresholdsFrom(config));
  const [dirty, setDirty] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const listener = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  }, [dirty]);
  const validation = thresholdTemplateSchema.safeParse(draft);
  function change(next: typeof draft) {
    setDraft(next);
    setDirty(true);
    setConfirmed(false);
  }
  return (
    <>
      <section className="panel">
        <div className="panel-title">
          <h2>当前考试 · 已保存的等级阈值</h2>
          <span className="pill">
            {config.thresholdsConfirmed && completeThresholds(config)
              ? '已确认且区间完整'
              : '尚未完成边界确认'}
          </span>
        </div>
        <p className="muted">
          以下是实际计算使用的规则，不是编辑区预览。等级按完整原始系数判断；页面系数直接截断至小数点后1位展示。
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>维度</th>
                {GRADES.map((grade) => (
                  <th key={grade}>{grade}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {config.dimensions.map((d, i) => (
                <tr key={d.id}>
                  <td>{config.analysis.dimensions[i].name}</td>
                  {thresholdSummary(d.rules).map((text, j) => (
                    <td key={j}>{text}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!completeThresholds(config) && (
          <div className="notice">
            <strong>当前已保存规则的具体空档</strong>
            {config.dimensions
              .filter((d) => ruleGaps(d.rules).length)
              .map((d) => (
                <p key={d.id}>
                  {config.analysis.dimensions.find((a) => a.id === d.id)?.name}
                  ：{ruleGaps(d.rules).join('；')}
                </p>
              ))}
            编辑并应用后，本表才会更新。仅另存模板不会改变当前规则。
          </div>
        )}
      </section>
      <section className="panel">
        <h2>等级阈值模板 · 独立保存与调用</h2>
        <p className="muted">
          每份模板保存六个维度各自的四级分档，可按学科、试卷自由命名。它不包含Part、满分、评语或学生信息；维度名称仅用于核对对应关系。当前仍采用六维、四级结构。
        </p>
        <TemplateLibrary
          {...shared}
          editing={editing}
          onStart={() => setEditing(true)}
          onClose={() => setEditing(false)}
          payload={{ kind: 'thresholds', data: draft }}
          saveDisabled={!validation.success}
          locked={false}
          onSaved={() => setDirty(false)}
          onLoad={async (t) => {
            if (t.kind !== 'thresholds') return;
            const mapping = t.data.dimensions
              .map(
                (d, i) =>
                  `${i + 1}. ${d.name} → ${config.analysis.dimensions[i].name}`,
              )
              .join('\n');
            if (
              !(await confirm(
                `载入“${t.name}”到阈值编辑区？不会立即生效。\n请核对六维顺序：\n${mapping}${dirty ? '\n将替换编辑区尚未保存的修改。' : ''}`,
                { title: '载入等级阈值模板', confirmLabel: '载入并开始编辑' },
              ))
            )
              return false;
            change(structuredClone(t.data));
            setEditing(true);
          }}
        />
      </section>
      {editing && (
        <section className="panel template-editor-surface">
          <h2>阈值编辑区 · {dirty ? '有未保存修改' : '尚未应用到考试'}</h2>
          <p className="muted">
            阈值最多一位小数；下限包含，最高上限1包含，其余上限不包含。修改相邻边界会联动，保存时检查0～1无空档、无重叠。
          </p>
          <div className="actions">
            <Button
              variant="outline"
              disabled={shared.busy}
              onClick={() => {
                const next = thresholdsFrom(config);
                next.dimensions.forEach((d) => {
                  d.rules = continuousRules();
                });
                change(next);
              }}
            >
              填入本次确认分档：0.8 / 0.6 / 0.4
            </Button>
          </div>
          {draft.dimensions.map((d, i) => (
            <details
              className="threshold-details"
              key={d.id}
              open={i === 0 ? true : undefined}
            >
              <summary>
                {i + 1}. {d.name}
                {d.name !== config.analysis.dimensions[i].name
                  ? ` → 当前：${config.analysis.dimensions[i].name}`
                  : ''}
              </summary>
              <ThresholdEditor
                idPrefix={`threshold-template-${i}`}
                rules={d.rules}
                disabled={shared.busy}
                onChange={(rules) => {
                  const next = structuredClone(draft);
                  next.dimensions[i].rules = rules;
                  change(next);
                }}
              />
            </details>
          ))}
          {!validation.success && (
            <p className="error" role="alert">
              {[...new Set(validation.error.issues.map((i) => i.message))].join(
                '；',
              )}
            </p>
          )}
          <label className="check-row" htmlFor="threshold-template-confirmed">
            <Checkbox
              id="threshold-template-confirmed"
              checked={confirmed}
              disabled={shared.busy || !validation.success}
              onCheckedChange={(value) => setConfirmed(value === true)}
            />
            已核对全部六维的对应关系及0～1完整分档
          </label>
          {locked && (
            <p className="notice">
              查询开放期间可以编辑、保存、重命名和删除模板；要应用到当前考试，请先关闭查询。
            </p>
          )}
          {parentDirty && (
            <p className="notice">
              其他页面有未保存的配置，请先保存再应用阈值，以免丢失修改。
            </p>
          )}
          <div className="actions">
            <Button
              disabled={
                shared.busy ||
                locked ||
                parentDirty ||
                !confirmed ||
                !validation.success
              }
              onClick={async () => {
                const summary = draft.dimensions
                  .map(
                    (d, i) =>
                      `${config.analysis.dimensions[i].name}：${thresholdSummary(
                        d.rules,
                      )
                        .map((text, j) => `${GRADES[j]} ${text}`)
                        .join('；')}`,
                  )
                  .join('\n');
                if (
                  !(await confirm(
                    `确认应用以下阈值？六维等级及匹配评语将按新边界重新计算；不会修改学生原始成绩、Part、评语正文或查询开关。\n${summary}`,
                    {
                      title: '将编辑区阈值应用到考试',
                      confirmLabel: '确认应用阈值',
                    },
                  ))
                )
                  return;
                void shared.act(async () => {
                  await api('thresholds', 'PUT', {
                    revision,
                    data: draft,
                    confirmApply: true,
                  });
                  setDirty(false);
                  await onApplied();
                }, '等级阈值已应用，当前结果按新分档计算。学生原始成绩、Part及评语正文未改变。');
              }}
            >
              确认应用阈值到当前考试
            </Button>
            <Button
              variant="outline"
              disabled={shared.busy}
              onClick={async () => {
                if (
                  dirty &&
                  !(await confirm(
                    '放弃阈值编辑区的未保存修改，恢复当前考试已保存规则？',
                  ))
                )
                  return;
                setDraft(thresholdsFrom(config));
                setDirty(false);
                setConfirmed(false);
              }}
            >
              恢复当前已保存阈值
            </Button>
          </div>
        </section>
      )}
    </>
  );
}
