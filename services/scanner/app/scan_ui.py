"""普通用户本地操作页面。识别和 Excel 输出仍由 scanner.py 负责。"""
from __future__ import annotations

import getpass
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import uuid

import streamlit as st
import streamlit.components.v1 as components

# Streamlit 直接执行本文件时只会加入 app/；显式加入工程根目录，
# 以便开发环境和打包后的 App 都可导入 app.* 模块。
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.answer_key_import import generate_answer_key_template, read_answer_key
from app.constants import CONFIG_DIR, ensure_runtime_config
from app.review_scroll import install_review_scroll_lock
from app.review_navigation import (EXPORT_TARGET_KEY, PENDING_REVIEW_STATUSES,
                                   first_pending_review_key, review_answers_key,
                                   review_card_key, review_item_key, review_panel_key)
from app.legacy_profile import answers_to_legacy_key, legacy_v1_package
from app.roster_import import generate_roster_template, normalize_exam_id, read_roster, save_roster_snapshot
from app.student_information import student_information_issues
from app.review_store import (audit_entry, delete_review_session,
                              load_review_session, save_review_session)
from app.scanner import RESULT_COLUMNS, SUMMARY_SEPARATOR_COLUMN, export_results, load_students, load_template, update_review_flag, update_score_totals
from app.ui_helpers import (answer_card_preview, apply_exam_id,
                            apply_mark, apply_part_empty,
                            apply_student_supplement, choose_macos_folder,
                            exam_id_crop, image_paths, issue_key, low_answer_warning,
                            open_original_in_preview, pending_part_questions,
                            prepare_mark_review, required_files, review_item_title,
                            save_as_macos, save_current_results, scan_one,
                            synchronize_part_review)

st.set_page_config(page_title="佳音考试管理 · 阅卷", layout="wide")
st.markdown(
    """
    <style>
    *, *::before, *::after {
      animation-duration: 0.001ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0ms !important;
      scroll-behavior: auto !important;
    }
    </style>
    """,
    unsafe_allow_html=True,
)


def initialize() -> None:
    defaults = {
        "records": [], "item_rows": [], "issues": {}, "resolved": set(),
        "confirmed_warnings": set(), "audit_log": [], "reviewer": getpass.getuser(),
        "review_basis": "答题卡图片", "folder": "", "exports": None,
        "identity_notices": {},
        "loaded_session_folder": "", "view": "setup", "part_expand_notices": {},
        "stable_review_sources": set(), "ui_zoom": 100,
        "pending_image_rescan": None,
        "review_navigation": None,
        "closed_review_sources": set(),
    }
    for key, value in defaults.items():
        st.session_state.setdefault(key, value)


def reset_review_widgets(source_image: str | None = None) -> None:
    """Fresh recognition must not inherit widget values from an older review."""
    if source_image is None:
        st.session_state.pop("review_navigation", None)
        st.session_state["closed_review_sources"] = set()
    prefixes = ("choice_", "saved_choice_", "save_mark_", "id_", "confirm_id_", "confirm_supplement_",
                "supplement_name_", "supplement_grade_", "supplement_branch_", "supplement_class_", "supplement_session_")
    for key in list(st.session_state):
        if source_image is None:
            matches = any(key.startswith(prefix) for prefix in prefixes) or key.startswith("review_panel_")
        else:
            matches = any(key == f"{prefix}{source_image}" or key.startswith(f"{prefix}{source_image}_") for prefix in prefixes)
        if matches:
            st.session_state.pop(key, None)
    notices = st.session_state.get("identity_notices")
    if notices is not None:
        if source_image is None:
            notices.clear()
        else:
            notices.pop(source_image, None)


def render_display_controls() -> None:
    """固定在顶部工具栏旁，只缩放正文，保持入口的大小和位置。"""
    with st.container(key="display_controls", width="content"):
        with st.popover("🔍 界面缩放"):
            st.radio(
                "显示比例",
                (75, 85, 100, 110),
                horizontal=True,
                key="ui_zoom",
                format_func=lambda value: f"{value}%",
                help="只缩放软件工作台，不会压缩答题卡图片或影响识别。",
            )
        components.html(
            Path(__file__).with_name("display_controls.html").read_text(encoding="utf-8"),
            height=0,
        )
    zoom = int(st.session_state.ui_zoom) / 100
    st.html(
        f"""
        <style>
        .st-key-scanner_workbench {{
          zoom: {zoom};
        }}
        .st-key-display_controls {{
          position: fixed;
          top: var(--joy-zoom-top, 10px);
          right: var(--joy-zoom-right, 10rem);
          width: 9.5rem !important;
          height: 2.5rem !important;
          gap: 0 !important;
          z-index: 999991;
        }}
        .st-key-display_controls [data-testid="stPopoverButton"] {{
          min-height: 2.5rem;
          height: 2.5rem;
        }}
        .st-key-display_controls iframe {{
          display: none;
        }}
        @media print {{
          .st-key-display_controls {{ display: none !important; }}
        }}
        </style>
        """,
    )


def persist_current_session() -> None:
    """每次人工操作后立即保存，不依赖 Streamlit 会话内存。"""
    if not st.session_state.folder or not st.session_state.records:
        return
    save_review_session(
        st.session_state.folder,
        st.session_state.records,
        st.session_state.item_rows,
        st.session_state.audit_log,
        st.session_state.resolved,
        st.session_state.confirmed_warnings,
        st.session_state.reviewer,
    )


def ensure_reviewer() -> str:
    """人工修正必须留下操作人；界面未填时使用当前 Mac 账户。"""
    reviewer = str(st.session_state.get("reviewer", "")).strip()
    if not reviewer:
        reviewer = getpass.getuser().strip() or "本机操作人"
        st.session_state.reviewer = reviewer
    return reviewer


def _source_version(path: Path) -> int:
    try:
        return path.stat().st_mtime_ns
    except OSError:
        return 0


@st.cache_data(show_spinner=False)
def cached_answer_card_preview(path_text: str, source_version: int):
    """缓存未改变的整张答题卡，避免每次保存都重新解码图片。"""
    del source_version
    return answer_card_preview(Path(path_text))


@st.cache_data(show_spinner=False)
def cached_exam_id_crop(path_text: str, source_version: int, template_data: dict):
    """缓存考号区域的定位和裁切结果。"""
    del source_version
    return exam_id_crop(Path(path_text), template_data)


def append_audit(
    record: dict,
    *,
    change_type: str,
    target: str,
    original_value: object,
    corrected_value: object,
    note: str = "",
) -> dict:
    entry = audit_entry(
        record,
        operator=st.session_state.reviewer,
        change_type=change_type,
        target=target,
        original_value=original_value,
        corrected_value=corrected_value,
        review_basis=st.session_state.review_basis,
        note=note,
    )
    st.session_state.audit_log.append(entry)
    return entry


