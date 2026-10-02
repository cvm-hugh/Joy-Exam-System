'use client';
import { useState } from 'react';
import { FolderOpen, Pencil, Save, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/client';
import {
  TEMPLATE_LABELS,
  type SavedTemplate,
  type TemplatePayload,
} from '@/lib/templates';
import { useConfirm } from './confirm-action';

export type Shared = {
  templates: SavedTemplate[];
  reload: () => Promise<void>;
  act: (fn: () => Promise<void>, message?: string) => Promise<void>;
  busy: boolean;
};
export function TemplateSelect({
  templates,
  value,
  onChange,
  disabled = false,
  label = '已保存模板',
  empty = '请选择模板',
}: {
  templates: SavedTemplate[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  label?: string;
  empty?: string;
}) {
  return (
    <label className="template-select">
      <span>{label}</span>
      <Select
        value={value}
        onValueChange={(id) => onChange(id ?? '')}
        disabled={disabled}
      >
        <SelectTrigger aria-label={label} className="w-full">
          <SelectValue>
            {templates.find((t) => t.id === value)?.name ?? empty}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">{empty}</SelectItem>
          {templates.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
export function TemplateLibrary({
  payload,
  onLoad,
  locked,
  templates,
  reload,
  act,
  busy,
  onSaved,
  saveDisabled = false,
  editing,
  onStart,
  onClose,
  saveReason = '',
}: Shared & {
  payload: TemplatePayload;
  onLoad: (t: SavedTemplate) => void | boolean | Promise<void | boolean>;
  locked: boolean;
  onSaved?: () => void;
  saveDisabled?: boolean;
  editing: boolean;
  onStart: () => void;
  onClose: () => void | Promise<void>;
  saveReason?: string;
}) {
  const ask = useConfirm();
  const [name, setName] = useState(''),
    [selected, setSelected] = useState(''),
    [rename, setRename] = useState('');
  const [renaming, setRenaming] = useState(false),
    [notice, setNotice] = useState(''),
    [error, setError] = useState('');
  const [source, setSource] = useState('当前配置的编辑副本');
  const available = templates.filter((t) => t.kind === payload.kind);
  const current = available.find((t) => t.id === selected);
  async function run(fn: () => Promise<void>, message: string) {
    setError('');
    setNotice('');
    await act(async () => {
      try {
        await fn();
        setNotice(message);
      } catch (e) {
        setError(e instanceof Error ? e.message : '操作未完成，请重试');
        throw e;
      }
    });
  }
  return (
    <div className="template-hub">
      <div className="template-hub-heading">
        <div>
          <span className="eyebrow">TEMPLATE LIBRARY</span>
          <h3>选择{TEMPLATE_LABELS[payload.kind]}</h3>
        </div>
        <span className="pill">已保存 {available.length} 份</span>
      </div>
      <div className="template-picker-row">
        <TemplateSelect
          templates={available}
          value={current?.id ?? ''}
          disabled={busy}
          onChange={(id) => {
            setSelected(id);
            setRename(available.find((t) => t.id === id)?.name ?? '');
            setRenaming(false);
            setError('');
            setNotice('');
          }}
        />
        <Button
          className="template-primary"
          size="lg"
          disabled={busy || !current || locked}
          onClick={() => {
            if (!current) return;
            void run(async () => {
              const loaded = await onLoad(current);
              if (loaded === false) return;
              setSource(`模板“${current.name}”的编辑副本`);
            }, '');
          }}
        >
          <FolderOpen />
          载入并编辑
        </Button>
      </div>
      {!available.length && (
        <p className="mini-label">
          还没有保存的模板。点击“编辑当前配置”开始，编辑后可命名另存。
        </p>
      )}
      {locked && (
        <p className="notice">
          当前查询已开放，不能载入或编辑当前评价。请先到“考试与发布”关闭查询；重命名、删除及Excel模板导入仍可使用。
        </p>
      )}
      <div className="template-management">
        <Button
          variant="outline"
          disabled={busy || locked || editing}
          onClick={onStart}
        >
          <Pencil />
          编辑当前配置
        </Button>
        {current && (
          <div className="template-secondary-actions">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setRename(current.name);
                setRenaming(!renaming);
              }}
            >
              <Pencil />
              重命名
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (
                  !(await ask(
                    `将删除${TEMPLATE_LABELS[current.kind]}“${current.name}”。\n只删除模板库副本，当前考试、学生成绩、编辑区及图片均保留。此操作无法直接恢复。`,
                    {
                      title: '删除这份模板？',
                      confirmLabel: '确认删除模板',
                      destructive: true,
                    },
                  ))
                )
                  return;
                await run(async () => {
                  await api('templates', 'DELETE', {
                    id: current.id,
                    revision: current.revision,
                    confirmDelete: true,
                  });
                  await reload();
                  setSelected('');
                  setRename('');
                  setRenaming(false);
                }, `已删除“${current.name}”，其他模板和当前考试未改变。`);
              }}
            >
              <Trash2 />
              删除模板
            </Button>
          </div>
        )}
      </div>
      {renaming && current && (
        <div className="template-inline-form">
          <label htmlFor={`${payload.kind}-rename`}>
            模板新名称
            <Input
              id={`${payload.kind}-rename`}
              value={rename}
              disabled={busy}
              maxLength={80}
              onChange={(e) => setRename(e.target.value)}
            />
          </label>
          <Button
            disabled={busy || !rename.trim() || rename.trim() === current.name}
            onClick={() =>
              void run(async () => {
                await api('templates', 'PUT', {
                  id: current.id,
                  revision: current.revision,
                  name: rename,
                });
                await reload();
                setRenaming(false);
              }, '模板名称已保存。')
            }
          >
            保存名称
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setRenaming(false)}
          >
            取消
          </Button>
        </div>
      )}
      {editing && (
        <div className="template-draft-bar">
          <div className="template-draft-heading">
            <div>
              <strong>正在编辑 · {source}</strong>
              <p>
                下方为编辑内容，另存模板不改变当前考试；应用到考试需单独确认。
              </p>
            </div>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void onClose()}
            >
              <X />
              收起编辑
            </Button>
          </div>
          <div className="template-inline-form">
            <label htmlFor={`${payload.kind}-template-name`}>
              另存模板名称
              <Input
                id={`${payload.kind}-template-name`}
                value={name}
                disabled={busy}
                maxLength={80}
                placeholder="输入便于识别的学科、试卷或版本名称"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <Button
              disabled={busy || !name.trim() || saveDisabled}
              onClick={() =>
                void run(async () => {
                  const r = await api<{ id: string }>('templates', 'POST', {
                    name,
                    payload,
                  });
                  await reload();
                  setSelected(r.id);
                  setName('');
                  onSaved?.();
                }, '模板已保存。当前考试未改变，可继续编辑或确认应用。')
              }
            >
              <Save />
              另存为{TEMPLATE_LABELS[payload.kind]}
            </Button>
          </div>
          {saveDisabled && (
            <p className="error">
              {saveReason ||
                '编辑值尚未通过校验，请修正下方标出的内容后再保存模板。'}
            </p>
          )}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <output className="success">{notice}</output>}
    </div>
  );
}
