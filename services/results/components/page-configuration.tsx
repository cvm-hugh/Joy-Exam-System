'use client';
import { useState, type ReactNode } from 'react';
import { Pencil, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  fullMark,
  resultFor,
  type Config,
  type Result,
  type State,
} from '@/lib/domain';
import { BackCover } from './back-cover';

type Page = 'query' | 'student' | 'admission' | 'content' | 'cover';
type ImageKey =
  | 'headerImage'
  | 'footerImage'
  | 'coverBackgroundImage'
  | 'coverQrImage';
type TextKey =
  | 'queryTitle'
  | 'queryDescription'
  | 'closedMessage'
  | 'failedMessage'
  | 'examName'
  | 'examInfo'
  | 'coverText'
  | 'coverFooter';
type CopyKey = keyof Config['pageCopy'];
type CopyTextKey = Exclude<
  CopyKey,
  | 'abilityHeadingFont'
  | 'abilityHeadingSize'
  | 'learningHeadingFont'
  | 'learningHeadingSize'
>;
export const PAGE_IMAGE_SPECS: Record<
  ImageKey,
  { label: string; size: string; detail: string }
> = {
  headerImage: {
    label: '内容页顶部图片',
    size: '750 × 300 像素',
    detail: '横版；等比显示完整图片，高度随比例适配。',
  },
  footerImage: {
    label: '内容页底部图片',
    size: '750 × 300 像素',
    detail: '横版；与封底底图独立，等比显示完整图片。',
  },
  coverBackgroundImage: {
    label: '封底底图',
    size: '750 × 1334 像素',
    detail:
      '竖版；居中铺满，比例不同时边缘可能裁切，请将重要文字留在中央。底图不要包含二维码。',
  },
  coverQrImage: {
    label: '中心二维码（选填）',
    size: '480 × 480 像素',
    detail:
      '正方形；保留四周白边，等比完整显示。不上传则隐藏二维码，不占空位。',
  },
};

export function layoutPreviewResult(config: Config): Result {
  // A non-persisted layout specimen uses full marks to preview the configured top grade.
  return resultFor(
    {
      name: '学生中文名',
      examNo: 'preview-only',
      total: String(fullMark(config.analysis)),
      scores: Object.fromEntries(
        config.analysis.parts.map((p) => [p.id, String(p.max)]),
      ),
    },
    config,
    true,
  );
}

