"""Stable page targets for moving to the first unfinished answer card."""
from hashlib import sha256


PENDING_REVIEW_STATUSES = frozenset({"CHECK_ID", "CHECK_MARK", "CHECK_PART_EMPTY"})
EXPORT_TARGET_KEY = "review_export"


def review_card_key(source_image: str) -> str:
    # Raw filenames may include spaces, punctuation and Chinese characters.
    return "review_card_" + sha256(source_image.encode("utf-8")).hexdigest()


def first_pending_review_key(records: list[dict]) -> str:
    for record in records:
        if record.get("Status") in PENDING_REVIEW_STATUSES:
            return review_card_key(record["Source Image"])
    return EXPORT_TARGET_KEY
