"""V3 运行目录。

应用程序包只提供只读的初始资源；用户实际使用的模板、名单和答案都复制到
本机用户数据目录中，因此更新应用程序不会覆盖考试数据。
"""
from __future__ import annotations

import shutil
import sys
import os
from pathlib import Path


APP_NAME = "佳音考试管理"
PROJECT_ROOT = Path(__file__).resolve().parents[1]
# 开发和自动验证可通过专用环境变量使用隔离目录；普通用户双击 App 时
# 没有该变量，始终使用本机用户数据目录中的独立考试数据。
if sys.platform == "darwin":
    _default_user_data_dir = Path.home() / "Library" / "Application Support" / APP_NAME / "scanner"
elif os.name == "nt":
    _default_user_data_dir = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local"))) / APP_NAME / "scanner"
else:
    _default_user_data_dir = Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local" / "share"))) / APP_NAME / "scanner"
USER_DATA_DIR = Path(os.environ.get("DINGWEICE_DATA_DIR", str(_default_user_data_dir))).expanduser()
CONFIG_DIR = USER_DATA_DIR / "config"
OUTPUT_DIR = USER_DATA_DIR / "output"

# 目前兼容已验收的 A3 V1 模板；后续模板包管理完成后不再使用固定常量。
FILL_THRESHOLD = 0.18
AMBIGUITY_MARGIN = 0.08
TEMPLATE_WIDTH = 3308
TEMPLATE_HEIGHT = 2339


def resource_root() -> Path:
    """返回开发环境或已打包 App 内置资源所在位置。"""
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS)  # type: ignore[attr-defined]
    return PROJECT_ROOT


def ensure_runtime_config() -> None:
    """首次打开 App 时复制初始兼容配置；已有用户文件绝不覆盖。"""
    seed = resource_root() / "resources" / "seed_config"
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for name in ("template.json", "template_reference.png"):
        destination = CONFIG_DIR / name
        if not destination.exists():
            shutil.copy2(seed / name, destination)