export function PageConfiguration({
  config,
  locked,
  busy,
  dirty,
  mode,
  onModeChange,
  onEdit,
  onSave,
  onUpload,
  renderEntrance,
  renderResult,
}: {
  config: Config;
  locked: boolean;
  busy: boolean;
  dirty: boolean;
  mode: State['published'];
  onModeChange: (mode: State['published']) => void;
  onEdit: (mutator: (c: Config) => void) => void;
  onSave: () => void;
  onUpload: (
    file: File | undefined,
    assign: (c: Config, url: string) => void,
  ) => void;
  renderEntrance: (mode: State['published']) => ReactNode;
  renderResult: (
    result: Result,
    options?: { showPageFlow?: boolean; admission?: Config['admission'] },
  ) => ReactNode;
}) {
  const [editing, setEditing] = useState<Page | null>(null);
  const disabled = locked || busy;
  const field = (key: TextKey | CopyTextKey, label: string, copy = false) => {
    const value = copy
      ? config.pageCopy[key as CopyTextKey]
      : config[key as TextKey];
    return (
      <label key={key} htmlFor={`page-text-${key}`}>
        {label}
        <Textarea
          id={`page-text-${key}`}
          value={value}
          disabled={disabled}
          rows={2}
          onChange={(e) =>
            onEdit((c) => {
              if (copy) c.pageCopy[key as CopyTextKey] = e.target.value;
              else c[key as TextKey] = e.target.value;
            })
          }
        />
      </label>
    );
  };
  const admissionField = (
    key: 'interviewMessage' | 'courseMessage' | 'note',
    label: string,
  ) => (
    <label key={key} htmlFor={`page-admission-${key}`}>
      {label}
      <Textarea
        id={`page-admission-${key}`}
        value={config.admission[key]}
        disabled={disabled}
        rows={2}
        onChange={(e) =>
          onEdit((c) => {
            if (key === 'interviewMessage') c.admission.interviewMessage = e.target.value;
            else if (key === 'courseMessage') c.admission.courseMessage = e.target.value;
            else c.admission.note = e.target.value;
          })
        }
      />
    </label>
  );
  const imageField = (key: ImageKey) => {
    const spec = PAGE_IMAGE_SPECS[key];
    return (
      <div className="page-image-field" key={key}>
        <label htmlFor={`page-image-${key}`}>{spec.label}</label>
        <p className="image-size-guide" id={`image-guide-${key}`}>
          <strong>标准尺寸：{spec.size}</strong>
          <br />
          {spec.detail}
          <br />
          PNG / JPEG / WebP，文件不超过2MB；尺寸为制作建议。
        </p>
        <input
          id={`page-image-${key}`}
          aria-describedby={`image-guide-${key}`}
          type="file"
          className="file-input"
          accept="image/png,image/jpeg,image/webp"
          disabled={disabled}
          onChange={(e) => {
            onUpload(e.target.files?.[0], (c, url) => {
              c[key] = url;
            });
            e.target.value = '';
          }}
        />
        {config[key] && (
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() =>
              onEdit((c) => {
                c[key] = '';
              })
            }
          >
            移除{spec.label}
          </Button>
        )}
      </div>
    );
  };
  const editorHeader = (page: Page, title: string) => (
    <>
      <h3>{title}</h3>
      <Button
        variant="outline"
        disabled={busy || (locked && editing !== page)}
        onClick={() => setEditing(editing === page ? null : page)}
      >
        {editing === page ? <X /> : <Pencil />}
        {editing === page ? '收起编辑' : `编辑${title}`}
      </Button>
      {locked && <p className="mini-label">查询开放中，请先关闭查询再编辑。</p>}
      {dirty && (
        <p className="mini-label">
          预览包含未保存修改；保存时统一保存这三个页面的当前配置。
        </p>
      )}
    </>
  );
  const save = (
    <Button disabled={disabled || !dirty} onClick={onSave}>
      <Save />
      保存页面配置
    </Button>
  );
  const badge = (
    <span className="pill">{dirty ? '未保存修改预览' : '已保存配置预览'}</span>
  );
  return (
    <>
      <section
        className="panel page-config-section"
        id="query-entrance-preview"
      >
        <div className="panel-title">
          <h2>01 · 小程序入口页</h2>
          {badge}
        </div>
        <div className="page-editor-preview">
          <div className="page-editor-fields">
            {editorHeader('query', '入口页文字')}
            {editing === 'query' ? (
              <div className="stack">
                {field('greeting', '欢迎大标题', true)}
                {field('welcome', '欢迎说明', true)}
                {field('queryTitle', '查询页标题')}
                {field('queryDescription', '查询页说明')}
                {field('closedMessage', '关闭查询提示')}
                {field('failedMessage', '姓名或考号不匹配提示')}
                {field('queryFooter', '入口页底部文字', true)}
                <p className="mini-label">
                  匹配失败提示仅在实际查询失败时出现。
                </p>
                {save}
              </div>
            ) : (
              <p className="muted">
                {config.queryTitle}
                <br />
                {config.queryDescription}
              </p>
            )}
          </div>
          <div className="page-preview-column">
            <div className="preview-mode-tabs" aria-label="入口效果预览状态">
              <Button
                variant={mode !== 'closed' ? 'default' : 'outline'}
                aria-pressed={mode !== 'closed'}
                onClick={() => onModeChange('formal')}
              >
                开放状态预览
              </Button>
              <Button
                variant={mode === 'closed' ? 'default' : 'outline'}
                aria-pressed={mode === 'closed'}
                onClick={() => onModeChange('closed')}
              >
                关闭状态预览
              </Button>
            </div>
            <p className="mini-label">
              仅切换页面效果，不改变实际查询开关。品牌logo位置留空。
            </p>
            {renderEntrance(mode)}
          </div>
        </div>
      </section>
      <section className="panel page-config-section">
        <div className="panel-title">
          <h2>02 · 查询内容页</h2>
          {badge}
        </div>
          <div className="page-editor-preview">
            <div className="page-editor-fields">
              <section className="page-editor-group">
                {editorHeader('student', '学生信息页')}
                {editing === 'student' && (
                  <div className="stack">
                    {field('examName', '考试名称（中英文可换行）')}
                    {save}
                  </div>
                )}
              </section>
              <section className="page-editor-group">
                {editorHeader('admission', '资格页')}
                {editing === 'admission' && (
                  <div className="stack">
                    {admissionField('courseMessage', '高阶入学资格文案')}
                    {admissionField('interviewMessage', '精修班口试资格文案')}
                    {admissionField('note', '资格页补充说明（选填）')}
                    {save}
                  </div>
                )}
              </section>
              <section className="page-editor-group">
                {editorHeader('content', '能力图与六维评价')}
                {editing === 'content' && (
                  <div className="stack">
                    {field('examInfo', '考试说明')}
                    {field('abilityHeading', '能力图标题（可换行）', true)}
                    <label htmlFor="ability-heading-font">
                      能力图标题字体
                      <select
                        id="ability-heading-font"
                        className="page-font-select"
                        value={config.pageCopy.abilityHeadingFont}
                        disabled={disabled}
                        onChange={(e) =>
                          onEdit((c) => {
                            c.pageCopy.abilityHeadingFont = e.target.value as Config['pageCopy']['abilityHeadingFont'];
                          })
                        }
                      >
                        <option value="rounded">圆体</option>
                        <option value="sans">无衬线</option>
                        <option value="serif">衬线体</option>
                      </select>
                    </label>
                    <label htmlFor="ability-heading-size">
                      能力图标题字号（32–72）
                      <Input
                        id="ability-heading-size"
                        type="number"
                        min={32}
                        max={72}
                        value={config.pageCopy.abilityHeadingSize}
                        disabled={disabled}
                        onChange={(e) =>
                          onEdit((c) => {
                            const size = Number(e.target.value);
                            c.pageCopy.abilityHeadingSize = Number.isFinite(size)
                              ? Math.min(72, Math.max(32, Math.round(size)))
                              : 48;
                          })
                        }
                      />
                    </label>
                    {field('abilitySubtitle', '能力图副标题', true)}
                    {field('learningHeading', '学习建议标题（可换行）', true)}
                    <label htmlFor="learning-heading-font">
                      学习建议标题字体
                      <select
                        id="learning-heading-font"
                        className="page-font-select"
                        value={config.pageCopy.learningHeadingFont}
                        disabled={disabled}
                        onChange={(e) =>
                          onEdit((c) => {
                            c.pageCopy.learningHeadingFont = e.target.value as Config['pageCopy']['learningHeadingFont'];
                          })
                        }
                      >
                        <option value="rounded">圆体</option>
                        <option value="sans">无衬线</option>
                        <option value="serif">衬线体</option>
                      </select>
                    </label>
                    <label htmlFor="learning-heading-size">
                      学习建议标题字号（28–72）
                      <Input
                        id="learning-heading-size"
                        type="number"
                        min={28}
                        max={72}
                        value={config.pageCopy.learningHeadingSize}
                        disabled={disabled}
                        onChange={(e) =>
                          onEdit((c) => {
                            const size = Number(e.target.value);
                            c.pageCopy.learningHeadingSize = Number.isFinite(size)
                              ? Math.min(72, Math.max(28, Math.round(size)))
                              : 44;
                          })
                        }
                      />
                    </label>
                    {field('learningLabel', '六维评价区标题', true)}
                    {imageField('headerImage')}
                    {imageField('footerImage')}
                    {save}
                  </div>
                )}
                <p className="mini-label">
                  六维评语沿用当前批次配置；配套评语在“试卷模板 → 评价管理”维护。
                </p>
              </section>
            </div>
          <div className="page-preview-column">
            <p className="preview-specimen-label">
              预览数据 · 非真实学生结果 · 未写入学生名单
            </p>
            <div
              className="content-page-preview"
              aria-label="内容页版式预览，可滚动查看六维评价"
            >
              {renderResult(layoutPreviewResult(config), {
                showPageFlow: true,
                admission: config.admission,
              })}
            </div>
          </div>
        </div>
      </section>
      <section className="panel page-config-section">
        <div className="panel-title">
          <h2>03 · 封底页</h2>
          {badge}
        </div>
        <div className="page-editor-preview">
          <div className="page-editor-fields">
            {editorHeader('cover', '封底文字与图片')}
            {editing === 'cover' ? (
              <div className="stack">
                {imageField('coverBackgroundImage')}
                {imageField('coverQrImage')}
                {field('coverText', '封底中心说明（选填）')}
                {field('coverFooter', '封底底部文字（选填）')}
                {save}
              </div>
            ) : (
              <p className="muted">
                底图与二维码分别管理。二维码可留空，默认使用红色底色。
              </p>
            )}
          </div>
          <div className="page-preview-column">
            <p className="mini-label">
              {config.coverQrImage
                ? '中心二维码完整显示'
                : '未上传二维码，不显示二维码区域'}
              ；无图片、无文字时，家长端不显示封底。
            </p>
            <BackCover config={config} preview />
          </div>
        </div>
      </section>
    </>
  );
}
