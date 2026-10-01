"""Batch CSV column order: part number then quantity."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import pandas as pd

from csv_utils import BATCH_CSV_COLUMNS, prepare_batch_payload_from_dataframe


class TestBatchCsvColumnOrder(unittest.TestCase):
    def test_part_column_before_qty_in_file(self) -> None:
        df = pd.DataFrame(
            {
                "Order amount": ["2", "5"],
                "Item number": ["111", "075.059.0037"],
            }
        )
        with tempfile.TemporaryDirectory() as tmp:
            payload = prepare_batch_payload_from_dataframe(
                df, tmp, stem="test_order", batch_size=100
            )
            text = payload.batch_files[0].read_text(encoding="utf-8")
        header_line = text.splitlines()[0]
        self.assertEqual(header_line, "Item number,Order amount")
        self.assertEqual(
            list(payload.items.columns),
            list(BATCH_CSV_COLUMNS),
        )


if __name__ == "__main__":
    unittest.main()
