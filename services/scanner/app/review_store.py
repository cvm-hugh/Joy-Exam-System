"""阅卷进度与人工复核记录的本地持久化。

答题卡图片仍由用户在原目录管理；本模块只在 Application Support
中保存识别结果、人工修正和审计记录，不复制或修改原图。
"""
from __future__ import annotations

from datetime import datetime
import hashlib
import json
from pathlib import Path
from typing import Any

from app.constants import USER_DATA_DIR


SESSION_SCHEMA_VERSION = 1
SESSION_DIR = USER_DATA_DIR / "sessions"


def _folder_key(source_folder: str | Path) -> str:
    normalized = str(Path(source_folder).expanduser().resolve())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:20]


def session_path(source_folder: str | Path) -> Path:
    return SESSION_DIR / f"{_folder_key(source_folder)}.json"


def save_review_session(
    source_folder: str | Path,
    records: list[dict[str, Any]],
    item_rows: list[dict[str, Any]],
    audit_log: list[dict[str, Any]],
    resolved: set[str],
    confirmed_warnings: set[str],
    reviewer: str = "",
) -> Path:
    SESSION_DIR.mkdir(parents=True, exist_ok=True)
    destination = session_path(source_folder)
    payload = {
        "schema_version": SESSION_SCHEMA_VERSION,
        "source_folder": str(Path(source_folder).expanduser().resolve()),
        "saved_at": datetime.now().isoformat(timespec="seconds"),
        "reviewer": reviewer.strip(),
        "records": records,
        "item_rows": item_rows,
        "audit_log": audit_log,
        "resolved": sorted(resolved),
        "confirmed_warnings": sorted(confirmed_warnings),
    }
    temporary = destination.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(destination)
    return destination


def load_review_session(source_folder: str | Path) -> dict[str, Any] | None:
    source_folder = Path(source_folder).expanduser().resolve()
    source = session_path(source_folder)
    if not source.is_file():
        return None
    payload = json.loads(source.read_text(encoding="utf-8"))
    if payload.get("schema_version") != SESSION_SCHEMA_VERSION:
        return None
    if Path(payload.get("source_folder", "")).expanduser().resolve() != source_folder:
        return None
    payload["resolved"] = set(payload.get("resolved", []))
    payload["confirmed_warnings"] = set(payload.get("confirmed_warnings", []))
    payload.setdefault("records", [])
    payload.setdefault("item_rows", [])
    payload.setdefault("audit_log", [])
    payload.setdefault("reviewer", "")
    return payload


def delete_review_session(source_folder: str | Path) -> None:
    session_path(source_folder).unlink(missing_ok=True)


def audit_entry(
    record: dict[str, Any],
    *,
    operator: str,
    change_type: str,
    target: str,
    original_value: Any,
    corrected_value: Any,
    review_basis: str,
    note: str = "",
) -> dict[str, Any]:
    return {
        "Source Image": record.get("Source Image", ""),
        "Exam ID": record.get("Exam ID", ""),
        "Chinese Name": record.get("Chinese Name", ""),
        "Change Type": change_type,
        "Target": target,
        "Original Value": original_value,
        "Corrected Value": corrected_value,
        "Review Basis": review_basis,
        "Original Paper Reviewed": "是" if review_basis == "纸质原卷" else "否",
        "Operator": operator.strip(),
        "Changed At": datetime.now().isoformat(timespec="seconds"),
        "Note": note.strip(),
    }
