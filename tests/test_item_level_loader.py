"""Load order lines from item_level into batch dataframe."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from spreadsheet_processing import (
    count_valid_items_for_order,
    load_order_items_dataframe,
    valid_items_error_reason,
)


class TestLoadOrderItemsDataframe(unittest.TestCase):
    def test_filters_by_order_id(self) -> None:
        sheet = MagicMock()
        sheet.get_all_values.return_value = [
            ["order_id", "item_number", "item_qty", "item_status", "item_match_type"],
            ["ord-a", "111", "2", "valid", ""],
            ["ord-b", "222", "1", "valid", ""],
            ["ord-a", "333", "5", "valid", ""],
        ]
        df = load_order_items_dataframe(sheet, "ord-a")
        self.assertEqual(len(df), 2)
        self.assertEqual(df.iloc[0]["Item number"], "111")
        self.assertEqual(df.iloc[0]["Order amount"], "2")

    def test_count_valid_items(self) -> None:
        sheet = MagicMock()
        sheet.get_all_values.return_value = [
            ["order_id", "item_number", "item_qty", "item_status", "item_match_type"],
            ["ord-a", "111", "2", "valid", ""],
            ["ord-a", "222", "1", "obsolete", ""],
            ["ord-b", "333", "1", "valid", ""],
        ]
        valid, total = count_valid_items_for_order(sheet, "ord-a")
        self.assertEqual(valid, 1)
        self.assertEqual(total, 2)
        self.assertTrue(valid_items_error_reason("ord-a", valid, total) == "")

        valid_z, total_z = count_valid_items_for_order(sheet, "ord-z")
        self.assertEqual(valid_z, 0)
        self.assertEqual(total_z, 0)
        reason = valid_items_error_reason("ord-z", valid_z, total_z)
        self.assertIn("No item_level rows", reason)

        valid_b, total_b = count_valid_items_for_order(sheet, "ord-b")
        self.assertEqual(valid_b, 1)
        reason_b = valid_items_error_reason("ord-b", 0, total_b)
        self.assertIn("No valid items", reason_b)

    def test_load_skips_non_valid_status(self) -> None:
        sheet = MagicMock()
        sheet.get_all_values.return_value = [
            ["order_id", "item_number", "item_qty", "item_status", "item_match_type"],
            ["ord-a", "111", "2", "valid", ""],
            ["ord-a", "222", "1", "blocked", ""],
        ]
        df = load_order_items_dataframe(sheet, "ord-a")
        self.assertEqual(len(df), 1)
        self.assertEqual(df.iloc[0]["Item number"], "111")


if __name__ == "__main__":
    unittest.main()
