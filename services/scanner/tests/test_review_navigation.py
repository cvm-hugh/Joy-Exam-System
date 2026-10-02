import unittest

from app.review_navigation import (EXPORT_TARGET_KEY, first_pending_review_key,
                                   review_card_key, review_panel_key)


class ReviewNavigationTests(unittest.TestCase):
    def test_returns_first_unfinished_card_even_when_current_card_is_later(self):
        records = [{"Source Image": "done.png", "Status": "OK"},
                   {"Source Image": "earlier.png", "Status": "CHECK_ID"},
                   {"Source Image": "current.png", "Status": "OK"},
                   {"Source Image": "later.png", "Status": "CHECK_MARK"}]
        self.assertEqual(first_pending_review_key(records), review_card_key("earlier.png"))

    def test_each_pending_status_is_a_navigation_target(self):
        for status in ("CHECK_ID", "CHECK_MARK", "CHECK_PART_EMPTY"):
            with self.subTest(status=status):
                self.assertEqual(first_pending_review_key([{"Source Image": "card.png", "Status": status}]),
                                 review_card_key("card.png"))

    def test_all_finished_cards_lead_to_export(self):
        self.assertEqual(first_pending_review_key([{"Source Image": "done.png", "Status": "OK"}]),
                         EXPORT_TARGET_KEY)

    def test_empty_batch_leads_to_export(self):
        self.assertEqual(first_pending_review_key([]), EXPORT_TARGET_KEY)

    def test_closed_pending_cards_are_skipped_without_becoming_finished(self):
        records = [{"Source Image": f"card{n}.png", "Status": "CHECK_MARK"} for n in range(1, 6)]
        records[3]["Status"] = "OK"
        self.assertEqual(first_pending_review_key(records, {"card1.png", "card2.png", "card3.png"}),
                         review_card_key("card5.png"))
        self.assertEqual([record["Status"] for record in records[:3]], ["CHECK_MARK"] * 3)

    def test_all_collapsed_pending_cards_keep_a_review_target(self):
        records = [{"Source Image": "first.png", "Status": "CHECK_ID"},
                   {"Source Image": "second.png", "Status": "CHECK_PART_EMPTY"}]
        self.assertEqual(first_pending_review_key(records, {"first.png", "second.png"}),
                         review_card_key("first.png"))

    def test_reopening_a_card_makes_it_eligible_for_navigation(self):
        records = [{"Source Image": "first.png", "Status": "CHECK_ID"},
                   {"Source Image": "second.png", "Status": "CHECK_MARK"}]
        self.assertEqual(first_pending_review_key(records, {"first.png"}), review_card_key("second.png"))
        self.assertEqual(first_pending_review_key(records, set()), review_card_key("first.png"))

    def test_keys_are_stable_distinct_and_safe_for_real_filenames(self):
        source = "未复核 01（考号待确认）.png"
        self.assertEqual(review_card_key(source), review_card_key(source))
        self.assertRegex(review_card_key(source), r"^review_card_[a-f0-9]{64}$")
        self.assertNotEqual(review_card_key(source), review_card_key("未复核 01_考号待确认_.png"))
        self.assertRegex(review_panel_key(source), r"^review_panel_[a-f0-9]{64}$")
        self.assertNotEqual(review_panel_key(source), review_card_key(source))
