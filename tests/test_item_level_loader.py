"""Load order lines from item_level into batch dataframe."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from spreadsheet_processing import load_order_items_dataframe


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


if __name__ == "__main__":
    unittest.main()
