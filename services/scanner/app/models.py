"""V3 的配置模型：只定义数据边界，不修改 V1 识别核心。"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


class ValidationError(ValueError):
    """用户提供的考试配置不符合可正式使用条件。"""


@dataclass(frozen=True)
class ScoreSection:
    section_id: str
    label: str
    maximum: float

    def validate(self) -> None:
        if not self.section_id.strip() or not self.label.strip():
            raise ValidationError("评分分项必须同时包含内部 ID 和显示名称。")
        if self.maximum < 0:
            raise ValidationError(f"{self.label} 的满分不能小于 0。")


@dataclass(frozen=True)
class AnswerItem:
    item_id: str
    label: str
    choices: tuple[str, ...]
    score_section: str

    def validate(self, valid_sections: set[str]) -> None:
        if not self.item_id.strip() or not self.label.strip():
            raise ValidationError("答案题目必须包含题目 ID 和显示名称。")
        if len(self.choices) < 2 or len(set(self.choices)) != len(self.choices):
            raise ValidationError(f"{self.label} 的选项必须至少有两个且不可重复。")
        if self.score_section not in valid_sections:
            raise ValidationError(f"{self.label} 引用了不存在的评分分项：{self.score_section}。")


@dataclass(frozen=True)
class TemplatePackage:
    template_id: str
    name: str
    version: str
    status: str
    answer_items: tuple[AnswerItem, ...]
    score_sections: tuple[ScoreSection, ...]

    def validate(self, require_approved: bool = False) -> None:
        if not self.template_id.strip() or not self.name.strip() or not self.version.strip():
            raise ValidationError("模板包必须包含 ID、名称和版本。")
        if self.status not in {"draft", "testing", "approved", "retired"}:
            raise ValidationError("模板包状态无效。")
        if require_approved and self.status != "approved":
            raise ValidationError("只有已通过测试并批准的答题卡模板可用于正式考试。")
        section_ids = [section.section_id for section in self.score_sections]
        if not section_ids or len(set(section_ids)) != len(section_ids):
            raise ValidationError("评分分项不能为空，且内部 ID 不可重复。")
        for section in self.score_sections:
            section.validate()
        item_ids = [item.item_id for item in self.answer_items]
        if not item_ids or len(set(item_ids)) != len(item_ids):
            raise ValidationError("答案题目不能为空，且题目 ID 不可重复。")
        valid_sections = set(section_ids)
        for item in self.answer_items:
            item.validate(valid_sections)


@dataclass(frozen=True)
class ExamSession:
    exam_id: str
    name: str
    template: TemplatePackage
    roster_snapshot: Path
    answer_key: Path
    photo_directory: Path
    status: str = "setup"

    def validate_ready(self) -> None:
        if not self.exam_id.strip() or not self.name.strip():
            raise ValidationError("单次考试必须包含内部 ID 和名称。")
        self.template.validate(require_approved=True)
        for label, path in (("学生名单快照", self.roster_snapshot), ("正确答案", self.answer_key)):
            if not path.is_file():
                raise ValidationError(f"{label}不存在：{path}")
        if not self.photo_directory.is_dir():
            raise ValidationError(f"照片目录不存在：{self.photo_directory}")


def validate_answer_key(items: Iterable[AnswerItem], answers: dict[str, str]) -> None:
    """确保答案只覆盖当前模板的题目，且每个答案属于该题允许选项。"""
    expected = {item.item_id: item for item in items}
    if set(answers) != set(expected):
        missing = sorted(set(expected) - set(answers))
        unexpected = sorted(set(answers) - set(expected))
        details = []
        if missing:
            details.append("缺少：" + "、".join(missing))
        if unexpected:
            details.append("多出：" + "、".join(unexpected))
        raise ValidationError("正确答案题目不匹配模板（" + "；".join(details) + "）。")
    for item_id, answer in answers.items():
        if answer not in expected[item_id].choices:
            raise ValidationError(f"{expected[item_id].label} 的答案 {answer!r} 不属于允许选项。")
