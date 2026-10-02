"""仅供 Streamlit 操作界面调用的适配层；不改变扫描与导出核心。"""
from __future__ import annotations

from datetime import datetime
import subprocess
from shutil import copy2
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from app.constants import CONFIG_DIR, FILL_THRESHOLD, OUTPUT_DIR
from app.roster_import import normalize_exam_id
from app.scanner import (RESULT_COLUMNS, _read_image, _read_one, export_results,
                         load_answer_key, scan_image, normalize, student_record,
                         update_review_flag, update_score_totals)

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".heic", ".heif"}
QUESTION_GROUPS = [("listening", "part1", "listening_part1"), ("listening", "part2", "listening_part2"), ("listening", "part3", "listening_part3"), ("written_objective", "part1", "written_part1"), ("written_objective", "part4", "written_part4"), ("written_objective", "part5", "written_part5"), ("written_objective", "part6", "written_part6"), ("written_objective", "part7", "written_part7"), ("written_objective", "part8", "written_part8")]
SCORE_FIELDS = {"score_part2": "Written_Part2", "score_part3": "Written_Part3", "score_writing": "Writing"}
GRADER_REVIEW_FIELDS = {"score_part2", "score_part3"}
SCORE_LABELS = {"score_part2": "Written Part 2", "score_part3": "Written Part 3", "score_writing": "Writing"}
PART_LABELS = {"listening_part1": "Listening Part1", "listening_part2": "Listening Part2", "listening_part3": "Listening Part3", "written_part1": "Written Part1", "written_part4": "Written Part4", "written_part5": "Written Part5", "written_part6": "Written Part6", "written_part7": "Written Part7", "written_part8": "Written Part8"}
MANUAL_SCORE_PARTS = (
    ("Listening Part 1", "Listening_Part1", 5),
    ("Listening Part 2", "Listening_Part2", 5),
    ("Listening Part 3", "Listening_Part3", 5),
    ("Written Part 1", "Written_Part1", 5),
    ("Written Part 2", "Written_Part2", 5),
    ("Written Part 3", "Written_Part3", 10),
    ("Written Part 4", "Written_Part4", 5),
    ("Written Part 5", "Written_Part5", 5),
    ("Written Part 6", "Written_Part6", 5),
    ("Written Part 7", "Written_Part7", 7),
    ("Written Part 8", "Written_Part8", 8),
    ("Writing", "Writing", 15),
)


def required_files() -> dict[str, Path]:
    return {"学生名单": CONFIG_DIR / "student_list.xlsx", "答题卡模板": CONFIG_DIR / "template.json", "标准答案": CONFIG_DIR / "answer_key.json"}


def choose_macos_folder() -> str | None:
    script = 'POSIX path of (choose folder with prompt "选择答题卡照片所在文件夹")'
    result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=300)
    return result.stdout.strip().rstrip("/") if result.returncode == 0 else None


def save_as_macos(source_file: Path, default_name: str | None = None) -> Path | None:
    """通过 macOS 原生“另存为”对话框复制导出文件；取消时返回 None。"""
    suggested_name = (default_name or source_file.name).replace("\\", "\\\\").replace('"', '\\"')
    script = f'POSIX path of (choose file name with prompt "另存最终成绩" default name "{suggested_name}")'
    result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        return None
    destination = Path(result.stdout.strip())
    if destination.suffix.lower() != ".xlsx":
        destination = destination.with_suffix(".xlsx")
    if destination.exists():
        raise FileExistsError(f"目标文件已存在：{destination.name}。请在另存为对话框中使用其他文件名。")
    copy2(source_file, destination)
    return destination