def save_uploaded_xlsx(uploaded) -> Path:
    """先写入临时文件校验，再替换 V3 的本机配置副本。"""
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as temporary:
        temporary.write(uploaded.getvalue())
    return Path(temporary.name)


def render_roster_setup() -> None:
    st.subheader("导入本次学生名单")
    st.info("首次使用或开始新考试时，请导入本次名单。App 不会内置或覆盖你的学生数据。")
    if notice := st.session_state.pop("roster_import_notice", None):
        st.success(notice)
    if warning := st.session_state.pop("roster_import_warning", None):
        st.warning(warning)
    roster_template = CONFIG_DIR / "学业水平测试统计名单-模板.xlsx"
    st.caption("模板保留原始名单的全部列；“精修笔试通过”和六维得分系数在本阶段留空，由结果管理系统后续填入。")
    if st.button("生成《学业水平测试统计名单-模板》"):
        generate_roster_template(roster_template)
        opened = subprocess.run(["open", str(roster_template)], capture_output=True).returncode == 0
        message = "学生名单模板已生成并打开。" if opened else f"已生成：{roster_template}"
        st.success(message)
    uploaded = st.file_uploader("选择学生名单 .xlsx", type=["xlsx"], key="roster_upload")
    if st.button("载入学生名单", type="primary", disabled=uploaded is None):
        temporary_path = save_uploaded_xlsx(uploaded)
        try:
            imported = read_roster(temporary_path)
            save_roster_snapshot(temporary_path, CONFIG_DIR, overwrite=True)
            st.session_state.roster_import_notice = (
                f"学生名单已载入：{imported.count} 人。"
                "已转换为 App 所需格式，不会修改原 Excel。"
            )
            if imported.skipped_rows:
                st.session_state.roster_import_warning = (
                    f"有 {len(imported.skipped_rows)} 行因缺少学号未纳入答题卡匹配："
                    + "；".join(imported.skipped_rows)
                    + "。该学生若有答题卡，会在扫描后按“名单外考号”保留，可再手动补全。"
                )
            st.rerun()
        except Exception as exc:
            st.error(f"无法载入学生名单：{exc}")
        finally:
            temporary_path.unlink(missing_ok=True)


def render_answer_setup(template: dict) -> None:
    st.subheader("设置本次正确答案")
    package = legacy_v1_package(template)
    answer_template = CONFIG_DIR / "答案录入模板.xlsx"
    st.info("正确答案不包含在 App 中。请先生成答案录入表，填写后再导入。")
    if st.button("生成答案录入 Excel 模板", type="primary"):
        generate_answer_key_template(package, answer_template)
        opened = subprocess.run(["open", str(answer_template)], capture_output=True).returncode == 0
        if opened:
            st.success("答案录入模板已生成并打开。填写 Correct Answer 列后保存，再回到此处导入。")
        else:
            st.success(f"已生成：{answer_template}。填写 Correct Answer 列后保存，再回到此处导入。")
    uploaded = st.file_uploader("导入已填写的答案表 .xlsx", type=["xlsx"], key="answer_upload")
    if st.button("载入正确答案", disabled=uploaded is None):
        temporary_path = save_uploaded_xlsx(uploaded)
        try:
            answers = read_answer_key(temporary_path, package)
            legacy_key = answers_to_legacy_key(answers)
            (CONFIG_DIR / "answer_key.json").write_text(json.dumps(legacy_key, ensure_ascii=False, indent=2), encoding="utf-8")
            st.success(f"正确答案已载入：{len(answers)} 道客观题。")
            st.rerun()
        except Exception as exc:
            st.error(f"无法载入正确答案：{exc}")
        finally:
            temporary_path.unlink(missing_ok=True)


def render_exam_setup() -> None:
    """每次打开 App 都显示本次考试的四项设置，不依赖是否已有旧配置。"""
    files = required_files()
    st.caption("本次考试设置。确认名单、答题卡、标准答案和照片目录后，再进入扫描工作台。")

    st.subheader("1. 学生名单")
    roster_ready = False
    if files["学生名单"].is_file():
        try:
            roster = read_roster(files["学生名单"])
            st.success(f"已载入：{files['学生名单'].name}（{roster.count} 人）")
            roster_ready = True
        except Exception as exc:
            st.error(f"当前学生名单无法读取：{exc}")
    else:
        st.warning("尚未载入本次学生名单。")
    with st.expander("导入 / 更换学生名单", expanded=not roster_ready):
        render_roster_setup()

    st.subheader("2. 答题卡模式")
    template_ready = False
    try:
        setup_template = load_template()
        st.success("定位测 A3 V1（内置兼容模板，已载入）")
        st.caption("当前版本仅提供这一种已经通过验证的答题卡模式；新答题卡制作与定位测试将在下一阶段加入。")
        template_ready = True
    except Exception as exc:
        setup_template = None
        st.error(f"答题卡模板无法载入：{exc}")

    st.subheader("3. 标准答案")
    answer_ready = files["标准答案"].is_file()
    if answer_ready:
        st.success(f"已载入：{files['标准答案'].name}")
    else:
        st.warning("尚未载入本次标准答案。")
    if setup_template is not None:
        with st.expander("生成答案录入表 / 导入正确答案", expanded=not answer_ready):
            render_answer_setup(setup_template)

    st.subheader("4. 照片目录")
    directory_col, chooser_col = st.columns([5, 1])
    with directory_col:
        folder_text = st.text_input(
            "答题卡照片所在目录",
            value=st.session_state.folder,
            placeholder="例如：/Users/你的用户名/Desktop/本次定位测照片",
        )
    with chooser_col:
        st.write("")
        if st.button("选择文件夹", width="stretch", key="setup_choose_folder"):
            selected = choose_macos_folder()
            if selected:
                st.session_state.folder = selected
                st.rerun()
    if folder_text != st.session_state.folder:
        st.session_state.folder = folder_text
    folder = Path(st.session_state.folder).expanduser() if st.session_state.folder else None
    images = image_paths(folder) if folder and folder.is_dir() else []
    folder_ready = bool(images)
    if folder_ready:
        st.success(f"已选择：{folder}；发现 {len(images)} 张可处理图片。")
    elif st.session_state.folder:
        st.warning("该目录不存在、无法访问，或其中没有 jpg / jpeg / png / heic 图片。")
    else:
        st.warning("尚未选择照片目录。")

    st.divider()
    ready = roster_ready and template_ready and answer_ready and folder_ready
    if not ready:
        st.info("完成以上四项设置后，即可进入扫描工作台。")
    if st.button("进入扫描工作台", type="primary", disabled=not ready, key="enter_scan_workspace"):
        st.session_state.view = "scan"
        st.rerun()


