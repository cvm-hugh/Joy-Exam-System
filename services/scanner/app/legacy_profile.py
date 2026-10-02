"""将当前 A3 V1 模板转换为 V3 可生成答案表的兼容配置。"""
from __future__ import annotations

from typing import Any

from app.models import AnswerItem, ScoreSection, TemplatePackage


GROUPS = (
    ("listening", "part1", "listening_part1", "Listening Part 1"),
    ("listening", "part2", "listening_part2", "Listening Part 2"),
    ("listening", "part3", "listening_part3", "Listening Part 3"),
    ("written_objective", "part1", "written_part1", "Written Part 1"),
    ("written_objective", "part4", "written_part4", "Written Part 4"),
    ("written_objective", "part5", "written_part5", "Written Part 5"),
    ("written_objective", "part6", "written_part6", "Written Part 6"),
    ("written_objective", "part7", "written_part7", "Written Part 7"),
    ("written_objective", "part8", "written_part8", "Written Part 8"),
)


def legacy_v1_package(template: dict[str, Any]) -> TemplatePackage:
    """读取现有 V1 的区域定义，生成一份答案录入所需的题目结构。"""
    items: list[AnswerItem] = []
    sections: list[ScoreSection] = []
    for root, part, section_id, label in GROUPS:
        questions = template[root][part]
        sections.append(ScoreSection(section_id, label, len(questions)))
        for number, options in questions.items():
            items.append(
                AnswerItem(
                    item_id=f"{section_id}:{number}",
                    label=f"{label} · 第 {number} 题",
                    choices=tuple(options),
                    score_section=section_id,
                )
            )
    sections.extend(
        (
            ScoreSection("written_part2", "Written Part 2", 5),
            ScoreSection("written_part3", "Written Part 3", 10),
            ScoreSection("writing", "Writing", 15),
        )
    )
    return TemplatePackage("a3-v1", "定位测 A3 答题卡", "1.0", "approved", tuple(items), tuple(sections))


def answers_to_legacy_key(answers: dict[str, str]) -> dict[str, dict[str, str]]:
    """将答案表中的 V3 item_id 还原为现有扫描核心需要的结构。"""
    result: dict[str, dict[str, str]] = {}
    for item_id, answer in answers.items():
        section, number = item_id.split(":", 1)
        result.setdefault(section, {})[number] = answer
    return result