def open_original_in_preview(source_file: Path) -> tuple[bool, str]:
    """用 macOS“预览”直接打开扫描时使用的原始图片。"""
    if not source_file.is_file():
        return False, f"找不到原始图片：{source_file}"
    try:
        result = subprocess.run(
            # -n starts an isolated Preview instance; -F prevents macOS from
            # restoring the images that were open in the previous instance.
            ["open", "-n", "-F", "-a", "Preview", str(source_file)],
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, f"无法打开原始图片：{exc}"
    if result.returncode != 0:
        detail = result.stderr.strip() or "macOS 未能启动“预览”。"
        return False, f"无法打开原始图片：{detail}"
    return True, f"已用“预览”打开原始图片：{source_file.name}。可直接编辑后保存。"


def image_paths(folder: Path) -> list[Path]:
    return sorted(path for path in folder.iterdir() if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS)


def scan_one(path: Path, template: dict[str, Any], students: dict[str, dict[str, str]]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """与 process_folder 相同的单张容错语义，供界面显示逐张进度。"""
    try:
        record, item_rows = scan_image(path, template, students)
    except Exception:
        record = {column: "" for column in RESULT_COLUMNS}
        record.update({"File Name": path.name, "Status": "CHECK_MARK", "Source Image": path.name})
        item_rows = []
    record.update({
        "File Name": path.name,
        "Source Path": str(path.resolve()),
        "Scan Result Status": record["Status"],
    })
    return record, item_rows


def _crop(image: np.ndarray, boxes: list[dict[str, Any]]) -> np.ndarray:
    x0, y0 = max(0, min(int(box["x"]) for box in boxes) - 16), max(0, min(int(box["y"]) for box in boxes) - 16)
    x1 = min(image.shape[1], max(int(box["x"] + box["w"]) for box in boxes) + 16)
    y1 = min(image.shape[0], max(int(box["y"] + box["h"]) for box in boxes) + 16)
    return cv2.cvtColor(image[y0:y1, x0:x1], cv2.COLOR_BGR2RGB)


def exam_id_crop(path: Path, template: dict[str, Any]) -> np.ndarray | None:
    """返回供人工确认的考号标题、手写框和数字填涂矩阵。"""
    try:
        image = normalize(_read_image(path), template)
        boxes = [box for position in map(str, range(1, 7)) for box in template["exam_id"][position].values()]
        x0 = max(0, min(int(box["x"]) for box in boxes) - 55)
        x1 = min(image.shape[1], max(int(box["x"] + box["w"]) for box in boxes) + 95)
        matrix_top = min(int(box["y"]) for box in boxes)
        matrix_bottom = max(int(box["y"] + box["h"]) for box in boxes)
        matrix_height = matrix_bottom - matrix_top
        y0 = max(0, matrix_top - int(matrix_height * 0.9))
        y1 = min(image.shape[0], matrix_bottom + 40)
        return cv2.cvtColor(image[y0:y1, x0:x1], cv2.COLOR_BGR2RGB)
    except Exception:
        return None


def answer_card_preview(path: Path) -> np.ndarray | None:
    """返回原始整张答题卡缩略图；Streamlit 负责按比例缩放展示。"""
    try:
        return cv2.cvtColor(_read_image(path), cv2.COLOR_BGR2RGB)
    except Exception:
        return None


def prepare_mark_review(
    record: dict[str, Any], path: Path, template: dict[str, Any],
    item_rows: list[dict[str, Any]] | None = None, resolved: set[str] | None = None,
) -> list[dict[str, Any]]:
    """根据原图和已保存复核结果生成尚待确认的项目。"""
    if record.get("Manual Override"):
        return []
    try:
        image = normalize(_read_image(path), template)
    except Exception:
        return [{"key": "image", "title": "图片定位失败", "detail": "四角定位块或图像无法读取，需人工查看原图。", "choices": [], "crop": None}]
    issues: list[dict[str, Any]] = []
    source = str(record.get("Source Image") or path.name)
    saved_keys = resolved or set()
    confirmed_questions = {
        (row.get("Section"), str(row.get("Question")))
        for row in (item_rows or [])
        if row.get("Source Image") == source and row.get("Manual Correction") == "是"
    }
    reopened_keys = set(record.get("Reopened Review Questions", []))
    expanded_sections = set(record.get("Expanded Review Sections", []))
    reviewed_sections = set(record.get("Reviewed Blank Sections", []))
    manual_score_columns = set(record.get("Manual Score Overrides", {}))
    for template_root, part, section in QUESTION_GROUPS:
        score_column = "_".join(value.capitalize() for value in section.split("_"))
        section_reopened = any(key.startswith(f"question:{section}:") for key in reopened_keys)
        if not section_reopened and (section in reviewed_sections or score_column in manual_score_columns):
            continue
        unread_candidates: list[dict[str, Any]] = []
        for number, options in template[template_root][part].items():
            question_key = f"question:{section}:{number}"
            confirmed = (section, str(number)) in confirmed_questions or issue_key(source, question_key) in saved_keys
            if confirmed and question_key not in reopened_keys:
                continue
            read = _read_one(image, options)
            if read.value is None:
                blank_candidate = max(read.ratios.values()) < FILL_THRESHOLD
                unread_candidates.append({"key": f"question:{section}:{number}", "title": f"题号 {number}", "detail": "当前识别结果：空白候选" if blank_candidate else "当前识别结果：无法明确判断", "choices": list(options.keys()), "crop": _crop(image, list(options.values())), "section": section, "number": number, "blank_candidate": blank_candidate})
        if unread_candidates and len(unread_candidates) == len(template[template_root][part]) and section not in expanded_sections:
            issues.append({"key": f"part_empty:{section}", "kind": "part_empty", "title": PART_LABELS[section], "detail": f"{len(unread_candidates)}/{len(unread_candidates)} 无有效作答（空白候选）", "section": section, "question_issues": unread_candidates, "question_range": f"{unread_candidates[0]['number']}-{unread_candidates[-1]['number']}"})
        else:
            # 机器的 BLANK 只表示没有检测到足够强的填涂信号，不能等同于
            # 学生确实未作答。非整 Part 的孤立 BLANK 也必须逐题人工确认。
            issues.extend(unread_candidates)
    for field, record_column in SCORE_FIELDS.items():
        options = template[field]
        read = _read_one(image, options)
        entry_states = dict(record.get("Score Entry States", {}))
        original_entry_states = dict(record.get("Original Score Entry States", {}))
        original_scores = dict(record.get("Original Scores", {}))
        confirmed_score = (
            entry_states.get(record_column) == "MANUAL"
            or record_column in manual_score_columns
            or record_column in record.get("Reviewed Blank Scores", [])
            or issue_key(source, f"score:{field}") in saved_keys
        )
        if read.value is None:
            blank_candidate = max(read.ratios.values()) < FILL_THRESHOLD
            detected_state = "BLANK" if blank_candidate else "AMBIGUOUS"
            original_entry_states.setdefault(record_column, detected_state)
            if record_column not in record.get("Original Score Entry States", {}):
                # 兼容旧进度：旧版曾把无法读取的教师登分原始值保存成 0。
                original_scores[record_column] = None
            if not confirmed_score:
                record[record_column] = 0 if blank_candidate else record.get(record_column)
                entry_states[record_column] = detected_state
            if not confirmed_score and field in GRADER_REVIEW_FIELDS:
                issues.append({
                    "key": f"score:{field}",
                    "kind": "grader_score",
                    "title": SCORE_LABELS[field],
                    "detail": "当前识别结果：教师登分区未成功读取",
                    "choices": sorted(options.keys(), key=int),
                    "crop": _crop(image, list(options.values())),
                    "field": field,
                    "allow_blank": False,
                })
            elif not confirmed_score and not blank_candidate:
                issues.append({"key": f"score:{field}", "title": SCORE_LABELS[field], "detail": "当前识别结果：无法明确判断", "choices": sorted(options.keys(), key=int), "crop": _crop(image, list(options.values())), "field": field})
        else:
            original_entry_states.setdefault(record_column, "SCORED")
            original_scores.setdefault(record_column, int(read.value))
            if not confirmed_score:
                entry_states[record_column] = "SCORED"
        record["Score Entry States"] = entry_states
        record["Original Score Entry States"] = original_entry_states
        record["Original Scores"] = original_scores
    return issues


def low_answer_warning(record: dict[str, Any], item_rows: list[dict[str, Any]], issues: list[dict[str, Any]]) -> str | None:
    """给大面积未作答提供人工提醒，不更改成绩或状态。"""
    if not any(item.get("section") for item in issues):
        return None
    relevant = [row for row in item_rows if row["Source Image"] == record["Source Image"]]
    answered = sum(bool(row["Marked Answer"]) for row in relevant)
    empty_sections = [item["section"] for item in issues if item.get("kind") == "part_empty"]
    if relevant and answered <= max(3, len(relevant) // 10):
        return f"客观题有效识别仅 {answered}/{len(relevant)} 题。"
    if len(empty_sections) >= 2:
        return "多个 Part 检测为整段空白。"
    return None


def issue_key(source_image: str, item_key: str) -> str:
    return f"{source_image}::{item_key}"


def recalculate_record(record: dict[str, Any], item_rows: list[dict[str, Any]]) -> None:
    relevant = [row for row in item_rows if row["Source Image"] == record["Source Image"]]
    correct_by_section: dict[str, int] = {}
    for row in relevant:
        correct_by_section[row["Section"]] = correct_by_section.get(row["Section"], 0) + int(row["Is Correct"] == "Y")
    for section, column in [("listening_part1", "Listening_Part1"), ("listening_part2", "Listening_Part2"), ("listening_part3", "Listening_Part3"), ("written_part1", "Written_Part1"), ("written_part4", "Written_Part4"), ("written_part5", "Written_Part5"), ("written_part6", "Written_Part6"), ("written_part7", "Written_Part7"), ("written_part8", "Written_Part8")]:
        record[column] = correct_by_section.get(section, 0)
    for column, value in record.get("Manual Score Overrides", {}).items():
        if column in {part[1] for part in MANUAL_SCORE_PARTS}:
            record[column] = int(value)
    update_score_totals(record)
    update_review_flag(record, item_rows)


def _change_time(changed_at: str = "") -> str:
    return changed_at or datetime.now().isoformat(timespec="seconds")


def _stamp_record(record: dict[str, Any], operator: str, review_basis: str, changed_at: str = "") -> None:
    record["Last Operator"] = operator.strip()
    record["Last Review Basis"] = review_basis
    record["Last Changed At"] = _change_time(changed_at)


def _stamp_manual_score(
    record: dict[str, Any],
    column: str,
    operator: str,
    review_basis: str,
    changed_at: str,
) -> None:
    """按 Part 保存人工登分信息，避免其他复核动作污染该行导出记录。"""
    audits = dict(record.get("Manual Score Audits", {}))
    audits[column] = {
        "Operator": operator.strip(),
        "Review Basis": review_basis,
        "Changed At": changed_at,
    }
    record["Manual Score Audits"] = audits


def apply_part_score(
    record: dict[str, Any],
    item_rows: list[dict[str, Any]],
    column: str,
    value: int,
    *,
    operator: str = "",
    review_basis: str = "",
    changed_at: str = "",
) -> None:
    """修正答题卡上的 Part 填涂分数，并保留原始扫描值。"""
    allowed = {part[1]: part[2] for part in MANUAL_SCORE_PARTS}
    if column not in allowed or not 0 <= value <= allowed[column]:
        raise ValueError("Part 分数超出允许范围。")
    overrides = dict(record.get("Manual Score Overrides", {}))
    overrides[column] = int(value)
    record["Manual Score Overrides"] = overrides
    entry_states = dict(record.get("Score Entry States", {}))
    entry_states[column] = "MANUAL"
    record["Score Entry States"] = entry_states
    timestamp = _change_time(changed_at)
    _stamp_manual_score(record, column, operator, review_basis, timestamp)
    _stamp_record(record, operator, review_basis, timestamp)
    recalculate_record(record, item_rows)


def apply_whole_paper_manual_entry(record: dict[str, Any], item_rows: list[dict[str, Any]], exam_id: str, student: dict[str, str], scores: dict[str, int]) -> None:
    """将一张卷的正式成绩改为人工输入的 12 个 Part 分数。"""
    allowed = {part[1]: part[2] for part in MANUAL_SCORE_PARTS}
    if set(scores) != set(allowed) or any(not 0 <= int(scores[column]) <= maximum for column, maximum in allowed.items()):
        raise ValueError("Part 分数超出允许范围。")
    record.update(student_record(student, exam_id))
    for row in item_rows:
        if row["Source Image"] == record["Source Image"]:
            row["Exam ID"] = exam_id
    record["Manual Score Overrides"] = {column: int(value) for column, value in scores.items()}
    record["Score Entry States"] = {column: "MANUAL" for column in scores}
    record["Manual Override"] = True
    recalculate_record(record, item_rows)
    record["Status"] = "OK"


def apply_exam_id(
    record: dict[str, Any],
    item_rows: list[dict[str, Any]],
    new_id: str,
    students: dict[str, dict[str, str]],
    *,
    operator: str = "",
    review_basis: str = "",
    changed_at: str = "",
) -> tuple[bool, str]:
    new_id = normalize_exam_id(new_id)
    if len(new_id) != 6 or not new_id.isdigit():
        return False, "请填写 6 位数字考号或 S 开头的学号，例如 010086 或 S10086。"
    student = students.get(new_id)
    if student is None:
        return False, f"考号 {new_id} 不在当前学生名单中。请核对图片和本次名单；若名单漏了该学生，请补全后补学生信息。"
    old_id = record["Exam ID"]
    record.pop("Original Exam ID", None)
    record.update(student_record(student, new_id))
    for row in item_rows:
        if row["Source Image"] == record["Source Image"]:
            row["Exam ID"] = new_id
    record["Identity Issue"] = ""
    _stamp_record(record, operator, review_basis, changed_at)
    recalculate_record(record, item_rows)
    return True, old_id


def apply_student_supplement(
    record: dict[str, Any],
    item_rows: list[dict[str, Any]],
    student: dict[str, str],
    *,
    exam_id: str = "",
    operator: str = "",
    review_basis: str = "",
    changed_at: str = "",
) -> None:
    """确认考号识别正确，但原名单漏人时，为当前扫描记录补齐身份。"""
    required = ("Chinese Name", "Branch", "Class", "Exam Session")
    missing = [column for column in required if not str(student.get(column, "")).strip()]
    if missing:
        raise ValueError("请补齐姓名、分校、班级和笔试时间；年级未知可留空。")
    original_exam_id = exam_id.strip() or str(record.get("Exam ID", "")).strip()
    confirmed_exam_id = normalize_exam_id(original_exam_id)
    if len(confirmed_exam_id) != 6 or not confirmed_exam_id.isdigit():
        raise ValueError("当前识别考号不是6位数字，请先修正考号。")
    record.update(student_record(student, confirmed_exam_id))
    record["Original Exam ID"] = original_exam_id
    record["Identity Issue"] = ""
    record["Identity Confirmed"] = True
    for row in item_rows:
        if row.get("Source Image") == record.get("Source Image"):
            row["Exam ID"] = confirmed_exam_id
    _stamp_record(record, operator, review_basis, changed_at)
    recalculate_record(record, item_rows)


def apply_mark(
    record: dict[str, Any],
    item_rows: list[dict[str, Any]],
    issue: dict[str, Any],
    choice: str | None,
    *,
    operator: str = "",
    review_basis: str = "",
    changed_at: str = "",
) -> None:
    timestamp = _change_time(changed_at)
    if "section" in issue:
        key = load_answer_key()[issue["section"]][issue["number"]]
        for row in item_rows:
            if row["Source Image"] == record["Source Image"] and row["Section"] == issue["section"] and str(row["Question"]) == str(issue["number"]):
                row.setdefault("Original Marked Answer", row.get("Marked Answer", ""))
                row.setdefault("Original Item Score", 1 if row.get("Is Correct") == "Y" else 0)
                row.setdefault("Original Answer Status", row.get("Answer Status", ""))
                row["Marked Answer"], row["Is Correct"] = choice or "", "Y" if choice == key else "N"
                row["Answer Status"] = "BLANK" if choice is None else "CORRECT" if choice == key else "INCORRECT"
                row["Manual Correction"] = "是"
                row["Review Basis"] = review_basis
                row["Operator"] = operator.strip()
                row["Changed At"] = timestamp
                break
    elif "field" in issue:
        column = SCORE_FIELDS[issue["field"]]
        record[column] = int(choice) if choice is not None else 0
        entry_states = dict(record.get("Score Entry States", {}))
        entry_states[column] = "BLANK" if choice is None else "MANUAL"
        record["Score Entry States"] = entry_states
        if choice is None:
            reviewed_scores = set(record.get("Reviewed Blank Scores", []))
            reviewed_scores.add(column)
            record["Reviewed Blank Scores"] = sorted(reviewed_scores)
        else:
            _stamp_manual_score(record, column, operator, review_basis, timestamp)
    _stamp_record(record, operator, review_basis, timestamp)
    recalculate_record(record, item_rows)


def apply_part_empty(
    record: dict[str, Any],
    item_rows: list[dict[str, Any]],
    issue: dict[str, Any],
    *,
    operator: str = "",
    review_basis: str = "",
    changed_at: str = "",
) -> None:
    """将经人工确认的整 Part 所有题目记为空白（0 分）。"""
    timestamp = _change_time(changed_at)
    for question_issue in issue["question_issues"]:
        for row in item_rows:
            if row["Source Image"] == record["Source Image"] and row["Section"] == question_issue["section"] and str(row["Question"]) == str(question_issue["number"]):
                row.setdefault("Original Marked Answer", row.get("Marked Answer", ""))
                row.setdefault("Original Item Score", 1 if row.get("Is Correct") == "Y" else 0)
                row.setdefault("Original Answer Status", row.get("Answer Status", ""))
                row["Marked Answer"], row["Is Correct"] = "", "N"
                row["Answer Status"] = "BLANK"
                row["Manual Correction"] = "是"
                row["Review Basis"] = review_basis
                row["Operator"] = operator.strip()
                row["Changed At"] = timestamp
                break
    reviewed_sections = set(record.get("Reviewed Blank Sections", []))
    reviewed_sections.add(str(issue.get("section", "")))
    record["Reviewed Blank Sections"] = sorted(section for section in reviewed_sections if section)
    _stamp_record(record, operator, review_basis, timestamp)
    recalculate_record(record, item_rows)


def save_current_results(records: list[dict[str, Any]], item_rows: list[dict[str, Any]], source_folder: str, audit_log: list[dict[str, Any]] | None = None) -> Path:
    folder_name = Path(source_folder).name or "results"
    output_dir = Path(source_folder) if source_folder else OUTPUT_DIR
    result_path, _ = export_results(
        records,
        item_rows,
        output_dir=output_dir,
        export_label=f"{folder_name}_自动保存",
        include_items=True,
        audit_log=audit_log,
    )
    return result_path
