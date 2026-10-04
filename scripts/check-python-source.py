"""Compile source in memory without importing the application or touching runtime data."""
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIRS = (ROOT / "services" / "scanner" / "app", ROOT / "scripts")


def main() -> int:
    sources = sorted(path for directory in SOURCE_DIRS for path in directory.rglob("*.py"))
    failed = False
    for path in sources:
        try:
            compile(path.read_bytes(), str(path), "exec", dont_inherit=True)
        except (SyntaxError, UnicodeError) as error:
            failed = True
            print(f"{path.relative_to(ROOT)}: {error}", file=sys.stderr)
    if failed:
        return 1
    print(f"已静态检查 {len(sources)} 个 Python 源码文件；未执行应用或写入运行数据。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
