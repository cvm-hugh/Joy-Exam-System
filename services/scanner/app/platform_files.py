"""本机文件对话框与文件打开入口，不依赖 Tk 或桌面外壳桥接。"""
from __future__ import annotations

import base64
import os
from pathlib import Path
from shutil import copy2, which
import subprocess
import sys


def _run_macos_dialog(script: str) -> str | None:
    try:
        result = subprocess.run(
            ["osascript", "-e", script], capture_output=True,
            text=True, encoding="utf-8", timeout=300,
        )
    except subprocess.TimeoutExpired as exc:
        raise OSError("文件对话框等待超时，请重新打开。") from exc
    return result.stdout.strip() if result.returncode == 0 else None


def _powershell_string(value: str) -> str:
    """单引号字符串保留路径原文；编码后的脚本不经过 shell 解析。"""
    return "'" + value.replace("'", "''") + "'"


def _run_windows_dialog(body: str) -> str | None:
    # Windows 10/11 自带 Windows PowerShell 和 WinForms。Python embeddable
    # 没有 Tk，因此以独立 STA 进程显示对话框，避免改变 Streamlit 线程状态。
    script = "\n".join((
        "$ErrorActionPreference = 'Stop'",
        "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
        "Add-Type -AssemblyName System.Windows.Forms",
        "[System.Windows.Forms.Application]::EnableVisualStyles()",
        "$owner = New-Object System.Windows.Forms.Form",
        "$owner.TopMost = $true",
        "$owner.ShowInTaskbar = $false",
        "try {",
        body,
        "} finally { $owner.Dispose() }",
    ))
    encoded = base64.b64encode(script.encode("utf-16-le")).decode("ascii")
    try:
        result = subprocess.run(
            ["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-STA",
             "-EncodedCommand", encoded],
            capture_output=True, text=True, encoding="utf-8-sig", errors="replace",
            timeout=300, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except subprocess.TimeoutExpired as exc:
        raise OSError("文件对话框等待超时，请重新打开。") from exc
    if result.returncode != 0:
        detail = result.stderr.strip() or "Windows 未能打开文件对话框。"
        raise OSError(detail)
    return result.stdout.strip() or None


def choose_folder(initial_folder: str = "") -> str | None:
    """显示本机文件夹选择器；取消时返回 None。"""
    if sys.platform == "darwin":
        selected = _run_macos_dialog(
            'POSIX path of (choose folder with prompt "选择答题卡照片所在文件夹")',
        )
    elif os.name == "nt":
        initial = Path(initial_folder).expanduser() if initial_folder else None
        initial_property = (
            f"$dialog.SelectedPath = {_powershell_string(str(initial.resolve()))}"
            if initial is not None and initial.is_dir() else ""
        )
        selected = _run_windows_dialog("\n".join((
            "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
            "$dialog.Description = '选择答题卡照片所在文件夹'",
            "$dialog.ShowNewFolderButton = $false",
            initial_property,
            "try {",
            "  if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {",
            "    [Console]::Write($dialog.SelectedPath)",
            "  }",
            "} finally { $dialog.Dispose() }",
        )))
    else:
        raise OSError("当前系统没有可用的文件夹选择器，请直接填写照片目录。")
    return str(Path(selected)) if selected else None


def save_as(source_file: Path, default_name: str | None = None) -> Path | None:
    """通过本机“另存为”对话框复制导出文件；保留已有文件。"""
    name = default_name or source_file.name
    if sys.platform == "darwin":
        suggested_name = name.replace("\\", "\\\\").replace('"', '\\"')
        selected = _run_macos_dialog(
            f'POSIX path of (choose file name with prompt "另存最终成绩" default name "{suggested_name}")',
        )
    elif os.name == "nt":
        selected = _run_windows_dialog("\n".join((
            "$dialog = New-Object System.Windows.Forms.SaveFileDialog",
            "$dialog.Title = '另存最终成绩'",
            "$dialog.Filter = 'Excel 工作簿 (*.xlsx)|*.xlsx'",
            "$dialog.DefaultExt = 'xlsx'",
            "$dialog.AddExtension = $true",
            "$dialog.CheckPathExists = $true",
            "$dialog.OverwritePrompt = $false",
            f"$dialog.FileName = {_powershell_string(name)}",
            f"$dialog.InitialDirectory = {_powershell_string(str(source_file.resolve().parent))}",
            "try {",
            "  if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {",
            "    [Console]::Write($dialog.FileName)",
            "  }",
            "} finally { $dialog.Dispose() }",
        )))
    else:
        raise OSError("当前系统没有可用的另存为对话框。")
    if not selected:
        return None
    destination = Path(selected)
    if destination.suffix.lower() != ".xlsx":
        destination = destination.with_suffix(".xlsx")
    if destination.exists():
        raise FileExistsError(f"目标文件已存在：{destination.name}。请在另存为对话框中使用其他文件名。")
    copy2(source_file, destination)
    return destination


def open_local_file(source_file: Path) -> tuple[bool, str]:
    """以本机文件关联打开 Excel 等文件。"""
    if not source_file.is_file():
        return False, f"找不到文件：{source_file}"
    try:
        if os.name == "nt":
            os.startfile(str(source_file.resolve()))
        else:
            command = "open" if sys.platform == "darwin" else "xdg-open"
            result = subprocess.run(
                [command, str(source_file)], capture_output=True,
                text=True, encoding="utf-8", timeout=15,
            )
            if result.returncode != 0:
                return False, f"无法打开文件：{result.stderr.strip() or source_file.name}"
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, f"无法打开文件：{exc}"
    return True, f"已打开：{source_file.name}"


def image_editor_label() -> str:
    return "“预览”" if sys.platform == "darwin" else "系统图片编辑器"


def _edit_windows_image(source_file: Path) -> None:
    """优先使用已关联的编辑器；没有 edit 关联时尝试系统“画图”。"""
    try:
        os.startfile(str(source_file.resolve()), "edit")
        return
    except OSError as association_error:
        paint = which("mspaint.exe")
        if not paint:
            windows_dir = Path(os.environ.get("SystemRoot", r"C:\Windows"))
            candidate = windows_dir / "System32" / "mspaint.exe"
            paint = str(candidate) if candidate.is_file() else None
        if not paint:
            raise OSError("未找到图片编辑器。请为图片设置“编辑”文件关联，或安装 Windows“画图”。") from association_error
        subprocess.Popen(
            [paint, str(source_file.resolve())],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )


def open_original_image(source_file: Path) -> tuple[bool, str]:
    """打开扫描所用的原始图片，供保存修改后重新识别。"""
    if not source_file.is_file():
        return False, f"找不到原始图片：{source_file}"
    try:
        if sys.platform == "darwin":
            # 独立的 Preview 实例仅打开当前图片，不恢复上次打开的图片。
            result = subprocess.run(
                ["open", "-n", "-F", "-a", "Preview", str(source_file)],
                capture_output=True, text=True, encoding="utf-8", timeout=15,
            )
            if result.returncode != 0:
                detail = result.stderr.strip() or "macOS 未能启动“预览”。"
                return False, f"无法打开原始图片：{detail}"
        elif os.name == "nt":
            _edit_windows_image(source_file)
        else:
            return open_local_file(source_file)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, f"无法打开原始图片：{exc}"
    return True, (
        f"已用{image_editor_label()}打开原始图片：{source_file.name}。"
        "请修改后保存到原路径和原文件名。"
    )
