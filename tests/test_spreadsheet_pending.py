"""Unit tests for order_level pending-row selection."""

from __future__ import annotations

import configparser
import unittest
from unittest.mock import MagicMock

from webshop.config import ORDER_PHASE, PIPELINE_PHASE
from spreadsheet_processing import find_pending_orders


def _test_config() -> configparser.ConfigParser:
    cfg = configparser.ConfigParser()
    cfg.read_dict({"phases": {}})
    return cfg


class TestFindPendingOrders(unittest.TestCase):
    def _sheet_with_rows(self, headers: list[str], rows: list[list[str]]) -> MagicMock:
        sheet = MagicMock()
        sheet.get_all_values.return_value = [headers] + rows
        return sheet

    def test_picks_phase_ready_any_active_phase(self) -> None:
        headers = [
            "order_id",
            "phase",
            "active_phase",
            "email_response",
            "customer_name",
            "customer_number",
            "customer_email",
            "order_csv",
        ]
        rows = [
            ["id-1", ORDER_PHASE.READY, PIPELINE_PHASE.VALID, "NO", "A", "1", "a@x.com", ""],
            ["id-2", ORDER_PHASE.DONE, PIPELINE_PHASE.VALID, "NO", "B", "2", "b@x.com", ""],
            ["id-3", ORDER_PHASE.IN_PROGRESS, PIPELINE_PHASE.VALID, "NO", "C", "3", "c@x.com", ""],
            ["id-4", ORDER_PHASE.READY, "1_EMAIL_RECEIVED", "NO", "D", "4", "d@x.com", ""],
        ]
        df = find_pending_orders(self._sheet_with_rows(headers, rows), _test_config())
        self.assertEqual(len(df), 2)
        ids = set(df["order_id"].astype(str))
        self.assertEqual(ids, {"id-1", "id-4"})

if __name__ == "__main__":
    unittest.main()