def synchronize_record_issues(record: dict) -> bool:
    """只同步待审核队列；发生变化时使旧导出缓存失效。"""
    source = record["Source Image"]
    current_issues = st.session_state.issues.get(source, [])
    synchronized = synchronize_part_review(record, current_issues, st.session_state.item_rows, st.session_state.resolved)
    if synchronized is current_issues:
        return False
    st.session_state.issues[source] = synchronized
    st.session_state.exports = None
    return True


def refresh_status(record: dict, students: dict) -> None:
    update_review_flag(record, st.session_state.item_rows)
    if record.get("Manual Override"):
        record["Status"] = "OK"
        record["Low Answer Warning"] = None
        return
    source = record["Source Image"]
    synchronize_record_issues(record)
    pending = [item for item in st.session_state.issues.get(source, []) if issue_key(source, item["key"]) not in st.session_state.resolved]
    record["Low Answer Warning"] = low_answer_warning(record, st.session_state.item_rows, pending)
    if (record["Exam ID"] not in students and not record.get("Identity Confirmed")) or "?" in str(record["Exam ID"]):
        record["Status"] = "CHECK_ID"
        return
    if any(item.get("kind") == "part_empty" for item in pending):
        record["Status"] = "CHECK_PART_EMPTY"
    else:
        record["Status"] = "CHECK_MARK" if pending else "OK"


def open_result_source_image() -> None:
    """处理结果表的 File Name 按钮回调。"""
    clicked = st.session_state.get("result_source_open")
    if not clicked:
        return
    row_index = clicked.get("row")
    records = st.session_state.get("records", [])
    if not isinstance(row_index, int) or not 0 <= row_index < len(records):
        st.session_state.preview_notice = (False, "无法定位该条扫描记录。")
        return
    st.session_state.preview_notice = open_original_in_preview(Path(records[row_index]["Source Path"]))


def rescan_modified_source(record: dict, template_data: dict, student_data: dict) -> None:
    """只重新识别已保存的当前图片，并替换其旧结果。"""
    path = Path(record["Source Path"])
    old_total = record.get("Total", "")
    new_record, new_items = scan_one(path, template_data, student_data)
    source = record["Source Image"]
    reset_review_widgets(source)
    index = st.session_state.records.index(record)
    st.session_state.records[index] = new_record
    st.session_state.item_rows = [
        row for row in st.session_state.item_rows if row.get("Source Image") != source
    ] + new_items
    issues = prepare_mark_review(new_record, path, template_data, new_items)
    if issues:
        st.session_state.issues[source] = issues
        new_record["Low Answer Warning"] = low_answer_warning(new_record, new_items, issues)
    else:
        st.session_state.issues.pop(source, None)
    st.session_state.resolved = {
        value for value in st.session_state.resolved if not value.startswith(f"{source}::")
    }
    st.session_state.confirmed_warnings.discard(source)
    st.session_state.stable_review_sources.discard(source)
    refresh_status(new_record, student_data)
    append_audit(
        new_record,
        change_type="重新识别修改后图片",
        target="答题卡图片",
        original_value=old_total,
        corrected_value=new_record.get("Total", ""),
        note="检测到原图已保存，仅重新识别当前图片",
    )
    st.session_state.pending_image_rescan = None
    st.session_state.exports = None
    persist_current_session()


def show_source_file_name(record: dict, key: str) -> None:
    """在人工检查页提供“修图—保存—自动重识别”的单一入口。"""
    st.write(f"File Name：`{record['File Name']}`")
    pending = st.session_state.get("pending_image_rescan") or {}
    is_waiting = pending.get("source_image") == record["Source Image"]
    if st.button(
        "等待图片保存…" if is_waiting else "修改图片并重新识别",
        key=f"edit_rescan_{key}",
        disabled=is_waiting,
        help="用 Mac“预览”打开原图；保存修改后，软件会自动重新识别本张。",
    ):
        path = Path(record["Source Path"])
        baseline = path.stat().st_mtime_ns if path.is_file() else 0
        opened, message = open_original_in_preview(path)
        if not opened:
            st.error(message)
        else:
            st.session_state.pending_image_rescan = {
                "source_image": record["Source Image"],
                "baseline_mtime_ns": baseline,
            }
            st.session_state.image_rescan_notice = (
                "info",
                f"已打开 {record['File Name']}。请在“预览”中修改并保存；检测到保存后将自动重新识别。",
            )
            st.rerun()
    st.caption("修改并保存原图后，软件只重新识别本张，不重扫整批。")


@st.fragment(run_every="1s")
def watch_pending_image_rescan() -> None:
    """监视“预览”中的原图保存，变更后自动重识别。"""
    pending = st.session_state.get("pending_image_rescan")
    if not pending:
        return
    record = find_record(str(pending.get("source_image", "")))
    if record is None:
        st.session_state.pending_image_rescan = None
        return
    path = Path(record["Source Path"])
    current_mtime = path.stat().st_mtime_ns if path.is_file() else 0
    baseline = int(pending.get("baseline_mtime_ns", 0))
    if current_mtime > baseline:
        rescan_modified_source(record, template, students)
        st.session_state.image_rescan_notice = (
            "success", f"已检测到 {record['File Name']} 保存，并完成本张重新识别。",
        )
        st.rerun()
    st.info(f"正在等待 {record['File Name']} 保存。保存后将自动重新识别。")
    control_1, control_2 = st.columns(2)
    with control_1:
        if st.button("已保存，立即重新识别", key="force_pending_image_rescan"):
            rescan_modified_source(record, template, students)
            st.session_state.image_rescan_notice = ("success", f"{record['File Name']} 已重新识别。")
            st.rerun()
    with control_2:
        if st.button("取消本次修图", key="cancel_pending_image_rescan"):
            st.session_state.pending_image_rescan = None
            st.rerun()


def find_record(source_image: str) -> dict | None:
    return next((record for record in st.session_state.records if record["Source Image"] == source_image), None)


def remember_review_panel_state(source_image: str) -> None:
    if st.session_state.get(review_panel_key(source_image), True):
        st.session_state.closed_review_sources.discard(source_image)
    else:
        st.session_state.closed_review_sources.add(source_image)


def complete_review_card(source_image: str) -> None:
    """Hide a finished card and move to an unfinished card that is still open."""
    record = find_record(source_image)
    if record is None or record.get("Status") != "OK":
        return
    st.session_state.stable_review_sources.discard(source_image)
    st.session_state.review_navigation = {
        "target": first_pending_review_key(st.session_state.records, st.session_state.closed_review_sources),
        "token": uuid.uuid4().hex,
    }


