# Windows 桌面预览版

版本：**2.1.0-beta.1**。目标系统为 **Windows 10 / Windows 11 x64**。这是 Windows 桌面预览版，实际 Win10/11 安装、操作及卸载的人工验收尚待进行；V2.0（2.0.0）稳定版的标签和发布材料继续保留，见 [V2.0 发布说明](V2.0发布说明_2026-10-04.md)。

## 安装与启动

发布包提供两种使用方式：

| 文件 | 使用方式 |
| --- | --- |
| `Joy-Exam-System-2.1.0-beta.1-Windows-x64-Setup.exe` | 运行安装向导，按当前 Windows 账户安装，然后从“佳音考试管理”快捷方式启动。 |
| `Joy-Exam-System-2.1.0-beta.1-Windows-x64.zip` | 将整个 ZIP 完整解压到本机目录，再双击其中的 `佳音考试管理.exe`。保留同目录下的 `resources`、`locales` 等全部文件。 |

两种包均包含 Python 和 Electron 所提供的 Node.js 运行环境，使用者无需另外安装 Python、Node.js 或开发依赖。ZIP 解压后的完整目录共同组成应用程序，移动时也应移动整个目录。

应用在一个窗口内提供“阅卷”和“结果管理”。首次使用先导入本次学生名单、生成并填写正确答案表，再选择答题卡照片目录。完成图片复核后，点击“完成阅卷并进入结果管理”交接名单和最终成绩；也可导出 Excel 备份。

本机服务使用 `127.0.0.1:8510` 和 `127.0.0.1:3010`。启动时若提示端口已占用，先关闭正在运行的其他考试管理程序。关闭桌面应用会结束由它启动的本机服务。

## 数据、卸载与备份

每个 Windows 账户使用自己的数据目录：

```text
%APPDATA%\佳音考试管理\runtime
```

可通过窗口顶部“数据目录”或菜单“文件 → 打开数据目录”打开它。该账户使用 EXE 安装版和 ZIP 版时访问同一数据目录。

| 位置（相对于 runtime） | 内容 |
| --- | --- |
| `scanner\config` | 本次名单、标准答案及兼容答题卡模板。 |
| `scanner\sessions` | 识别结果、已保存的人工复核结果及审计记录。 |
| `results\results.sqlite` | 结果管理数据库。 |
| `results\files` | 结果管理保存的文件。 |
| `results\.local` | 本机结果服务配置和管理员登录资料。 |
| `logs\desktop.log` | 桌面入口及两个服务的启动、运行日志。 |

卸载安装版会保留该数据目录。删除 ZIP 版的程序目录也会保留数据。重新安装或替换程序包后，应用继续使用当前账户已有的数据。

备份前先关闭应用，再复制整个 `runtime` 目录。同时备份所选照片目录中的原始答题卡和已导出的 Excel/PDF。应用不把原始照片复制到 `runtime`；“修改图片并重新识别”会打开原文件，保存修改后重新识别本张，因此修图前应留存原图副本。

复核进度与照片目录的完整路径对应。在原路径保留照片，才能继续找到对应的已保存进度。跨电脑或更换照片目录后的迁移恢复尚待 Windows 人工验收，不作为本预览版已确认的能力。

排查启动问题时，从“数据目录”查看 `logs\desktop.log`。程序包、源码包和构建产物不包含实际名单、成绩、原始照片、`runtime`、`.local` 或管理员凭证。

## 图片编辑与 HEIC

Windows 使用本机文件关联打开 Excel。修图优先使用已关联的图片编辑器，没有“编辑”关联时尝试 Windows“画图”。修改后应保存到原路径和原文件名，应用才能检测保存并重新识别；编辑器若使用“另存为”，应核对保存位置。

HEIC/HEIF 能否识别取决于安装包中的图像解码组件是否可用；HEIC 编辑还取决于本机编辑器及其解码支持。Windows 人工验收将覆盖 HEIC 图片兼容性；如当前环境无法读取或编辑，可先将照片转换为 JPG/PNG 后选择相应目录。

## 从源码构建

构建在 **Windows x64** 上运行，需要 Python 3.12 x64（含 pip）、Node.js 22.13 或以上版本以及 Git；Node.js 的项目版本以根目录 `.node-version` 为准。使用本项目的完整 Git 检出目录，所有命令从合并项目根目录执行：

```powershell
npm ci --no-audit --no-fund
npm --prefix services/results ci --no-audit --no-fund
npm --prefix desktop/windows ci --no-audit --no-fund
npm run desktop:check:windows
npm run desktop:build:windows
```

默认使用 PATH 中的 `python`。若需要指定 Python 3.12 x64，先设置构建专用变量：

```powershell
$env:JOY_WINDOWS_PYTHON = 'C:\Path\To\Python312\python.exe'
npm run desktop:build:windows
```

构建入口是 `scripts/build-windows.mjs`：构建结果服务，复制 Python 及锁定的阅卷依赖，再封装 Electron 安装程序和 ZIP 包。结果服务使用本机 Node.js/SQLite 适配层，Windows 包不依赖其他项目目录或 macOS 的运行环境。

产物输出到 `output\windows`：安装程序、ZIP、`SHA256SUMS.txt` 和 `build-manifest.json`。构建清单记录版本、架构、运行环境及源码提交；`SHA256SUMS.txt` 用于核对发布文件完整性。打包阶段仅复制程序及初始资源，实际考试数据不进入运行环境包。

仓库另提供手动触发的 GitHub Actions 工作流 `.github/workflows/windows-build.yml`，在 Windows 构建环境运行相同命令，并上传上述产物。

## 验收状态

**实际 Windows 10 / Windows 11 x64 人工验收待进行。** 构建成功或语法检查通过均不表示这些操作已经完成验收：EXE 安装与卸载、ZIP 完整解压启动、中文路径选图和另存、图片编辑保存后的单张重新识别、人工答案及审计保留、名单与成绩交接、PDF/ZIP/Excel 导出，以及退出后的服务清理和重启恢复。

Windows 预览版通过上述验收前，V2.0 稳定发布材料继续作为现有版本的保留与回退材料。
