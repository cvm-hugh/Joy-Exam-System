"""Stable review targets for answer cards, answer areas and individual items."""
from collections.abc import Collection
from hashlib import sha256


PENDING_REVIEW_STATUSES = frozenset({"CHECK_ID", "CHECK_MARK", "CHECK_PART_EMPTY"})
EXPORT_TARGET_KEY = "review_export"


def review_card_key(source_image: str) -> str:
    # Raw filenames may include spaces, punctuation and Chinese characters.
    return "review_card_" + sha256(source_image.encode("utf-8")).hexdigest()


def review_panel_key(source_image: str) -> str:
    return "review_panel_" + sha256(source_image.encode("utf-8")).hexdigest()


def review_answers_key(source_image: str) -> str:
    return "review_answers_" + sha256(source_image.encode("utf-8")).hexdigest()


def review_item_key(source_image: str, item_key: str) -> str:
    # Keep targets valid as CSS classes even when filenames contain spaces or punctuation.
    identity = f"{source_image}\0{item_key}"
    return "review_item_" + sha256(identity.encode("utf-8")).hexdigest()


def first_pending_review_key(records: list[dict], closed_sources: Collection[str] = ()) -> str:
    pending = [record for record in records if record.get("Status") in PENDING_REVIEW_STATUSES]
    for record in pending:
        if record["Source Image"] not in closed_sources:
            return review_card_key(record["Source Image"])
    if pending:
        # Keep the first collapsed title visible without reopening it or allowing export.
        return review_card_key(pending[0]["Source Image"])
    return EXPORT_TARGET_KEY
