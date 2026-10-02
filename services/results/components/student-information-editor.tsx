'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { api } from '@/lib/client';
import { STUDENT_INFORMATION_FIELDS, normalizeYearLevel, studentInformationIssues, type StudentInformation } from '@/lib/student-information';

export type InformationStudent = StudentInformation & { examNo: string; name: string; revision: number; batchId: string; sessionKey: string };

export function StudentInformationEditor({ student, currentRevision, disabled, onBusyChange, onDirtyChange, onSaved, onCancel }: {
  student: InformationStudent;
  currentRevision: number;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const focused = useRef(false);
  useEffect(() => {
    if (disabled || focused.current) return;
    panel.current?.scrollIntoView({ block: 'start' });
    const field = studentInformationIssues(student)[0]?.field ?? 'yearLevel';
    panel.current?.querySelector<HTMLInputElement>(`#information-${field}`)?.focus({ preventScroll: true });
    focused.current = true;
  }, [student, disabled]);
  const [information, setInformation] = useState({
    branch: student.branch ?? '', className: student.className ?? '',
    examSession: student.examSession ?? '', yearLevel: normalizeYearLevel(student.yearLevel),
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const stale = currentRevision !== student.revision;
  const issues = studentInformationIssues({ ...student, ...information });
  return <section ref={panel} className="notice" aria-label="补充学生信息">
    <h3>补充信息 · {student.name}（{student.examNo}）</h3>
    <p>年级未知可留空；班级、笔试时间可稍后补充。原始导入内容会保留在 Excel 的“原始名单信息”中。</p>
    {stale && <p className="error" role="alert">名单版本已更新，请关闭后重新打开该学生的信息。</p>}
    <form onSubmit={(event) => {
      event.preventDefault();
      if (disabled || stale || saving) return;
      setSaving(true); onBusyChange(true); setError('');
      void api('students/information', 'PUT', {
        revision: student.revision, batchId: student.batchId, examNo: student.examNo, information,
      }).then(async () => { onDirtyChange(false); await onSaved(); })
        .catch((e) => setError(e instanceof Error ? e.message : '保存失败'))
        .finally(() => { setSaving(false); onBusyChange(false); });
    }}>
      <div className="form-grid">
        {STUDENT_INFORMATION_FIELDS.map(({ key, label }) => <label key={key} htmlFor={`information-${key}`}>
          {label}{key !== 'branch' && '（选填）'}
          <Input id={`information-${key}`} value={information[key]} required={key === 'branch'} maxLength={key === 'yearLevel' ? 40 : 80}
            disabled={disabled || stale} placeholder={key === 'yearLevel' ? '未知可留空，例如：七年级' : ''}
            onChange={(event) => { setInformation((current) => ({ ...current, [key]: event.target.value })); onDirtyChange(true); }}/>
        </label>)}
      </div>
      {!!issues.length && <p>{issues.map((issue) => `${issue.label}：${issue.message}`).join('；')}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <Button type="submit" disabled={disabled || stale}>保存补充信息</Button>
        <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>关闭</Button>
      </div>
    </form>
  </section>;
}
