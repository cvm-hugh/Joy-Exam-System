"""参考信息提醒；不改变原始名单、身份确认状态或分数。"""
from __future__ import annotations

from typing import Any

UNKNOWN_VALUES = {"", "/", "／", "-", "—", "未知", "不详", "不清楚", "待补充", "未填写", "n/a"}
YEAR_LEVEL_ALIASES = {"初一": "七年级", "初二": "八年级", "初三": "九年级"}
YEAR_LEVELS = {f"{value}年级" for value in "一二三四五六七八九"}
INFORMATION_FIELDS = (("Branch", "分校名称"), ("Class", "班级名称"), ("Exam Session", "笔试时间"), ("Year Level", "年级"))


def student_information_issues(records: list[dict[str, Any]]) -> list[dict[str, str]]:
    issues = []
    for record in records:
        for field, label in INFORMATION_FIELDS:
            original = str(record.get(field) or "").strip()
            value = YEAR_LEVEL_ALIASES.get(original, original) if field == "Year Level" else original
            missing = value.casefold() in UNKNOWN_VALUES or (field == "Branch" and value == "XX 分校")
            unrecognized = field == "Year Level" and not missing and value not in YEAR_LEVELS
            if missing or unrecognized:
                issues.append({
                    "考号": str(record.get("Original Exam ID") or record.get("Exam ID") or ""),
                    "学生姓名": str(record.get("Chinese Name") or ""),
                    "信息字段": label,
                    "当前填写内容": original,
                    "提示": "该信息需要填充" if missing else "年级写法需要核对，原值已保留",
                })
    return issues
