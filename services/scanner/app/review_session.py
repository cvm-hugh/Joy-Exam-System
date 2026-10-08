"""Review operations over the current session mapping, independent of page rendering.

The mapping remains owned by Streamlit. Existing keys, audit fields, callback
arguments and saved-session data retain their original format. Keeping a saved
card in the current queue prevents layout changes while an operator is working.
"""
from __future__ import annotations

from collections.abc import MutableMapping
import getpass
from typing import Any
import uuid

from app.review_navigation import (first_pending_review_key, review_answers_key,
                                   review_item_key, review_panel_key)
from app.review_store import audit_entry, save_review_session
from app.roster_import import normalize_exam_id
from app.scanner import update_review_flag
from app.ui_helpers import (apply_exam_id, apply_mark, apply_part_empty,
                            apply_student_supplement, issue_key, low_answer_warning,
                            pending_part_questions, synchronize_part_review)


class ReviewSession:
    def __init__(self, state: MutableMapping[str, Any]) -> None:
        self.state = state

    def save_record_update(self, record: dict, students: dict) -> None:
        """Refresh status, invalidate derived exports, then persist the operation."""
        self.refresh_status(record, students)
        self.state['exports'] = None
        self.persist_current_session()

    def initialize(self) -> None:
        # Rebase an already-open session once; subsequent zoom choices remain intact.
        if self.state.get("ui_zoom_base") != 75:
            self.state["ui_zoom"] = 100
            self.state["ui_zoom_base"] = 75
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
            self.state.setdefault(key, value)

    def persist_current_session(self) -> None:
        """每次人工操作后立即保存，不依赖 Streamlit 会话内存。"""
        if not self.state['folder'] or not self.state['records']:
            return
        save_review_session(
            self.state['folder'],
            self.state['records'],
            self.state['item_rows'],
            self.state['audit_log'],
            self.state['resolved'],
            self.state['confirmed_warnings'],
            self.state['reviewer'],
        )

    def ensure_reviewer(self) -> str:
        """人工修正必须留下操作人；界面未填时使用当前 Mac 账户。"""
        reviewer = str(self.state.get("reviewer", "")).strip()
        if not reviewer:
            reviewer = getpass.getuser().strip() or "本机操作人"
            self.state['reviewer'] = reviewer
        return reviewer

    def append_audit(
        self,
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
            operator=self.state['reviewer'],
            change_type=change_type,
            target=target,
            original_value=original_value,
            corrected_value=corrected_value,
            review_basis=self.state['review_basis'],
            note=note,
        )
        self.state['audit_log'].append(entry)
        return entry

    def synchronize_record_issues(self, record: dict) -> bool:
        """只同步待审核队列；发生变化时使旧导出缓存失效。"""
        source = record["Source Image"]
        current_issues = self.state['issues'].get(source, [])
        synchronized = synchronize_part_review(record, current_issues, self.state['item_rows'], self.state['resolved'])
        if synchronized is current_issues:
            return False
        self.state['issues'][source] = synchronized
        self.state['exports'] = None
        return True

    def refresh_status(self, record: dict, students: dict) -> None:
        update_review_flag(record, self.state['item_rows'])
        if record.get("Manual Override"):
            record["Status"] = "OK"
            record["Low Answer Warning"] = None
            return
        source = record["Source Image"]
        self.synchronize_record_issues(record)
        pending = [item for item in self.state['issues'].get(source, []) if issue_key(source, item["key"]) not in self.state['resolved']]
        record["Low Answer Warning"] = low_answer_warning(record, self.state['item_rows'], pending)
        if (record["Exam ID"] not in students and not record.get("Identity Confirmed")) or "?" in str(record["Exam ID"]):
            record["Status"] = "CHECK_ID"
            return
        if any(item.get("kind") == "part_empty" for item in pending):
            record["Status"] = "CHECK_PART_EMPTY"
        else:
            record["Status"] = "CHECK_MARK" if pending else "OK"

    def find_record(self, source_image: str) -> dict | None:
        return next((record for record in self.state['records'] if record["Source Image"] == source_image), None)

    def remember_review_panel_state(self, source_image: str) -> None:
        if self.state.get(review_panel_key(source_image), True):
            self.state['closed_review_sources'].discard(source_image)
        else:
            self.state['closed_review_sources'].add(source_image)

    def complete_review_card(self, source_image: str) -> None:
        """Hide a finished card and move to an unfinished card that is still open."""
        record = self.find_record(source_image)
        if record is None or record.get("Status") != "OK":
            return
        self.state['stable_review_sources'].discard(source_image)
        self.state['review_navigation'] = {
            "target": first_pending_review_key(self.state['records'], self.state['closed_review_sources']),
            "token": uuid.uuid4().hex,
        }

    def current_mark_choice(self, record: dict, item: dict) -> str:
        if "section" in item:
            row = next((row for row in self.state['item_rows'] if row["Source Image"] == record["Source Image"] and row["Section"] == item["section"] and str(row["Question"]) == str(item["number"])), None)
            return (row or {}).get("Marked Answer", "")
        if "field" in item:
            value = record.get({"score_part2": "Written_Part2", "score_part3": "Written_Part3", "score_writing": "Writing"}[item["field"]])
            return "" if value is None else str(value)
        return ""

    def set_review_notice(self, kind: str, message: str) -> None:
        self.state['review_notice'] = (kind, message)

    def save_exam_id_review(self, source_image: str, students: dict) -> None:
        """在按钮回调中完成保存。

        Streamlit 点击按钮本身就会重跑一次；回调先写入状态，可避免之前再调用
        st.rerun() 造成的第二次闪烁。
        """
        record = self.find_record(source_image)
        if record is None:
            self.set_review_notice("error", "未找到需要修正的答题卡记录。")
            return
        reviewer = self.ensure_reviewer()
        normalized_id = normalize_exam_id(self.state.get(f"id_{source_image}", ""))
        before_id = record.get("Exam ID")
        entry = None
        if len(normalized_id) == 6 and normalized_id.isdigit() and normalized_id in students:
            entry = self.append_audit(
                record, change_type="修正考号", target="Exam ID",
                original_value=before_id, corrected_value=normalized_id,
            )
        valid, message = apply_exam_id(
            record, self.state['item_rows'], normalized_id, students,
            operator=reviewer,
            review_basis=self.state['review_basis'],
            changed_at=entry["Changed At"] if entry else "",
        )
        if not valid:
            self.set_identity_notice(source_image, "error", message)
            return
        self.state['stable_review_sources'].add(source_image)
        self.save_record_update(record, students)
        self.set_identity_notice(source_image, "success", f"考号 {normalized_id} 已匹配 {record['Chinese Name']}，并确认保存。")

    def set_identity_notice(self, source_image: str, kind: str, message: str) -> None:
        self.state['identity_notices'][source_image] = (kind, message)

    def save_student_supplement(self, source_image: str, students: dict) -> None:
        """Confirm a missing student only after validating the submitted identity fields."""
        record = self.find_record(source_image)
        if record is None:
            self.set_review_notice("error", "未找到需要补全身份的答题卡记录。")
            return
        entered_id = str(self.state.get(f"id_{source_image}", "")).strip()
        normalized_id = normalize_exam_id(entered_id)
        if normalized_id in students:
            self.set_identity_notice(source_image, "error", "该考号已在当前名单中，请使用“确认考号”匹配名单。")
            return
        student_data = {
            column: str(self.state.get(f"supplement_{field}_{source_image}", "")).strip()
            for column, field in (
                ("Chinese Name", "name"), ("Year Level", "grade"), ("Branch", "branch"),
                ("Class", "class"), ("Exam Session", "session"),
            )
        }
        entry = audit_entry(
            record, operator=self.ensure_reviewer(), change_type="补全名单外学生", target="学生身份",
            original_value=record.get("Exam ID", ""),
            corrected_value=f"{normalized_id} / {student_data['Chinese Name']}",
            review_basis=self.state['review_basis'], note="原始名单中无该考号",
        )
        try:
            apply_student_supplement(
                record, self.state['item_rows'], student_data, exam_id=entered_id,
                operator=self.state['reviewer'], review_basis=self.state['review_basis'],
                changed_at=entry["Changed At"],
            )
        except ValueError as exc:
            self.set_identity_notice(source_image, "error", str(exc))
            return
        self.state['audit_log'].append(entry)
        self.state['stable_review_sources'].add(source_image)
        self.save_record_update(record, students)
        self.set_identity_notice(source_image, "success", f"考号 {normalized_id} 的后补学生信息已确认并保存。")

    def save_mark_review(self, source_image: str, item_key: str, students: dict, choice_widget_key: str | None = None, display_title: str | None = None) -> None:
        """保存单题人工修正，只使用按钮自带的一次重跑。"""
        record = self.find_record(source_image)
        item = next(
            (candidate for candidate in self.state['issues'].get(source_image, []) if candidate.get("key") == item_key),
            None,
        )
        if record is None or item is None:
            self.set_review_notice("error", "未找到需要保存的复核项目，请重新打开本卷。")
            return
        widget_key = choice_widget_key or f"choice_{source_image}_{item_key}"
        selected = str(self.state.get(widget_key, "空白"))
        reviewer = self.ensure_reviewer()
        before_value = self.current_mark_choice(record, item) or "空白"
        if item.get("kind") == "grader_score":
            score_column = {"score_part2": "Written_Part2", "score_part3": "Written_Part3"}.get(item.get("field"))
            if score_column and record.get("Score Entry States", {}).get(score_column) in {"BLANK", "AMBIGUOUS"}:
                before_value = "教师登分区未成功读取"
        entry = self.append_audit(
            record,
            change_type="确认教师登分" if item.get("kind") == "grader_score" else "修正填涂",
            target=item["title"],
            original_value=before_value, corrected_value=selected,
        )
        apply_mark(
            record, self.state['item_rows'], item, None if selected == "空白" else selected,
            operator=reviewer,
            review_basis=self.state['review_basis'],
            changed_at=entry["Changed At"],
        )
        self.state['resolved'].add(issue_key(source_image, item["key"]))
        record["Reopened Review Questions"] = [key for key in record.get("Reopened Review Questions", []) if key != item["key"]]
        # 已保存的题目在当前操作会话中保留原位，避免页面高度突变导致滚动跳动。
        self.state['stable_review_sources'].add(source_image)
        self.save_record_update(record, students)
        self.set_review_notice("success", f"{display_title or item['title']} 修正已保存。")

    def confirm_part_review(self, source_image: str, item_key: str, students: dict) -> None:
        """确认整 Part，在按钮回调中保存，再由本次局部刷新展示结果。"""
        record = self.find_record(source_image)
        item = next((candidate for candidate in self.state['issues'].get(source_image, []) if candidate.get("key") == item_key), None)
        if record is None or item is None or item.get("kind") != "part_empty":
            self.set_review_notice("error", "未找到需要确认的 Part，请重新打开本卷。")
            return
        full_key = issue_key(source_image, item_key)
        if full_key in self.state['resolved']:
            return
        self.ensure_reviewer()
        entry = self.append_audit(record, change_type="人工确认", target=item["title"],
                             original_value="待确认", corrected_value="整Part为空")
        apply_part_empty(record, self.state['item_rows'], item,
                         operator=self.state['reviewer'], review_basis=self.state['review_basis'],
                         changed_at=entry["Changed At"])
        confirmed_keys = {question["key"] for question in item["question_issues"]}
        record["Reopened Review Questions"] = [key for key in record.get("Reopened Review Questions", []) if key not in confirmed_keys]
        self.state['resolved'].add(full_key)
        self.state['stable_review_sources'].add(source_image)
        self.save_record_update(record, students)
        self.set_review_notice("success", f"{item['title']} 已全部记为空白并保存。")

    def expand_part_review(self, source_image: str, item_key: str, students: dict) -> None:
        """展开待检查题目，避免在绘制到一半时强制中断并重跑整页。"""
        record = self.find_record(source_image)
        issues = self.state['issues'].get(source_image, [])
        item = next((candidate for candidate in issues if candidate.get("key") == item_key), None)
        if record is None or item is None or item.get("kind") != "part_empty":
            self.set_review_notice("error", "未找到需要展开的 Part，请重新打开本卷。")
            return
        record["Expanded Review Sections"] = sorted(set(record.get("Expanded Review Sections", [])) | {item["section"]})
        if issue_key(source_image, item_key) in self.state['resolved']:
            question_keys = {question["key"] for question in item["question_issues"]}
            record["Reopened Review Questions"] = sorted(set(record.get("Reopened Review Questions", [])) | question_keys)
            for question_key in question_keys:
                self.state['resolved'].discard(issue_key(source_image, question_key))
        pending_questions = pending_part_questions(record, item, self.state['item_rows'], self.state['resolved'])
        item_index = issues.index(item)
        self.state['issues'][source_image] = issues[:item_index] + pending_questions + issues[item_index + 1:]
        self.state['resolved'].discard(issue_key(source_image, item_key))
        if pending_questions:
            message = f"{item['title']} 已展开 {len(pending_questions)} 道待检查题目，已在当前答题卡下方按题号显示。"
            saved_count = len(item["question_issues"]) - len(pending_questions)
            if saved_count:
                message += f"其余 {saved_count} 道题已保存人工结果，无需重复确认。"
        else:
            self.state['stable_review_sources'].add(source_image)
            message = f"{item['title']} 的题目已全部确认，已保留保存结果并清除过期空白提示。"
        self.state['part_expand_notices'][source_image] = message
        # 展开停留在本 Part 的第一道待确认题目，使用新的导航令牌覆盖此前收起动作。
        self.state['review_navigation'] = {
            "target": review_item_key(source_image, pending_questions[0]["key"])
            if pending_questions else review_answers_key(source_image),
            "token": uuid.uuid4().hex,
        }
        self.save_record_update(record, students)
