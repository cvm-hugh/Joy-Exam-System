'use client';
import { useEffect, useState } from 'react';
import { UserPlus, Save } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/client';
import { resultFor, type State, type Student } from '@/lib/domain';
import { parseStudentEntry } from '@/lib/student-entry';
import { useConfirm } from './confirm-action';

export function StudentEntry({
  snapshot,
  busy,
  configDirty,
  onBusyChange,
  onDirtyChange,
  onSaved,
}: {
  snapshot: State;
  busy: boolean;
  configDirty: boolean;
  onBusyChange: (v: boolean) => void;
  onDirtyChange: (v: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const confirm = useConfirm();
  const [basis, setBasis] = useState<State | null>(null);
  const [name, setName] = useState('');
  const [examNo, setExamNo] = useState('');
  const [branch, setBranch] = useState('XX 分校');
  const [className, setClassName] = useState('');
  const [examSession, setExamSession] = useState('');
  const [yearLevel, setYearLevel] = useState('');
  const [scores, setScores] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Student | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const dirty = !!(name || examNo || className || examSession || yearLevel || branch !== 'XX 分校' || Object.values(scores).some(Boolean));
  const stale =
    !!basis &&
    (basis.revision !== snapshot.revision ||
      basis.batchId !== snapshot.batchId);
  const disabled =
    busy ||
    pending ||
    snapshot.published !== 'closed' ||
    configDirty ||
    snapshot.count >= 2000;
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  function reset() {
    setName('');
    setExamNo('');
    setBranch('XX 分校');
    setClassName('');
    setExamSession('');
    setYearLevel('');
    setScores({});
    setPreview(null);
    setError('');
    onDirtyChange(false);
  }
  function change(fn: () => void) {
    fn();
    setPreview(null);
    setError('');
    setNotice('');
    onDirtyChange(true);
  }
  async function start() {
    if (disabled) return;
    if (
      dirty &&
      !(await confirm('放弃尚未保存的补录内容，按当前批次重新填写？'))
    )
      return;
    reset();
    setNotice('');
    setBasis(structuredClone(snapshot));
  }
  async function save() {
    if (!preview || !basis || disabled || stale) return;
    if (
      !(await confirm(
        `确认补录“${preview.name}”（考号 ${preview.examNo}）？只新增该学生，原名单和试卷配置不变。`,
      ))
    )
      return;
    setPending(true);
    onBusyChange(true);
    setError('');
    try {
      await api('students/append', 'POST', {
        revision: basis.revision,
        batchId: basis.batchId,
        student: {
          name: preview.name,
          examNo: preview.examNo,
          branch: preview.branch,
          className: preview.className,
          examSession: preview.examSession,
          yearLevel: preview.yearLevel,
          scores: preview.scores,
        },
      });
      reset();
      setBasis(null);
      setNotice('已成功补录1名学生，原名单未替换。可继续补录下一名。');
      try {
        await onSaved();
      } catch {
        setNotice(
          '学生已保存，但名单刷新未完成。请刷新页面查看，不要重复提交。',
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '补录失败，请重试');
    } finally {
      setPending(false);
      onBusyChange(false);
    }
  }
  return (
    <section className="panel student-entry-panel">
      <div className="panel-title">
        <h2>03 · 零星补录学生成绩</h2>
        <span className="pill">只新增 · 不替换</span>
      </div>
      <p className="mini-label">
        沿用当前批次试卷：
        {snapshot.config.paperSource?.name ?? snapshot.config.examName}
        。重复考号不覆盖。
      </p>
      {snapshot.published !== 'closed' && (
        <p className="notice">请先到“配置与发布”关闭查询，再补录成绩。</p>
      )}
      {!snapshot.batchId && (
        <p className="mini-label">请先导入首批成绩，再补录个别学生。</p>
      )}
      {configDirty && (
        <p className="notice">请先保存当前配置修改，再开始补录。</p>
      )}
      {snapshot.count >= 2000 && (
        <p className="notice">本批次已达2000人上限。</p>
      )}
      {notice && <output className="success">{notice}</output>}
      {!basis ? (
        <Button
          onClick={() => void start()}
          disabled={disabled || !snapshot.batchId || !snapshot.count}
        >
          <UserPlus />
          补录一名学生
        </Button>
      ) : (
        <>
          {stale && (
            <div className="error">
              当前批次或配置已变化，请重新开始补录，以免使用旧规则。
              <Button
                variant="outline"
                disabled={disabled}
                onClick={() => void start()}
              >
                按当前批次重新填写
              </Button>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (disabled || stale) return;
              try {
                setPreview(
                  parseStudentEntry(
                    { name, examNo, branch, className, examSession, yearLevel, scores },
                    basis.config.analysis,
                  ),
                );
                setError('');
              } catch (e) {
                setError(
                  e instanceof z.ZodError
                    ? e.issues.map((issue) => issue.message).join('\n')
                    : '请核对填写内容',
                );
              }
            }}
          >
            <div className="form-grid student-entry-fields">
              <label htmlFor="entry-name">
                学生中文姓名
                <Input
                  id="entry-name"
                  value={name}
                  maxLength={40}
                  required
                  disabled={disabled || stale || !!preview}
                  onChange={(e) => change(() => setName(e.target.value))}
                />
              </label>
              <label htmlFor="entry-number">
                考号
                <Input
                  id="entry-number"
                  value={examNo}
                  maxLength={64}
                  required
                  autoComplete="off"
                  placeholder="保留开头的0"
                  disabled={disabled || stale || !!preview}
                  onChange={(e) => change(() => setExamNo(e.target.value))}
                />
              </label>
              <label htmlFor="entry-branch">
                分校名称
                <Input
                  id="entry-branch"
                  value={branch}
                  maxLength={80}
                  required
                  disabled={disabled || stale || !!preview}
                  onChange={(e) => change(() => setBranch(e.target.value))}
                />
              </label>
              {([
                ['班级名称', className, setClassName, '选填，例如：精修一班'],
                ['笔试时间', examSession, setExamSession, '选填，按实际文字填写'],
                ['年级', yearLevel, setYearLevel, '选填，例如：七年级'],
              ] as const).map(([label, value, setter, placeholder]) => (
                <label key={label} htmlFor={`entry-${label}`}>{label}<Input id={`entry-${label}`} value={value} placeholder={placeholder} maxLength={label === '年级' ? 40 : 80} disabled={disabled || stale || !!preview} onChange={(e) => change(() => setter(e.target.value))}/></label>
              ))}
              {basis.config.analysis.parts.map((part) => (
                <label key={part.id} htmlFor={`entry-${part.id}`}>
                  {part.label} <small>满分{part.max}分</small>
                  <Input
                    id={`entry-${part.id}`}
                    inputMode="decimal"
                    value={scores[part.id] ?? ''}
                    required
                    placeholder={`0～${part.max}`}
                    disabled={disabled || stale || !!preview}
                    onChange={(e) =>
                      change(() =>
                        setScores({ ...scores, [part.id]: e.target.value }),
                      )
                    }
                  />
                </label>
              ))}
            </div>
            {!preview && (
              <Button type="submit" disabled={disabled || stale}>
                校验并预览
              </Button>
            )}
          </form>
          {preview && (
            <div className="student-entry-review">
              <h3>
                {preview.name} · {preview.examNo} · {preview.branch}
              </h3>
              <p>自动合计总分：{preview.total}（仅后台可见）</p>
              <div className="student-entry-grades">
                {resultFor(
                  preview,
                  basis.config,
                  basis.isDemoData,
                ).dimensions.map((d) => (
                  <div key={d.id}>
                    <span>{d.name}</span>
                    <strong>{d.grade}</strong>
                  </div>
                ))}
              </div>
              <div className="actions">
                <Button
                  disabled={disabled || stale}
                  onClick={() => void save()}
                >
                  <Save />
                  确认补录，不替换名单
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || pending}
                  onClick={() => setPreview(null)}
                >
                  返回修改
                </Button>
              </div>
            </div>
          )}
          <Button
            variant="ghost"
            disabled={busy || pending}
            onClick={async () => {
              if (
                dirty &&
                !(await confirm('取消本次补录？尚未保存的输入将丢弃。'))
              )
                return;
              reset();
              setBasis(null);
            }}
          >
            取消补录
          </Button>
        </>
      )}
      {error && (
        <p className="error" role="alert" style={{ whiteSpace: 'pre-wrap' }}>
          {error}
        </p>
      )}
    </section>
  );
}
