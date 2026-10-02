'use client';
import { useState, type ComponentProps } from 'react';
import { Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { Config, State } from '@/lib/domain';
import { PageConfiguration } from './page-configuration';

type Mode = State['published'];
export type PublicationStatus = Pick<State, 'published' | 'count'> & {
  demoAllowed: boolean;
  formalAllowed: boolean;
  readiness: string[];
};

export function publicationBlockedReason(
  status: PublicationStatus,
  mode: 'demo' | 'formal',
  dirty: boolean,
) {
  // An active switch must remain usable to close queries, even if requirements change.
  if (status.published === mode) return '';
  if (dirty) return '请先保存配置';
  if (!status.count) return '请先导入成绩';
  if (mode === 'demo')
    return status.demoAllowed ? '' : '当前环境未启用演示查询';
  if (!status.formalAllowed) return '正式环境与验收完成后开放';
  return status.readiness.length ? '请先完成下方发布准备事项' : '';
}

export function QueryEntrancePreview({
  config,
  mode,
}: {
  config: Config;
  mode: Mode;
}) {
  const open = mode !== 'closed';
  return (
    <div className="query-entrance-phone" aria-label="小程序入口页面效果预览">
      <div className="query-preview-navbar">考试结果查询</div>
      <div className="query-preview-content">
        <div
          className="query-preview-brand-space"
          aria-label="品牌标志预留位置"
        />
        <div className="query-preview-hello">{config.pageCopy.greeting}</div>
        <div className="query-preview-welcome">{config.pageCopy.welcome}</div>
        <h3>{config.queryTitle}</h3>
        <p className="query-preview-description">{config.queryDescription}</p>
        <label htmlFor="query-preview-name">
          学生中文姓名 <small>CHINESE NAME</small>
          <Input
            id="query-preview-name"
            readOnly
            disabled={!open}
            value=""
            placeholder="请输入学生姓名"
          />
        </label>
        <label htmlFor="query-preview-number">
          考号 <small>NUMBER</small>
          <Input
            id="query-preview-number"
            readOnly
            disabled={!open}
            value=""
            placeholder="请输入完整考号，保留开头的0"
          />
        </label>
        {!open && (
          <p className="query-preview-notice">{config.closedMessage}</p>
        )}
        <Button
          className={`query-preview-submit ${open ? 'is-open' : ''}`}
          disabled
        >
          {open ? '立即查询' : '暂未开放查询'}
        </Button>
        <p className="query-preview-privacy">
          仅查询当前最新一批考试结果。
          <br />
          姓名与考号须同时匹配，不展示原始成绩、总分或排名。
        </p>
        <p className="query-preview-footer">{config.pageCopy.queryFooter}</p>
      </div>
    </div>
  );
}

export function PublicationPanel({
  status,
  config,
  dirty,
  busy,
  onPublish,
  onEdit,
  onSave,
  onUpload,
  renderResult,
}: {
  status: PublicationStatus;
  config: Config;
  dirty: boolean;
  busy: boolean;
  onPublish: (mode: Mode) => void;
} & Pick<
  ComponentProps<typeof PageConfiguration>,
  'onEdit' | 'onSave' | 'onUpload' | 'renderResult'
>) {
  const [previewMode, setPreviewMode] = useState<Mode>('formal');
  return (
    <>
      <section className="panel">
        <div className="panel-title">
          <h2>查询开放设置</h2>
          <span className="pill">
            {status.published === 'closed'
              ? '当前查询已关闭'
              : status.published === 'demo'
                ? '当前为演示查询'
                : '当前为正式查询'}
          </span>
        </div>
        <div className="publication-rows">
          {(['demo', 'formal'] as const).map((mode) => {
            const title =
              mode === 'demo' ? '结果查询演示预览' : '正式开放小程序查询';
            const checked = status.published === mode;
            const reason = publicationBlockedReason(status, mode, dirty);
            return (
              <div
                className={`publication-row ${checked ? 'is-open' : ''}`}
                key={mode}
              >
                <div className="publication-row-description">
                  <Button
                    variant="outline"
                    className="publication-preview-button"
                    onClick={() => setPreviewMode(mode)}
                    aria-controls="query-entrance-preview"
                  >
                    <Eye />
                    {title}
                  </Button>
                  {reason && <small>{reason}</small>}
                </div>
                <div className="publication-switch-control">
                  <span id={`publish-${mode}-status`}>
                    {checked ? '已开放' : '已关闭'}
                  </span>
                  <Switch
                    className="publication-switch"
                    checked={checked}
                    disabled={busy || !!reason}
                    aria-label={title}
                    aria-describedby={`publish-${mode}-status`}
                    onCheckedChange={(value) => {
                      if (!busy && !reason) onPublish(value ? mode : 'closed');
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <p className="mini-label publication-help">
          左侧按钮仅预览页面；右侧开关控制实际查询。演示与正式查询不会同时开放。
        </p>
      </section>
      <PageConfiguration
        config={config}
        locked={status.published !== 'closed'}
        busy={busy}
        dirty={dirty}
        mode={previewMode}
        onModeChange={setPreviewMode}
        onEdit={onEdit}
        onSave={onSave}
        onUpload={onUpload}
        renderEntrance={(mode) => (
          <QueryEntrancePreview config={config} mode={mode} />
        )}
        renderResult={renderResult}
      />
    </>
  );
}
