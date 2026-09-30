"""ORDER_PHASE dictionary and header layout."""

from __future__ import annotations

import unittest

from webshop.config import (
    ITEM_HEADERS,
    ORDER_COL,
    ORDER_HEADERS,
    ORDER_PHASE,
    PIPELINE_PHASE,
    bot_progress_active_phase,
)


class TestWebshopSheetConfig(unittest.TestCase):
    def test_order_phase_literals(self) -> None:
        self.assertEqual(ORDER_PHASE.IN_PROGRESS, "IN PROGRESS")
        self.assertEqual(ORDER_PHASE.READY, "READY")
        self.assertEqual(ORDER_PHASE.DONE, "DONE")
        self.assertEqual(ORDER_PHASE.ERROR, "ERROR")
        self.assertEqual(len(ORDER_PHASE.ALL), 4)

    def test_order_headers_match_column_map(self) -> None:
        self.assertEqual(len(ORDER_HEADERS), 12)
        self.assertEqual(ORDER_COL["phase"], 2)
        self.assertEqual(ORDER_COL["active_phase"], 3)
        self.assertEqual(ORDER_COL["order_csv"], 8)

    def test_item_headers(self) -> None:
        self.assertEqual(ITEM_HEADERS[0], "order_id")
        self.assertEqual(len(ITEM_HEADERS), 5)

    def test_pipeline_valid(self) -> None:
        self.assertEqual(PIPELINE_PHASE.VALID, "5_VALID")

    def test_bot_start_commit_contract(self) -> None:
        """UI/orchestrator: phase READY + active_phase 5_VALID."""
        self.assertEqual(ORDER_PHASE.READY, "READY")
        self.assertEqual(PIPELINE_PHASE.VALID, "5_VALID")

    def test_bot_progress_goes_to_active_phase_only(self) -> None:
        self.assertEqual(
            bot_progress_active_phase("Logging in"),
            "PROCESSING - Logging in",
        )


if __name__ == "__main__":
    unittest.main()