def current_mark_choice(record: dict, item: dict) -> str:
    if "section" in item:
        row = next((row for row in st.session_state.item_rows if row["Source Image"] == record["Source Image"] and row["Section"] == item["section"] and str(row["Question"]) == str(item["number"])), None)
        return (row or {}).get("Marked Answer", "")
    if "field" in item:
        value = record.get({"score_part2": "Written_Part2", "score_part3": "Written_Part3", "score_writing": "Writing"}[item["field"]])
        return "" if value is None else str(value)
    return ""


def set_review_notice(kind: str, message: str) -> None:
    st.session_state.review_notice = (kind, message)


def handoff_results_to_management(result_file: Path) -> int:
    """通过合并版的本机专用通道交接成绩，不要求用户另存或重新上传。"""
    endpoint = os.environ.get("RESULTS_BRIDGE_URL", "").strip()
    token = os.environ.get("RESULTS_BRIDGE_TOKEN", "").strip()
    if not endpoint or not token:
        raise RuntimeError("当前不是合并版运行环境，请使用下方 Excel 备份导出。")
    boundary = f"joy-{uuid.uuid4().hex}"
    file_bytes = result_file.read_bytes()
    body = b"".join((
        f"--{boundary}\r\n".encode(),
        b'Content-Disposition: form-data; name="file"; filename="grading-handoff.xlsx"\r\n',
        b"Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n",
        file_bytes,
        f"\r\n--{boundary}--\r\n".encode(),
    ))
    request = urllib.request.Request(
        endpoint,
        data=body,
        method="POST",
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "X-Joy-Desktop-Token": token,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            payload = json.loads(exc.read().decode("utf-8"))
            detail = "\n".join(filter(None, [payload.get("error", ""), *(payload.get("issues") or [])]))
        except (json.JSONDecodeError, UnicodeDecodeError):
            detail = f"结果管理服务返回错误 {exc.code}"
        raise RuntimeError(detail or "成绩交接失败。") from exc
    except OSError as exc:
        raise RuntimeError(f"无法连接结果管理服务：{exc}") from exc
    return int(payload.get("count", 0))


def save_exam_id_review(source_image: str, students: dict) -> None:
    """在按钮回调中完成保存。

    Streamlit 点击按钮本身就会重跑一次；回调先写入状态，可避免之前再调用
    st.rerun() 造成的第二次闪烁。
    """
    record = find_record(source_image)
    if record is None:
        set_review_notice("error", "未找到需要修正的答题卡记录。")
        return
    reviewer = ensure_reviewer()
    normalized_id = normalize_exam_id(st.session_state.get(f"id_{source_image}", ""))
    before_id = record.get("Exam ID")
    entry = None
    if len(normalized_id) == 6 and normalized_id.isdigit() and normalized_id in students:
        entry = append_audit(
            record, change_type="修正考号", target="Exam ID",
            original_value=before_id, corrected_value=normalized_id,
        )
    valid, message = apply_exam_id(
        record, st.session_state.item_rows, normalized_id, students,
        operator=reviewer,
        review_basis=st.session_state.review_basis,
        changed_at=entry["Changed At"] if entry else "",
    )
    if not valid:
        set_identity_notice(source_image, "error", message)
        return
    st.session_state.stable_review_sources.add(source_image)
    refresh_status(record, students)
    st.session_state.exports = None
    persist_current_session()
    set_identity_notice(source_image, "success", f"考号 {normalized_id} 已匹配 {record['Chinese Name']}，并确认保存。")


def set_identity_notice(source_image: str, kind: str, message: str) -> None:
    st.session_state.identity_notices[source_image] = (kind, message)


def save_student_supplement(source_image: str, students: dict) -> None:
    """Confirm a missing student only after validating the submitted identity fields."""
    record = find_record(source_image)
    if record is None:
        set_review_notice("error", "未找到需要补全身份的答题卡记录。")
        return
    entered_id = str(st.session_state.get(f"id_{source_image}", "")).strip()
    normalized_id = normalize_exam_id(entered_id)
    if normalized_id in students:
        set_identity_notice(source_image, "error", "该考号已在当前名单中，请使用“确认考号”匹配名单。")
        return
    student_data = {
        column: str(st.session_state.get(f"supplement_{field}_{source_image}", "")).strip()
        for column, field in (
            ("Chinese Name", "name"), ("Year Level", "grade"), ("Branch", "branch"),
            ("Class", "class"), ("Exam Session", "session"),
        )
    }
    entry = audit_entry(
        record, operator=ensure_reviewer(), change_type="补全名单外学生", target="学生身份",
        original_value=record.get("Exam ID", ""),
        corrected_value=f"{normalized_id} / {student_data['Chinese Name']}",
        review_basis=st.session_state.review_basis, note="原始名单中无该考号",
    )
    try:
        apply_student_supplement(
            record, st.session_state.item_rows, student_data, exam_id=entered_id,
            operator=st.session_state.reviewer, review_basis=st.session_state.review_basis,
            changed_at=entry["Changed At"],
        )
    except ValueError as exc:
        set_identity_notice(source_image, "error", str(exc))
        return
    st.session_state.audit_log.append(entry)
    st.session_state.stable_review_sources.add(source_image)
    refresh_status(record, students)
    st.session_state.exports = None
    persist_current_session()
    set_identity_notice(source_image, "success", f"考号 {normalized_id} 的后补学生信息已确认并保存。")


def render_card_overview(record: dict, template: dict) -> None:
    """One source image and editing entry for both identity and answer review."""
    source = record["Source Image"]
    source_path = Path(record["Source Path"])
    st.markdown("#### 基础信息")
    show_source_file_name(record, f"review_source_{source}")
    st.write(f"扫描状态：{record.get('Scan Result Status', '')}")
    with st.container(key=f"review_images_{source}"):
        id_column, card_column = st.columns([1, 2])
        with id_column:
            id_image = cached_exam_id_crop(str(source_path), _source_version(source_path), template)
            if id_image is not None:
                st.image(id_image, caption="考号区域", width="stretch")
            else:
                st.warning("无法生成考号区域截图；请查看右侧整张答题卡。")
        with card_column:
            card_image = cached_answer_card_preview(str(source_path), _source_version(source_path))
            if card_image is not None:
                st.image(card_image, caption="整张答题卡", width="stretch")
            else:
                st.warning("无法读取原始答题卡图片。")


def render_exam_identity_review(record: dict, students: dict) -> None:
    source = record["Source Image"]
    st.markdown("#### 考号核对")
    st.caption("名单学号 S10086 对应答题卡考号 010086；导出成绩保留原始学号。")
    if record["Status"] == "CHECK_ID":
        recognized_id = str(record.get("Exam ID", ""))
        st.write(f"系统识别：`{recognized_id}`")
        normalized_recognized = normalize_exam_id(recognized_id)
        with st.form(f"exam_id_form_{source}", clear_on_submit=False):
            entered_id = st.text_input(
                "正确考号或原始学号",
                value=normalized_recognized if len(normalized_recognized) == 6 and normalized_recognized.isdigit() else "",
                key=f"id_{source}",
                help="可填写 010086 或 S10086，系统按同一个学生匹配。",
            )
            st.form_submit_button("确认考号", key=f"confirm_id_{source}",
                                  on_click=save_exam_id_review, args=(source, students))
        notice = st.session_state.identity_notices.get(source)
        if notice:
            kind, message = notice
            (st.success if kind == "success" else st.error)(message)
        normalized_id = normalize_exam_id(entered_id)
        if len(normalized_id) == 6 and normalized_id.isdigit() and normalized_id not in students:
            with st.expander("考号识别正确，但原名单漏了该学生", expanded=True):
                st.caption(f"后补学生考号：{normalized_id}。补全后仅用于本批阅卷，原始名单 Excel 不会被改写。")
                with st.form(f"supplement_form_{source}", clear_on_submit=False):
                    for label, field in (("中文名", "name"), ("年级", "grade"), ("分校", "branch"),
                                         ("班级", "class"), ("笔试时间", "session")):
                        st.text_input(label, key=f"supplement_{field}_{source}",
                                      placeholder="选填，未知可留空" if field == "grade" else "",
                                      help="年级仅供参考，可在结果管理中补充。" if field == "grade" else None)
                    st.form_submit_button("确认为后补学生", key=f"confirm_supplement_{source}",
                                          on_click=save_student_supplement, args=(source, students))
    else:
        notice = st.session_state.identity_notices.get(source)
        if notice:
            kind, message = notice
            (st.success if kind == "success" else st.error)(message)
        prefix = "已确认为后补学生" if record.get("Identity Confirmed") else "已匹配当前名单"
        st.caption(f"{prefix}：考号 {record['Exam ID']} · {record.get('Chinese Name', '')}")


def save_mark_review(source_image: str, item_key: str, students: dict, choice_widget_key: str | None = None, display_title: str | None = None) -> None:
    """保存单题人工修正，只使用按钮自带的一次重跑。"""
    record = find_record(source_image)
    item = next(
        (candidate for candidate in st.session_state.issues.get(source_image, []) if candidate.get("key") == item_key),
        None,
    )
    if record is None or item is None:
        set_review_notice("error", "未找到需要保存的复核项目，请重新打开本卷。")
        return
    widget_key = choice_widget_key or f"choice_{source_image}_{item_key}"
    selected = str(st.session_state.get(widget_key, "空白"))
    reviewer = ensure_reviewer()
    before_value = current_mark_choice(record, item) or "空白"
    if item.get("kind") == "grader_score":
        score_column = {"score_part2": "Written_Part2", "score_part3": "Written_Part3"}.get(item.get("field"))
        if score_column and record.get("Score Entry States", {}).get(score_column) in {"BLANK", "AMBIGUOUS"}:
            before_value = "教师登分区未成功读取"
    entry = append_audit(
        record,
        change_type="确认教师登分" if item.get("kind") == "grader_score" else "修正填涂",
        target=item["title"],
        original_value=before_value, corrected_value=selected,
    )
    apply_mark(
        record, st.session_state.item_rows, item, None if selected == "空白" else selected,
        operator=reviewer,
        review_basis=st.session_state.review_basis,
        changed_at=entry["Changed At"],
    )
    st.session_state.resolved.add(issue_key(source_image, item["key"]))
    record["Reopened Review Questions"] = [key for key in record.get("Reopened Review Questions", []) if key != item["key"]]
    # 已保存的题目在当前操作会话中保留原位，避免页面高度突变导致滚动跳动。
    st.session_state.stable_review_sources.add(source_image)
    refresh_status(record, students)
    st.session_state.exports = None
    persist_current_session()
    set_review_notice("success", f"{display_title or item['title']} 修正已保存。")


def confirm_part_review(source_image: str, item_key: str, students: dict) -> None:
    """确认整 Part，在按钮回调中保存，再由本次局部刷新展示结果。"""
    record = find_record(source_image)
    item = next((candidate for candidate in st.session_state.issues.get(source_image, []) if candidate.get("key") == item_key), None)
    if record is None or item is None or item.get("kind") != "part_empty":
        set_review_notice("error", "未找到需要确认的 Part，请重新打开本卷。")
        return
    full_key = issue_key(source_image, item_key)
    if full_key in st.session_state.resolved:
        return
    ensure_reviewer()
    entry = append_audit(record, change_type="人工确认", target=item["title"],
                         original_value="待确认", corrected_value="整Part为空")
    apply_part_empty(record, st.session_state.item_rows, item,
                     operator=st.session_state.reviewer, review_basis=st.session_state.review_basis,
                     changed_at=entry["Changed At"])
    confirmed_keys = {question["key"] for question in item["question_issues"]}
    record["Reopened Review Questions"] = [key for key in record.get("Reopened Review Questions", []) if key not in confirmed_keys]
    st.session_state.resolved.add(full_key)
    st.session_state.stable_review_sources.add(source_image)
    refresh_status(record, students)
    st.session_state.exports = None
    persist_current_session()
    set_review_notice("success", f"{item['title']} 已全部记为空白并保存。")


def expand_part_review(source_image: str, item_key: str, students: dict) -> None:
    """展开待检查题目，避免在绘制到一半时强制中断并重跑整页。"""
    record = find_record(source_image)
    issues = st.session_state.issues.get(source_image, [])
    item = next((candidate for candidate in issues if candidate.get("key") == item_key), None)
    if record is None or item is None or item.get("kind") != "part_empty":
        set_review_notice("error", "未找到需要展开的 Part，请重新打开本卷。")
        return
    record["Expanded Review Sections"] = sorted(set(record.get("Expanded Review Sections", [])) | {item["section"]})
    if issue_key(source_image, item_key) in st.session_state.resolved:
        question_keys = {question["key"] for question in item["question_issues"]}
        record["Reopened Review Questions"] = sorted(set(record.get("Reopened Review Questions", [])) | question_keys)
        for question_key in question_keys:
            st.session_state.resolved.discard(issue_key(source_image, question_key))
    pending_questions = pending_part_questions(record, item, st.session_state.item_rows, st.session_state.resolved)
    item_index = issues.index(item)
    st.session_state.issues[source_image] = issues[:item_index] + pending_questions + issues[item_index + 1:]
    st.session_state.resolved.discard(issue_key(source_image, item_key))
    if pending_questions:
        message = f"{item['title']} 已展开 {len(pending_questions)} 道待检查题目，已在当前答题卡下方按题号显示。"
        saved_count = len(item["question_issues"]) - len(pending_questions)
        if saved_count:
            message += f"其余 {saved_count} 道题已保存人工结果，无需重复确认。"
    else:
        st.session_state.stable_review_sources.add(source_image)
        message = f"{item['title']} 的题目已全部确认，已保留保存结果并清除过期空白提示。"
    st.session_state.part_expand_notices[source_image] = message
    # 展开停留在本 Part 的第一道待确认题目，使用新的导航令牌覆盖此前收起动作。
    st.session_state.review_navigation = {
        "target": review_item_key(source_image, pending_questions[0]["key"])
        if pending_questions else review_answers_key(source_image),
        "token": uuid.uuid4().hex,
    }
    refresh_status(record, students)
    st.session_state.exports = None
    persist_current_session()



initialize()
render_display_controls()
with st.container(key="scanner_workbench") as workbench:
    st.title("佳音考试管理 · 阅卷")
    ensure_runtime_config()
    if st.session_state.view == "setup":
        render_exam_setup()
        st.stop()

    files = required_files()
    try:
        setup_template = load_template()
    except Exception as exc:
        st.error(f"答题卡模板无法载入：{exc}")
        st.stop()
    missing = [label for label, path in files.items() if not path.is_file()]

    if st.button("返回本次考试设置", key="back_to_exam_setup"):
        st.session_state.view = "setup"
        st.rerun()

    st.subheader("系统状态")
    if missing:
        st.error("缺少必要文件：" + "、".join(missing) + "。请恢复 config/ 中的文件后再开始扫描。")
        st.stop()
    try:
        students = load_students()
        template = load_template()
    except Exception as exc:
        st.error(f"配置文件无法载入：{exc}")
        st.stop()
    status_columns = st.columns(4)
    status_columns[0].metric("学生名单", files["学生名单"].name)
    status_columns[1].metric("名单人数", len(students))
    status_columns[2].metric("答题卡模板", "已载入")
    status_columns[3].metric("标准答案", "已载入")

    st.subheader("选择照片目录")
    directory_col, chooser_col = st.columns([5, 1])
    with directory_col:
        folder_text = st.text_input("照片所在目录", value=st.session_state.folder, placeholder="例如：/Users/你的用户名/Desktop/8月23日定位测照片")
    with chooser_col:
        st.write("")
        if st.button("选择文件夹", width="stretch"):
            selected = choose_macos_folder()
            if selected:
                st.session_state.folder = selected
                st.rerun()
    folder = Path(folder_text).expanduser() if folder_text else None
    if folder_text != st.session_state.folder:
        st.session_state.folder = folder_text
    if folder and folder.is_dir():
        images = image_paths(folder)
        st.caption(f"已选择：{folder}；发现 {len(images)} 张可处理图片（jpg / jpeg / png / heic）。")
    else:
        images = []
        if folder_text:
            st.warning("该目录不存在或无法访问。")

    # 同一图片目录的复核进度在 App 重启后自动恢复。
    recovery_notice = st.empty()
    resolved_folder = str(folder.resolve()) if folder and folder.is_dir() else ""
    if resolved_folder and st.session_state.loaded_session_folder != resolved_folder and not st.session_state.records:
        saved_session = load_review_session(folder)
        st.session_state.loaded_session_folder = resolved_folder
        if saved_session:
            st.session_state.records = saved_session["records"]
            st.session_state.item_rows = saved_session["item_rows"]
            st.session_state.audit_log = saved_session["audit_log"]
            st.session_state.resolved = saved_session["resolved"]
            st.session_state.confirmed_warnings = saved_session["confirmed_warnings"]
            st.session_state.reviewer = saved_session.get("reviewer", "") or st.session_state.reviewer
            st.session_state.issues = {}
            for record in st.session_state.records:
                source_path = folder / str(record.get("Source Image", ""))
                record["Source Path"] = str(source_path.resolve())
                if source_path.is_file():
                    issues = prepare_mark_review(record, source_path, template, st.session_state.item_rows, st.session_state.resolved)
                    if issues:
                        st.session_state.issues[record["Source Image"]] = issues
                refresh_status(record, students)
            recovery_notice.info(f"已恢复上次进度：{len(st.session_state.records)} 张答题卡，{len(st.session_state.audit_log)} 条人工复核记录。")

    st.subheader("开始扫描")
    scan_button_label = "重新识别全部图片（清空当前复核进度）" if st.session_state.records else "开始识别"
    scan_progress = st.empty()
    if st.button(scan_button_label, type="primary", disabled=not images):
        reset_review_widgets()
        st.session_state.records, st.session_state.item_rows, st.session_state.issues, st.session_state.resolved, st.session_state.confirmed_warnings = [], [], {}, set(), set()
        st.session_state.audit_log = []
        st.session_state.part_expand_notices = {}
        st.session_state.stable_review_sources = set()
        progress = scan_progress.progress(0, text="正在准备扫描…")
        for index, path in enumerate(images, 1):
            progress.progress(index / len(images), text=f"正在处理 {index} / {len(images)}：{path.name}")
            record, item_rows = scan_one(path, template, students)
            st.session_state.records.append(record)
            st.session_state.item_rows.extend(item_rows)
            issues = prepare_mark_review(record, path, template, item_rows)
            if issues:
                st.session_state.issues[path.name] = issues
                record["Low Answer Warning"] = low_answer_warning(record, item_rows, issues)
        for record in st.session_state.records:
            refresh_status(record, students)
        st.session_state.exports = None
        persist_current_session()
        progress.progress(1.0, text="扫描完成")

@st.fragment
def render_review_workspace(students: dict, template: dict) -> None:
    """Update review, scores and export controls together without rerunning setup."""
    records = st.session_state.records
    # 当前会话也可能保留旧整 Part 候选，不能只在恢复进度时清理。
    for record in records:
        if synchronize_record_issues(record):
            refresh_status(record, students)
    install_review_scroll_lock(st.session_state.get("review_navigation"))
    # 本系统只处理答题卡图片复核。纸质原卷是导出后的独立后续流程，
    # 不应在扫描工作台中作为二选一的核查依据。
    st.session_state.review_basis = "答题卡图片"
    ok = sum(record["Status"] == "OK" for record in records)
    st.success(f"总照片：{len(records)}　识别成功：{ok}　需要检查：{len(records) - ok}")
    with st.container(border=True):
        st.warning("⚠️ 开始人工复核前，请先确认操作人。姓名将写入每一条修正记录。")
        st.markdown("### 👤 本次复核操作人")
        st.text_input(
            "操作人姓名（请务必确认）",
            key="reviewer",
            placeholder="请输入实际复核人姓名",
        )
        st.caption("当前阶段固定为“答题卡图片复核”。纸质原卷的复查名单由导出文件 Sheet3 提供。")
        if st.session_state.reviewer.strip():
            st.success(f"当前操作人：{st.session_state.reviewer.strip()}（下方所有人工修正都将记录此姓名）")
        else:
            st.error(f"尚未填写姓名；如直接修正，系统将记录当前 Mac 账户“{getpass.getuser()}”。")
    st.subheader("处理结果")
    st.caption("点击 File Name 可用 Mac“预览”打开对应的原始图片，并可直接编辑后保存。")
    shown_columns = [column for column in RESULT_COLUMNS if column != SUMMARY_SEPARATOR_COLUMN]
    shown_columns.extend(("Needs Review", "Review Reason", "Status"))
    st.dataframe(
        [{column: record.get(column, "") for column in shown_columns} for record in records],
        width="stretch",
        hide_index=True,
        column_config={
            "File Name": st.column_config.ButtonColumn(
                "File Name",
                type="tertiary",
                help="点击用 Mac“预览”打开原始图片，可直接编辑并保存。",
                on_click=open_result_source_image,
                key="result_source_open",
            ),
            "Needs Review": st.column_config.TextColumn("需要人工核对学生试卷"),
            "Review Reason": st.column_config.TextColumn("异常原因"),
        },
    )
    preview_notice = st.session_state.pop("preview_notice", None)
    if preview_notice:
        opened, message = preview_notice
        (st.success if opened else st.error)(message)

    st.subheader("人工检查")
    st.info(f"👤 当前复核操作人：{st.session_state.reviewer.strip() or getpass.getuser()}　｜　答题卡图片复核")
    review_notice = st.session_state.pop("review_notice", None)
    if review_notice:
        notice_kind, notice_message = review_notice
        if notice_kind == "success":
            st.toast(notice_message, icon="✅")
        else:
            {"info": st.info, "warning": st.warning}.get(notice_kind, st.error)(notice_message)
    image_rescan_notice = st.session_state.pop("image_rescan_notice", None)
    if image_rescan_notice:
        notice_kind, notice_message = image_rescan_notice
        {"success": st.success, "info": st.info, "warning": st.warning}.get(notice_kind, st.error)(notice_message)
    watch_pending_image_rescan()
    # 待检查队列直接展示；不再使用看似无反应的二次入口。
    st.session_state.show_checks = True
    if st.session_state.get("show_checks"):
        check_records = [
            record for record in records
            if record["Status"] in {"CHECK_ID", "CHECK_MARK", "CHECK_PART_EMPTY"}
            or record["Source Image"] in st.session_state.stable_review_sources
        ]
        if not check_records:
            st.info("本批次没有需要人工检查的项目。")
        pending_checks = [record for record in check_records if record["Status"] in PENDING_REVIEW_STATUSES]
        if pending_checks and all(record["Source Image"] in st.session_state.closed_review_sources for record in pending_checks):
            st.info(f"还有 {len(pending_checks)} 张待复核考卷已折叠，请手动展开后继续审核。")
        for record in check_records:
            display_status = "已完成" if record["Status"] == "OK" else record["Status"]
            panel_key = review_panel_key(record["Source Image"])
            st.session_state.setdefault(panel_key, record["Source Image"] not in st.session_state.closed_review_sources)
            with st.container(key=review_card_key(record["Source Image"])), st.expander(
                f"{display_status} · {record['Source Image']}", expanded=True, key=panel_key,
                on_change=remember_review_panel_state, args=(record["Source Image"],),
            ):
                with st.container(key=f"review_overview_{record['Source Image']}"):
                    render_card_overview(record, template)
                with st.container(key=f"review_identity_{record['Source Image']}"):
                    render_exam_identity_review(record, students)
                with st.container(key=review_answers_key(record["Source Image"])):
                    st.markdown("#### 答题内容核对")
                    record_issues = st.session_state.issues.get(record["Source Image"], [])
                    unresolved_record_issues = [
                        item for item in record_issues
                        if issue_key(record["Source Image"], item["key"]) not in st.session_state.resolved
                    ]
                    if (
                        record["Status"] in {"CHECK_MARK", "CHECK_PART_EMPTY"}
                        or unresolved_record_issues
                        or record["Source Image"] in st.session_state.stable_review_sources
                    ):
                        issues = record_issues
                        unresolved = [item for item in issues if issue_key(record["Source Image"], item["key"]) not in st.session_state.resolved]
                        warning_slot = st.empty()
                        part_notice_slot = st.empty()
                        missing_items_slot = st.empty()
                        warning = record.get("Low Answer Warning")
                        if warning and unresolved:
                            instructions = (
                                "请直接使用下方的“确认整 Part 为空”或“逐题检查”处理。"
                                if any(item.get("kind") == "part_empty" for item in unresolved)
                                else "请检查下方尚未确认的题目并保存结果。"
                            )
                            warning_slot.warning(
                                f"疑似异常答题卡\n\n原因：{warning}\n\n"
                                f"{instructions}"
                            )
                        part_expand_notice = st.session_state.part_expand_notices.pop(record["Source Image"], None)
                        if part_expand_notice:
                            part_notice_slot.info(part_expand_notice)
                        if not unresolved and record["Source Image"] not in st.session_state.stable_review_sources:
                            missing_items_slot.info("该项没有可定位的填涂框；请检查原始照片是否完整。")
                        display_issues = issues if record["Source Image"] in st.session_state.stable_review_sources else unresolved
                        for item in display_issues:
                            # 单题整套内容在同一替换槽内更新，避免提示改变时控件错位。
                            item_slot = st.empty()
                            with item_slot.container(key=review_item_key(record["Source Image"], item["key"])):
                                item_is_resolved = issue_key(record["Source Image"], item["key"]) in st.session_state.resolved
                                st.markdown("---")
                                if item.get("kind") == "part_empty":
                                    st.write(f"Part：{item['title']}")
                                    st.write(f"题目范围：{item['question_range']}")
                                    st.write("复核结果：已确认整 Part 为空（已保存）" if item_is_resolved else f"检测结果：{item['detail']}")
                                    part_col_1, part_col_2 = st.columns(2)
                                    with part_col_1:
                                        st.button("确认整Part为空", disabled=item_is_resolved,
                                                  key=f"confirm_part_{record['Source Image']}_{item['section']}",
                                                  on_click=confirm_part_review, args=(record["Source Image"], item["key"], students))
                                    with part_col_2:
                                        st.button("改为逐题检查" if item_is_resolved else "逐题检查",
                                                  key=f"expand_part_{record['Source Image']}_{item['section']}",
                                                  on_click=expand_part_review, args=(record["Source Image"], item["key"], students))
                                    if item_is_resolved:
                                        st.success("该 Part 已确认并保存。")
                                    continue
                                display_title = review_item_title(item, template)
                                st.write(f"题号或得分区域：{display_title}")
                                st.write(f"{'原始识别（已复核）' if item_is_resolved else '当前识别'}：{item['detail'].replace('当前识别结果：', '')}")
                                if item["crop"] is not None:
                                    st.image(item["crop"], caption="当前题目局部图", width=500)
                                if item["key"] == "image":
                                    continue
                                choices = (["空白"] if item.get("allow_blank", True) else []) + item["choices"]
                                current_choice = current_mark_choice(record, item)
                                if not current_choice or current_choice not in choices:
                                    current_choice = choices[0]
                                choice_index = choices.index(current_choice) if current_choice in choices else 0
                                # Use the same widget identity before and after saving.
                                choice_widget_key = f"choice_{record['Source Image']}_{item['key']}"
                                st.caption(f"✅ 已保存结果：{current_choice}" if item_is_resolved else "复核结果：尚未保存")
                                with st.container(key=f"review_anchor_{record['Source Image']}_{item['key']}"):
                                    with st.form(
                                        key=f"review_form_{record['Source Image']}_{item['key']}",
                                        border=False,
                                    ):
                                        st.radio(
                                            "教师确认分数" if item.get("kind") == "grader_score" else "真实填涂",
                                            choices,
                                            horizontal=True,
                                            index=choice_index,
                                            key=choice_widget_key,
                                        )
                                        st.form_submit_button(
                                            "修改并重新保存" if item_is_resolved else "保存该项修正",
                                            key=f"save_mark_{record['Source Image']}_{item['key']}",
                                            on_click=save_mark_review,
                                            args=(record["Source Image"], item["key"], students, choice_widget_key, display_title),
                                        )
                    else:
                        st.caption("暂无需要人工复核的答题内容项目。")
                if record["Status"] == "OK" and record["Source Image"] in st.session_state.stable_review_sources:
                    st.success("本张答题卡已完成复核。为了避免保存时页面跳动，已完成题目暂时保留在原位。")
                    st.button(
                        "完成并收起本张", key=f"hide_completed_{record['Source Image']}",
                        help="收起后定位到第一张未完成且仍展开的考卷，保持手动折叠状态；全部完成后定位到导出区。",
                        on_click=complete_review_card, args=(record["Source Image"],),
                    )

    with st.container(key=EXPORT_TARGET_KEY):
        st.subheader("导出最终成绩文件")
    st.caption("自动保存只保存复核进度，不会生成成绩 Excel，也不会弹出“另存为”。只有点击下方按钮才会导出。")
    pending_records = [record for record in records if record["Status"] in {"CHECK_ID", "CHECK_MARK", "CHECK_PART_EMPTY"}]
    information_issues = student_information_issues(records)
    if information_issues:
        student_count = len({issue["考号"] for issue in information_issues})
        st.warning(f"有 {student_count} 名学生的 {len(information_issues)} 项信息待补充或核对，仍可继续交接或导出。进入结果管理后可补充，Excel 中附有“信息待补充”清单。")
        with st.expander("查看待补充信息"):
            st.dataframe(information_issues, hide_index=True, width="stretch")
    blank_part_records = [record for record in records if record.get("Blank Parts")]
    if pending_records:
        st.warning(f"仍有 {len(pending_records)} 张答题卡未完成图片复核，完成后才能导出最终成绩。")
    elif blank_part_records:
        st.warning(
            f"本次有 {len(blank_part_records)} 名学生整Part未填涂，建议复查原试卷。"
            "请在导出成绩单的 Sheet3“需复核名单”中查看。"
        )
    bridge_available = bool(
        os.environ.get("RESULTS_BRIDGE_URL", "").strip()
        and os.environ.get("RESULTS_BRIDGE_TOKEN", "").strip()
    )
    if bridge_available and st.button(
        "完成阅卷并进入结果管理",
        type="primary",
        width="stretch",
        disabled=bool(pending_records),
        help="直接使用本批名单和最终成绩进入结果管理，不需要导出或重新上传 Excel。",
    ):
        try:
            with tempfile.TemporaryDirectory(prefix="joy-exam-handoff-") as temp_dir:
                folder_name = Path(st.session_state.folder).name or "results"
                result_file, _ = export_results(
                    records,
                    st.session_state.item_rows,
                    output_dir=Path(temp_dir),
                    export_label=f"{folder_name}_内部交接",
                    include_items=True,
                    audit_log=st.session_state.audit_log,
                )
                count = handoff_results_to_management(result_file)
            st.success(f"已将本批 {count} 名学生及最终成绩交接到结果管理。")
            components.html(
                """
                <script>
                window.parent.postMessage({type: "joy-workflow", target: "results"}, "*");
                </script>
                """,
                height=0,
            )
        except (OSError, RuntimeError) as exc:
            st.error(f"交接失败：{exc}")
    export_label = "另存 Excel 备份…" if bridge_available else "导出并另存最终成绩…"
    if st.button(
        export_label,
        type="secondary" if bridge_available else "primary",
        width="stretch",
        disabled=bool(pending_records),
    ):
        try:
            result_file = save_current_results(records, st.session_state.item_rows, st.session_state.folder, st.session_state.audit_log)
            folder_name = Path(st.session_state.folder).name or "results"
            saved_path = save_as_macos(result_file, default_name=f"{folder_name}_最终成绩.xlsx")
            st.success(f"已生成自动保存文件：\n\n{result_file}\n\n人工另存的默认文件名：{folder_name}_最终成绩.xlsx")
            if saved_path is not None:
                st.success(f"已另存为：\n\n{saved_path}")
        except OSError as exc:
            st.error(f"保存失败：{exc}")
    if st.button("清空本次结果 / 开始新一批"):
        reset_review_widgets()
        delete_review_session(st.session_state.folder)
        for key in ("records", "item_rows", "issues", "resolved", "confirmed_warnings", "exports", "show_checks", "identity_notices", "part_expand_notices", "stable_review_sources", "pending_image_rescan", "image_rescan_notice"):
            st.session_state.pop(key, None)
        st.session_state.audit_log = []
        st.session_state.loaded_session_folder = ""
        st.rerun()


if st.session_state.records:
    with workbench:
        render_review_workspace(students, template)
