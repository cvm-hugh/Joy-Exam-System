"""Compatibility entry for the sole maintained 佳音考试管理 desktop App."""
from pathlib import Path
import subprocess
import sys


def main() -> None:
    root = Path(__file__).resolve().parents[3]
    app = root / "output" / "佳音考试管理.app"
    if sys.platform != "darwin":
        raise RuntimeError("当前桌面入口仅支持 macOS；Windows 安装包尚待实现。")
    if not app.is_dir():
        raise RuntimeError("请先在合并根目录运行 npm run desktop:build。")
    subprocess.run(["/usr/bin/open", "-a", str(app)], check=True)


if __name__ == "__main__":
    main()
