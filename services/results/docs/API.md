# HTTP接口契约（基础版）

所有响应默认`Cache-Control: no-store, private`。鉴权Cookie只用于后台，不提供给小程序。小程序无需微信用户登录，仅按业务要求匹配学生姓名+考号。

## 家长端

- `GET /api/public/status`：查询页文案、是否开放、演示标记、状态版本号；不含学生列表。
- `POST /api/public/query`：JSON `{ "name": "测试甲", "examNo": "000001" }`。
  - 返回本学生姓名、考试说明、六维展示系数/百分比、等级及三段评价、可选图片路径。
  - 不返回考号、原始分、总分、排名、平均分、其他学生或历史记录。
  - 关闭时403；身份不匹配404；输入错误400；查询状态改变409；频繁查询429。
- `GET /api/assets/:id`：只公开当前已发布配置引用的图片。关闭时未登录用户无法获取，后台登录用户可预览。

姓名与考号只进入POST请求体，不拼到网址、页面路由、缓存键或日志中。服务端限流键使用考号散列，应用不记录查询内容。

## 后台

除登录外均须会话Cookie。写入请求要求`X-Exam-Request: 1`，携带Origin时须同源；不开放跨域CORS。

| 方法与路径                          | 用途                                                 |
| ----------------------------------- | ---------------------------------------------------- |
| POST /api/admin/login               | 管理员口令登录，返回HttpOnly、SameSite=Strict Cookie |
| POST /api/admin/logout              | 撤销当前会话                                         |
| GET /api/admin/state                | 当前考试、配置、版本、批次与正式发布待办             |
| PUT /api/admin/config               | `{revision, config, confirmAnalysis?}`；变更Part规则且已有学生时须明确确认并通过全名单兼容校验 |
| GET /api/admin/template?format=xlsx | Excel空模板；format=csv支持CSV；可选analysisTemplateId生成对应试卷表头 |
| POST /api/admin/import              | multipart：file、revision、isDemo=true/false、可选analysisTemplateId；校验通过后原子切换规则及名单 |
| GET /api/admin/templates | 列出持久保存的分析/评价/等级阈值模板 |
| POST /api/admin/templates | `{name, payload:{kind:"analysis"/"evaluation"/"thresholds",data}}`另存模板，不修改考试 |
| PUT /api/admin/templates | `{id,name,revision}`重命名，拒绝同名/过期版本 |
| DELETE /api/admin/templates | `{id,revision,confirmDelete:true}`；仅删除指定模板副本，过期或已删除返回409，不删除图片/考试/学生 |
| POST /api/admin/papers/apply | `{revision,paperTemplateId,paperRevision,confirmApply:true}`；应用已保存套卷到当前考试，保留名单与原始成绩；考试及模板版本须同时匹配 |
| PUT /api/admin/thresholds | `{revision,data,confirmApply:true}`；只在关闭查询时应用完整阈值模板，保留其他配置与原始成绩 |
| GET /api/admin/evaluation-template | 24行评价Excel空模板，filled=1导出当前已保存正文 |
| POST /api/admin/evaluations-preview | multipart：file、revision；返回24套预览、warnings及映射后的data，不写当前配置 |
| GET /api/admin/students?page=1      | 当前批次分页列表，每页50人，仅后台可见总分           |
| POST /api/admin/preview             | `{name, examNo}`；不受家长端开关限制                 |
| POST /api/admin/publish             | `{revision, mode: "closed" / "demo" / "formal"}`     |
| POST /api/admin/assets              | multipart图片file；返回相对路径，需再保存配置引用    |

配置编辑与成绩替换只允许在关闭查询时执行。版本号冲突返回409，不覆盖别人刚完成的操作。导入校验失败422并返回`issues`数组（最多100条）；整批数据不变。

模板保存、重命名、删除与Excel预览允许在开放查询时进行，因为不影响当前考试。载入评价模板只改变前端编辑区，仍须保存config才生效。旧`import-demo`接口已移除，demo下载参数不再产生样例。

等级阈值模板包含六个固定标识/顺序的维度（id、说明用name、四级rules），不包含Part、满分、评语或学生。阈值须覆盖0～1，无重叠且最多一位小数。应用时name只作映射说明，不改当前维度名称；确认状态设为true。删除采用模板独立revision保护，与考试revision无关。

分析模板包含analysis（Part及六维映射）、六维rules、thresholdsConfirmed。评价模板包含paragraphTitles和六维24套evaluations（文字、标题、图片引用），不包含规则或成绩。维度固定标识/顺序不变，显示名称可改。旧config无analysis字段时兼容补入初始80分规则，不写回或覆盖旧字段。

## 存储适配

`lib/store.ts`的Database/Statement接口目前由D1绑定提供，测试使用SQLite事务适配。若复用腾讯云数据库，应实现等价的原子批次替换、版本冲突控制和精确查询语义，而非直接把D1接口当成腾讯云SDK。

本地模拟数据保存在项目`.wrangler/`，不是浏览器localStorage。线上备份、审计记录、保留期清理需要根据最终部署方案补充。

资格结果是套卷固定组成部分，默认计算和显示。旧 `admission.enabled=false` 在配置、模板及文件读取时规范为 true；六维系数线及文案保留原值。`admission.oralInterviewCutoff` 为选填总分线，默认 `null`（页面留空，不自动设为 0）；缺少此字段的旧配置或模板也补为 `null`。留空时仅要求六个维度的完整原始系数均达线；填入数值时，还须总分大于等于该值。已填总分线在模板保存、导出、导入及应用时保留；清空后保存为 `null`。家长查询开放状态仍由 `published` 控制。
