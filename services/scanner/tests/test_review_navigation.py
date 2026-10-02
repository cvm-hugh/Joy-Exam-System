import unittest

from app.review_navigation import EXPORT_TARGET_KEY, first_pending_review_key, review_card_key


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

    def test_keys_are_stable_distinct_and_safe_for_real_filenames(self):
        source = "未复核 01（考号待确认）.png"
        self.assertEqual(review_card_key(source), review_card_key(source))
        self.assertRegex(review_card_key(source), r"^review_card_[a-f0-9]{64}$")
        self.assertNotEqual(review_card_key(source), review_card_key("未复核 01_考号待确认_.png"))
