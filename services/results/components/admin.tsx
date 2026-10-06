'use client';
import { useEffect, useState } from 'react';
import {
  BookOpen,
  ShieldCheck,
  Upload,
  Search,
  Settings,
  LayoutDashboard,
  LogOut,
  LockKeyhole,
  Download,
  Save,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { PublicationPanel } from './publication-panel';
import { StudentEntry } from './student-entry';
import { StudentInformationEditor, type InformationStudent } from './student-information-editor';
import { normalizeYearLevel, studentInformationIssues, type StudentInformationSummary } from '@/lib/student-information';
import { ReportExport } from './report-export';
import { ReportPages } from './report-pages';
import { StudentReportPreview, type StudentPreviewLayout } from './student-report-preview';
import { api, RequestError } from '@/lib/client';
import { TemplateSelect } from './template-library';
import { PaperWorkspace } from './paper-workspace';
import type { SavedTemplate } from '@/lib/templates';
import { ConfirmProvider, useConfirm } from './confirm-action';
import { fullMark, type Config, type State, type Result } from '@/lib/domain';
import {
  directPageNumbers,
  locateStudentInList,
  type AdminStudentMatch,
} from '@/lib/student-list';

type Snapshot = State & {
  readiness: string[];
  demoAllowed: boolean;
  formalAllowed: boolean;
};
type Tab = 'home' | 'import' | 'students' | 'papers' | 'settings';
type AdminPreviewResult = Result & {
  adminMatch: AdminStudentMatch;
};
const tabs = [
  { id: 'home' as Tab, label: '工作台', icon: LayoutDashboard, group: '总览' },
  { id: 'papers' as Tab, label: '试卷模板', icon: BookOpen, group: '教学支撑' },
  { id: 'import' as Tab, label: '成绩导入', icon: Upload, group: '行政服务' },
  { id: 'students' as Tab, label: '学生预览', icon: Search, group: '行政服务' },
  {
    id: 'settings' as Tab,
    label: '配置与发布',
    icon: Settings,
    group: '行政服务',
  },
];
function Check({
  checked,
  onChange,
  children,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="check-row">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        disabled={disabled}
      />
      <span>{children}</span>
    </label>
  );
}
export function ResultView({
  result,
}: {
  result: Result;
  showCover?: boolean;
  showPageFlow?: boolean;
  admission?: Config['admission'];
}) {
  return (
    <div className="parent-preview report-preview-shell">
      <ReportPages result={result} />
    </div>
  );
}

export default function Admin() {
  return (
    <ConfirmProvider>
      <AdminScreen />
    </ConfirmProvider>
  );
}
function AdminScreen() {
  const confirm = useConfirm();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [login, setLogin] = useState(false);
  const [password, setPassword] = useState('');
  const [tab, setTab] = useState<Tab>('home');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [dirty, setDirty] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const [paperTemplateId, setPaperTemplateId] = useState('');
  const [paperRevision, setPaperRevision] = useState<number | null>(null);
  const [paperDirty, setPaperDirty] = useState(false);
  const [entryDirty, setEntryDirty] = useState(false);
  const [informationDirty, setInformationDirty] = useState(false);
  const [informationStudent, setInformationStudent] = useState<InformationStudent | null>(null);
  const [importDefaultInitialized, setImportDefaultInitialized] =
    useState(false);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [name, setName] = useState('');
  const [examNo, setExamNo] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [studentPreviewLayout, setStudentPreviewLayout] = useState<StudentPreviewLayout>('horizontal');
  const [students, setStudents] = useState<
    { examNo: string; name: string; total: string; branch?: string; className?: string; examSession?: string; yearLevel?: string }[]
  >([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [studentsKey, setStudentsKey] = useState('');
  const [selectedExamNos, setSelectedExamNos] = useState<string[]>([]);
  const [admissionSummary, setAdmissionSummary] = useState<{
    enabled: boolean;
    total: number;
    interviewCount: number;
  } | null>(null);
  const currentPage = Math.min(
    page,
    Math.max(1, Math.ceil((snapshot?.count ?? 0) / pageSize)),
  );
  const studentRequestKey = `${snapshot?.revision}:${currentPage}:${pageSize}`;
  if (!importDefaultInitialized && !busy) {
    const preferred = templates.find(
      (t) =>
        t.kind === 'paper' &&
        ['学业水平统测｜英语2608', '学业水平统测｜2608'].includes(t.name),
    );
    if (preferred) {
      setImportDefaultInitialized(true);
      setPaperTemplateId(preferred.id);
      setPaperRevision(preferred.revision);
    }
  }
  async function reloadTemplates() {
    const next = (await api<{ templates: SavedTemplate[] }>('templates'))
      .templates;
    setTemplates(next);
    return next;
  }
  async function selectAllStudents() {
    if (!snapshot) return;
    const all = await api<{ students: { examNo: string }[] }>(
      `students?page=1&pageSize=${snapshot.count}&all=true`,
    );
    setSelectedExamNos(all.students.map((student) => student.examNo));
  }
  async function openStudentInformation(targetExamNo: string) {
    if (!snapshot?.batchId) return;
    if (entryDirty && !(await confirm('有未保存的学生补录内容，确定放弃输入并打开信息补充？'))) return;
    if (informationDirty && !(await confirm('当前有未保存的补充信息，确定放弃输入并打开另一名学生？'))) return;
    const all = await api<{ students: typeof students }>(`students?page=1&pageSize=${snapshot.count}&all=true`);
    const index = all.students.findIndex((student) => student.examNo === targetExamNo);
    if (index < 0) throw new Error('未找到该学生，请刷新名单');
    setTab('students');
    setEntryDirty(false);
    setResult(null);
    setPage(Math.floor(index / pageSize) + 1);
    setInformationStudent({ ...all.students[index], revision: snapshot.revision, batchId: snapshot.batchId, sessionKey: crypto.randomUUID() });
    setInformationDirty(false);
    setSuccess(locked ? '当前成绩已开放查询，请先关闭查询再保存补充信息。' : '请在名单上方补充该学生的信息。');
  }
  async function previewAndLocateStudent() {
    const preview = await api<AdminPreviewResult>('preview', 'POST', { name, examNo });
    const location = locateStudentInList(selectedExamNos, preview.adminMatch, pageSize);
    setResult(preview);
    setSelectedExamNos(location.selectedExamNos);
    setPage(location.page);
    setSuccess(`已定位并勾选 ${preview.adminMatch.examNo}，可直接使用下方导出功能。`);
  }
  const latestImportPaper = templates.find(
    (t) => t.id === paperTemplateId && t.kind === 'paper',
  );
  if (
    !busy &&
    latestImportPaper &&
    latestImportPaper.revision !== paperRevision
  ) {
    setPaperRevision(latestImportPaper.revision);
    setFile(null);
    setReplaceConfirmed(false);
    if (file) setSuccess('套卷已更新，请重新下载成绩表并选择文件。');
  }
  async function refresh() {
    const s = await api<Snapshot>('state');
    await reloadTemplates();
    setSnapshot(s);
    setConfig(structuredClone(s.config));
    setDirty(false);
    setLogin(false);
    return s;
  }
  useEffect(() => {
    let active = true;
    api<Snapshot>('state')
      .then((s) => {
        if (!active) return;
        setSnapshot(s);
        setConfig(structuredClone(s.config));
        setDirty(false);
        setLogin(false);
        void reloadTemplates().catch((e: Error) => setError(e.message));
      })
      .catch((e) => {
        if (!active) return;
        if (e.status === 401) setLogin(true);
        else setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!dirty && !informationDirty) return;
    const listener = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  }, [dirty, informationDirty]);
  useEffect(() => {
    let active = true;
    if (!snapshot || (tab !== 'students' && tab !== 'import')) return;
    api<{ enabled: boolean; total: number; interviewCount: number }>('admission-summary')
      .then((summary) => { if (active) setAdmissionSummary(summary); })
      .catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [snapshot, tab]);
  useEffect(() => {
    let active = true;
    if ((tab === 'students' || tab === 'import') && snapshot) {
      api<{ students: typeof students }>(
        `students?page=${currentPage}&pageSize=${pageSize}`,
      )
        .then((r) => {
          if (!active) return;
          setStudents(r.students);
          setStudentsKey(studentRequestKey);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }
    return () => {
      active = false;
    };
  }, [tab, currentPage, pageSize, snapshot, studentRequestKey]);
  async function act(fn: () => Promise<void>, message = '') {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await fn();
      if (message) setSuccess(message);
    } catch (e) {
      if (e instanceof RequestError && e.status === 401) {
        setLogin(true);
        setSnapshot(null);
        setConfig(null);
        setResult(null);
        setStudents([]);
      }
      setError(e instanceof Error ? e.message : '操作未完成，请重试');
    } finally {
      setBusy(false);
    }
  }
  const locked = snapshot?.published !== 'closed';
  function edit(mutator: (c: Config) => void) {
    if (!config || locked) return;
    const next = structuredClone(config);
    mutator(next);
    setConfig(next);
    setDirty(true);
    setSuccess('');
  }
  async function saveConfig() {
    if (!snapshot || !config) return;
    await api('config', 'PUT', { revision: snapshot.revision, config });
    await refresh();
    setResult(null);
  }
  async function nav(next: Tab) {
    if (next === tab) return;
    if (
      (entryDirty || informationDirty) &&
      !(await confirm('有未保存的学生信息，确定离开并放弃输入？'))
    )
      return;
    if (
      tab === 'papers' &&
      paperDirty &&
      !(await confirm(
        '本套卷有未保存修改，仍要离开并放弃修改吗？已保存的模板和学生不变。',
      ))
    )
      return;
    setTab(next);
    setEntryDirty(false);
    setInformationDirty(false);
    setInformationStudent(null);
    if (next === 'import')
      void reloadTemplates().catch((e: Error) => setError(e.message));
    setError('');
    setSuccess('');
  }
  async function uploadImage(
    file: File | undefined,
    assign: (c: Config, url: string) => void,
  ) {
    if (!file) return;
    await act(async () => {
      const form = new FormData();
      form.set('file', file);
      const r = await api<{ url: string }>('assets', 'POST', form);
      edit((c) => assign(c, r.url));
    }, '图片已上传；请保存配置后生效。');
  }
  if (loading) return <main className="loading">正在载入考试管理后台…</main>;
  if (login)
    return (
      <main className="login">
        <BookOpen size={30} color="#23664f" />
        <p className="eyebrow" style={{ marginTop: 20 }}>
          EXAM · SIX DIMENSIONS
        </p>
        <h1>欢迎进入考试管理后台</h1>
        <p className="muted">使用本机独立生成的管理员口令登录。</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await api('login', 'POST', { password });
              setPassword('');
              await refresh();
            });
          }}
        >
          <label htmlFor="admin-password">
            管理员口令
            <Input
              id="admin-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy} size="lg">
            <LockKeyhole />
            {busy ? '正在登录…' : '进入管理后台'}
          </Button>
        </form>
        <p className="mini-label" style={{ marginTop: 20 }}>
          本地口令位于项目 .local/admin-login.txt，不在网页中公开显示。
        </p>
      </main>
    );
  if (!snapshot || !config)
    return (
      <main className="login">
        <h1>暂时无法连接后台</h1>
        <p className="error">{error}</p>
        <Button
          onClick={() =>
            void act(async () => {
              await refresh();
            })
          }
        >
          重新连接
        </Button>
      </main>
    );
  const selectedPaper = templates.find(
    (t) => t.id === paperTemplateId && t.kind === 'paper',
  );
  const downloadQuery = paperTemplateId
    ? `&paperTemplateId=${encodeURIComponent(paperTemplateId)}&paperRevision=${paperRevision}`
    : '';
  const paperStale =
    !!paperTemplateId &&
    (!selectedPaper || selectedPaper.revision !== paperRevision);
  const stateLabel =
    snapshot.published === 'closed'
      ? '未开放'
      : snapshot.published === 'demo'
        ? '演示开放'
        : '正式开放';
  const saveButton = (
    <Button
      onClick={() => void act(saveConfig, '配置已保存。')}
      disabled={busy || locked || !dirty}
    >
      <Save />
      保存配置{dirty ? ' *' : ''}
    </Button>
  );
  const studentTable = (
    <div className="panel">
      <div className="panel-title">
        <h2>当前批次 · {snapshot.count} 名学生</h2>
        <span className="mini-label">仅后台可见总分</span>
      </div>
      {admissionSummary && (
        <div className="notice" style={{ marginTop: 12 }}>
          {`精修班口试资格统计：${admissionSummary.interviewCount} / ${admissionSummary.total} 名学生达到当前分数线。`}
        </div>
      )}
      {informationStudent && <StudentInformationEditor
        key={informationStudent.sessionKey}
        student={informationStudent} currentRevision={snapshot.revision} disabled={busy || locked || dirty}
        onBusyChange={setBusy} onDirtyChange={setInformationDirty}
        onSaved={async () => { await refresh(); setInformationStudent(null); setInformationDirty(false); setResult(null); setSuccess('学生信息已补充保存；导出时会使用当前信息并保留原始导入内容。'); }}
        onCancel={() => { void (async () => { if (informationDirty && !(await confirm('有未保存的补充信息，确定关闭并放弃输入？'))) return; setInformationStudent(null); setInformationDirty(false); })(); }}
      />}
      <ReportExport count={snapshot.count} revision={snapshot.revision} batchId={snapshot.batchId} examName={snapshot.config.examName} sourceFileName={snapshot.sourceFileName} disabled={busy || dirty || informationDirty} onBusyChange={setBusy} selectedExamNos={selectedExamNos} onFillInformation={openStudentInformation} />
      {!!snapshot.count && <div className="actions" style={{ marginTop: 12 }}>
        <Button size="sm" variant="outline" disabled={busy || selectedExamNos.length === snapshot.count} onClick={() => void act(selectAllStudents)}>全选全部学生</Button>
        <Button size="sm" variant="ghost" disabled={busy || !selectedExamNos.length} onClick={() => setSelectedExamNos([])}>取消全部选择</Button>
      </div>}
      {!!selectedExamNos.length && <p className="mini-label">已选择 {selectedExamNos.length} 名学生；取消全部选择后可恢复导出当前批次全部学生。</p>}
      {!snapshot.count ? (
        <div className="empty">还没有导入成绩</div>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>选择</th>
                  <th>考号</th>
                  <th>学生姓名</th>
                  <th>分校名称</th>
                  <th>班级名称</th>
                  <th>笔试时间</th>
                  <th>年级</th>
                  <th>总分 / {fullMark(snapshot.config.analysis)}</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {studentsKey !== studentRequestKey ? (
                  <tr>
                    <td colSpan={9}>
                      <output>正在载入学生名单…</output>
                    </td>
                  </tr>
                ) : (
                  students.map((s) => (
                    <tr key={s.examNo}>
                      <td>
                        <Checkbox
                          aria-label={`选择${s.name}`}
                          checked={selectedExamNos.includes(s.examNo)}
                          disabled={busy}
                          onCheckedChange={(checked) => setSelectedExamNos((current) => checked === true ? [...new Set([...current, s.examNo])] : current.filter((examNo) => examNo !== s.examNo))}
                        />
                      </td>
                      <td>{s.examNo}</td>
                      <td>{s.name}</td>
                      <td>{s.branch || '待补充'}</td>
                      <td>{s.className || '待补充'}</td>
                      <td>{s.examSession || '待补充'}</td>
                      <td>{normalizeYearLevel(s.yearLevel) || '待补充'}{studentInformationIssues(s).some((issue) => issue.field === 'yearLevel' && normalizeYearLevel(s.yearLevel)) && <small> · 需核对</small>}</td>
                      <td>{s.total}</td>
                      <td>
                        <Button size="sm" variant="ghost" disabled={busy || dirty || locked} onClick={() => void act(() => openStudentInformation(s.examNo))}>补充信息{studentInformationIssues(s).length ? `（${studentInformationIssues(s).length} 项待完善）` : ''}</Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => {
                            setName(s.name);
                            setExamNo(s.examNo);
                            setResult(null);
                            setTab('students');
                            void act(async () =>
                              setResult(
                                await api<Result>('preview', 'POST', {
                                  name: s.name,
                                  examNo: s.examNo,
                                }),
                              ),
                            );
                          }}
                        >
                          查看六维评价
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="actions student-pagination">
            <label className="page-size-control" htmlFor="student-page-size">
              每页显示
              <Select
                value={String(pageSize)}
                disabled={busy}
                onValueChange={(v) => {
                  if (!v) return;
                  setPageSize(Number(v));
                  setPage(1);
                }}
              >
                <SelectTrigger id="student-page-size" aria-label="每页学生人数">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10, 20, 30, 40, 50].map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size} 名学生
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <Button
              variant="outline"
              disabled={currentPage === 1 || busy}
              onClick={() => setPage(currentPage - 1)}
            >
              上一页
            </Button>
            <div className="pagination-pages" aria-label="学生名单页码">
              {directPageNumbers(
                currentPage,
                Math.max(1, Math.ceil(snapshot.count / pageSize)),
              ).map((pageNumber, index, pages) => (
                <span className="pagination-page-item" key={pageNumber}>
                  {index > 0 && pageNumber - pages[index - 1] > 1 && (
                    <span className="pagination-ellipsis" aria-hidden="true">…</span>
                  )}
                  <Button
                    size="sm"
                    variant={pageNumber === currentPage ? 'default' : 'outline'}
                    aria-label={`第 ${pageNumber} 页`}
                    aria-current={pageNumber === currentPage ? 'page' : undefined}
                    disabled={busy || pageNumber === currentPage}
                    onClick={() => setPage(pageNumber)}
                  >
                    {pageNumber}
                  </Button>
                </span>
              ))}
            </div>
            <span className="muted">
              第 {currentPage} /{' '}
              {Math.max(1, Math.ceil(snapshot.count / pageSize))} 页
            </span>
            <Button
              variant="outline"
              disabled={currentPage * pageSize >= snapshot.count || busy}
              onClick={() => setPage(currentPage + 1)}
            >
              下一页
            </Button>
          </div>
        </>
      )}
    </div>
  );
  return (
    <main className="workspace">
      <aside className="sidebar">
        <div className="brand">
          <BookOpen size={24} />
          <div>
            考试结果管理<small>EXAM · SIX DIMENSIONS</small>
          </div>
        </div>
        <nav>
          {['总览', '教学支撑', '行政服务'].map((group) => (
            <div className="nav-group" key={group}>
              <p className="nav-group-label">{group}</p>
              {tabs
                .filter((t) => t.group === group)
                .map((t) => (
                  <button
                    key={t.id}
                    className={tab === t.id ? 'nav-active' : ''}
                    disabled={busy}
                    aria-current={tab === t.id ? 'page' : undefined}
                    onClick={() => nav(t.id)}
                  >
                    <t.icon size={17} />
                    {t.label}
                  </button>
                ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <ShieldCheck size={16} />{' '}
          {snapshot.demoAllowed ? '本地开发环境' : '受控服务环境'}
          <br />
          未连接旧系统
          <br />
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={async () => {
              if (
                (dirty || paperDirty || entryDirty || informationDirty) &&
                !(await confirm('有尚未保存的修改，确定退出？'))
              )
                return;
              void act(async () => {
                await api('logout', 'POST');
                setLogin(true);
                setSnapshot(null);
                setConfig(null);
                setResult(null);
                setStudents([]);
              });
            }}
          >
            <LogOut size={14} />
            退出登录
          </Button>
        </div>
      </aside>
      <section className="content">
        <header className="topbar">
          <span>{tabs.find((t) => t.id === tab)?.label}</span>
          <span className="pill">
            V2.0 · {stateLabel}
            {dirty ? ' · 有未保存配置' : ''}
          </span>
        </header>
        <div className="page-body">
          <div className="heading">
            <div>
              <p className="eyebrow">考试结果发布</p>
              <h1>
                {tab === 'home'
                  ? '每一份成长，都值得看见。'
                  : tab === 'import'
                    ? '从一份成绩表开始'
                    : tab === 'students'
                      ? '核对每一位学生的六维结果'
                      : tab === 'papers'
                        ? '一套试卷，一份完整配置'
                        : '准备好，再开放查询'}
              </h1>
              <p className="muted">
                {tab === 'papers'
                  ? '教学支撑 · 维护配套试卷，保存为后续考试默认版本'
                  : snapshot.config.examName}
              </p>
            </div>
            {tab === 'settings' ? saveButton : null}
          </div>
          {tab !== 'home' && (
            <div className="notice">
              本地基础版 ·
              测试评价不代表正式结论；上线资料与正式业务内容补齐后再验收。
            </div>
          )}
          {error && (
            <div
              className="error"
              role="alert"
              style={{ whiteSpace: 'pre-wrap' }}
            >
              {error}
            </div>
          )}
          {success && (
            <output className="success" style={{ display: 'block' }}>
              {success}
            </output>
          )}
          {tab === 'home' && (
            <div className="stats">
              <section>
                <small>当前查询状态</small>
                <strong className="status-text">{stateLabel}</strong>
              </section>
              <section>
                <small>当前使用的试卷模板</small>
                <strong className="template-stat">
                  {snapshot.config.paperSource?.name ??
                    '当前考试配置（未关联套卷）'}
                </strong>
              </section>
              <section>
                <small>当前批次学生人数</small>
                <strong>
                  {snapshot.count}
                  <i> 人</i>
                </strong>
              </section>
            </div>
          )}
          {tab === 'import' && (
            <>
              <section className="panel">
                <div className="panel-title">
                  <h2>01 · 选择配套试卷，下载成绩表</h2>
                  <span className="pill">Excel / CSV</span>
                </div>
                <TemplateSelect
                  templates={templates.filter((t) => t.kind === 'paper')}
                  value={paperTemplateId}
                  disabled={busy}
                  label="本批次使用的配套试卷"
                  empty="当前批次已使用的试卷配置"
                  onChange={(id) =>
                    void act(async () => {
                      setImportDefaultInitialized(true);
                      const available = await reloadTemplates();
                      const chosen = available.find(
                        (t) => t.id === id && t.kind === 'paper',
                      );
                      if (id && !chosen)
                        throw new Error('该套卷已删除，请选择其他试卷。');
                      setPaperTemplateId(id);
                      setPaperRevision(chosen?.revision ?? null);
                      setFile(null);
                      setReplaceConfirmed(false);
                    })
                  }
                />
                {paperStale && (
                  <p className="error">
                    本套卷已更新或删除，请重新选择套卷并下载对应成绩表。
                  </p>
                )}
                <div className="actions import-downloads">
                  <a
                    download
                    className="download"
                    href={`/api/admin/template?format=xlsx${downloadQuery}`}
                  >
                    <Download size={16} />
                    Excel空模板
                  </a>
                  <a
                    download
                    className="download"
                    href={`/api/admin/template?format=csv${downloadQuery}`}
                  >
                    <Download size={16} />
                    CSV空模板
                  </a>
                </div>
              </section>
              <section className="panel">
                <h2>02 · 上传成绩并整批替换</h2>
                {locked && (
                  <p className="notice" style={{ marginTop: 20 }}>
                    当前查询已开放。请先到“配置与发布”关闭查询，再替换成绩。
                  </p>
                )}
                <div className="stack" style={{ marginTop: 20 }}>
                  <label>
                    成绩文件
                    <input
                      key={`${paperTemplateId}:${paperRevision}`}
                      className="file-input"
                      type="file"
                      accept=".xlsx,.csv"
                      disabled={locked || busy}
                      onChange={(e) => {
                        setFile(e.target.files?.[0] ?? null);
                        setReplaceConfirmed(false);
                      }}
                    />
                    <span className="field-note">
                      学生姓名仅使用中文名；考号请保留开头的0。
                    </span>
                  </label>
                  <fieldset
                    className="import-data-kind"
                    disabled={locked || busy}
                  >
                    <legend>数据类型</legend>
                    <label>
                      <input
                        type="radio"
                        name="import-data-kind"
                        value="formal"
                        checked={!isDemo}
                        onChange={() => setIsDemo(false)}
                      />
                      真实数据
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="import-data-kind"
                        value="demo"
                        checked={isDemo}
                        onChange={() => setIsDemo(true)}
                      />
                      测试数据
                    </label>
                  </fieldset>
                  <Check
                    checked={replaceConfirmed}
                    onChange={setReplaceConfirmed}
                    disabled={locked || busy}
                  >
                    我确认：校验成功后，将替换当前全部学生成绩；失败则保留原数据。
                  </Check>
                </div>
                <div className="actions">
                  <Button
                    disabled={
                      !file ||
                      !replaceConfirmed ||
                      locked ||
                      busy ||
                      dirty ||
                      entryDirty ||
                      paperStale
                    }
                    onClick={() =>
                      void act(async () => {
                        const form = new FormData();
                        form.set('file', file!);
                        form.set('revision', String(snapshot.revision));
                        form.set('isDemo', String(isDemo));
                        if (paperTemplateId) {
                          form.set('paperTemplateId', paperTemplateId);
                          form.set('paperRevision', String(paperRevision));
                        }
                        const r = await api<{ count: number; information: StudentInformationSummary }>(
                          'import',
                          'POST',
                          form,
                        );
                        setSuccess(`已成功导入 ${r.count} 名学生。${r.information?.issueCount ? `其中 ${r.information.studentCount} 名学生有 ${r.information.issueCount} 项信息待补充或核对，可在学生名单中稍后完善。` : ''}`);
                        setPage(1);
                        setResult(null);
                        setReplaceConfirmed(false);
                        await refresh();
                      })
                    }
                  >
                    <Upload />
                    {busy ? '正在校验…' : '校验并替换成绩'}
                  </Button>
                </div>
                {dirty && (
                  <p className="mini-label">请先保存未完成的配置修改。</p>
                )}
              </section>
              <StudentEntry
                snapshot={snapshot}
                busy={busy}
                configDirty={dirty}
                onBusyChange={setBusy}
                onDirtyChange={setEntryDirty}
                onSaved={async () => {
                  setPage(1);
                  setResult(null);
                  await refresh();
                }}
              />
              {studentTable}
            </>
          )}
          {tab === 'students' && (
            <>
              <section className="panel">
                <h2>学生查询</h2>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    setResult(null);
                    void act(previewAndLocateStudent);
                  }}
                >
                  <div className="form-grid" style={{ marginTop: 20 }}>
                    <label htmlFor="student-name">
                      学生中文姓名
                      <Input
                        id="student-name"
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value);
                          setResult(null);
                        }}
                        maxLength={40}
                      />
                    </label>
                    <label htmlFor="student-exam-no">
                      考号
                      <Input
                        id="student-exam-no"
                        value={examNo}
                        onChange={(e) => {
                          setExamNo(e.target.value);
                          setResult(null);
                        }}
                        maxLength={64}
                      />
                    </label>
                  </div>
                  <div className="actions">
                    <Button type="submit" disabled={busy}>
                      <Search />
                      查找、勾选并预览
                    </Button>
                    <span className="mini-label">
                      姓名或考号任填一项即可；同名学生请补充考号。后台预览不受家长端发布开关限制。
                    </span>
                  </div>
                </form>
              </section>
              {result && (
                <StudentReportPreview
                  result={result}
                  layout={studentPreviewLayout}
                  onLayoutChange={setStudentPreviewLayout}
                />
              )}
              <div style={{ marginTop: 24 }}>{studentTable}</div>
            </>
          )}
          {tab === 'papers' && (
            <PaperWorkspace
              config={snapshot.config}
              templates={templates}
              reload={async () => {
                await reloadTemplates();
              }}
              onDirtyChange={setPaperDirty}
              onBusyChange={setBusy}
              applyDisabled={locked || dirty || entryDirty || informationDirty}
              onApply={async (paper) => {
                if (locked) throw new Error('请先关闭查询，再应用试卷配置。');
                if (dirty || entryDirty || informationDirty)
                  throw new Error('请先保存当前页面配置和学生信息，再应用试卷。');
                if (!(await confirm(
                  `将“${paper.name}”的已保存版本用于当前考试？资格结果会按这套卷的总分线、六维线和文案显示，六维评价也使用本套卷配置。当前 ${snapshot.count} 名学生的名单及原始分数保留。`,
                ))) return false;
                await api('papers/apply', 'POST', {
                  revision: snapshot.revision,
                  paperTemplateId: paper.id,
                  paperRevision: paper.revision,
                  confirmApply: true,
                });
                await refresh();
                setResult(null);
                setImportDefaultInitialized(true);
                setPaperTemplateId(paper.id);
                setPaperRevision(paper.revision);
                setFile(null);
                setReplaceConfirmed(false);
                setSuccess('本套卷已用于当前考试，资格结果和六维评价已按本套卷配置更新。');
                return true;
              }}
            />
          )}
          {tab === 'settings' && (
            <>
              <PublicationPanel
                status={snapshot}
                config={config}
                busy={busy}
                dirty={dirty}
                onEdit={edit}
                onSave={() => void act(saveConfig, '页面配置已保存。')}
                onUpload={(file, assign) => void uploadImage(file, assign)}
                renderResult={(preview, options) => (
                  <ResultView
                    result={preview}
                    showCover={false}
                    showPageFlow={options?.showPageFlow}
                    admission={options?.admission}
                  />
                )}
                onPublish={(mode) =>
                  void act(async () => {
                    if (
                      mode !== 'closed' &&
                      !(await confirm(
                        mode === 'formal'
                          ? '确认正式开放小程序查询？家长将可查询本批次结果。'
                          : '确认开放演示查询？当前批次结果将可通过演示接口查询，页面会标记为非正式结果。',
                      ))
                    )
                      return;
                    await api('publish', 'POST', {
                      revision: snapshot.revision,
                      mode,
                    });
                    // Closing must preserve any unsaved page text.
                    if (mode === 'closed')
                      setSnapshot(await api<Snapshot>('state'));
                    else await refresh();
                    setSuccess(
                      mode === 'closed'
                        ? '查询已关闭。'
                        : mode === 'demo'
                          ? '演示查询已开放。'
                          : '正式小程序查询已开放。',
                    );
                  })
                }
              />
              <section className="panel">
                <h2>发布前确认</h2>
                <div className="stack" style={{ marginTop: 24 }}>
                  <Check
                    checked={config.thresholdsConfirmed}
                    disabled={locked || busy}
                    onChange={(v) =>
                      edit((c) => {
                        c.thresholdsConfirmed = v;
                      })
                    }
                  >
                    我方已确认六维全部阈值，原始系数0～1无空档、无重叠
                  </Check>
                  <Check
                    checked={config.contentConfirmed}
                    disabled={locked || busy}
                    onChange={(v) =>
                      edit((c) => {
                        c.contentConfirmed = v;
                      })
                    }
                  >
                    我方已核对24套正式评价，三段内容均已填写且不含测试占位
                  </Check>
                </div>
                <div className="actions">{saveButton}</div>
              </section>
              <section className="panel">
                <h2>尚待到位</h2>
                <div className="stack" style={{ marginTop: 18 }}>
                  {snapshot.readiness.map((x) => (
                    <p className="muted" key={x}>
                      ○ {x}
                    </p>
                  ))}
                  <p className="muted">○ 小程序 AppID、管理员及体验成员权限</p>
                  <p className="muted">
                    ○ 旧系统源码与云资源清查、正式环境选型
                  </p>
                  <p className="muted">
                    ○ 微信真机联调、隐私说明、安全与容量验收
                  </p>
                </div>
              </section>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
