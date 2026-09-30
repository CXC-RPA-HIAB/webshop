"""Saved cart name (column K)."""

from __future__ import annotations

import unittest
from datetime import datetime

from webshop.cart_naming import generate_saved_cart_name, resolve_saved_cart_name


class TestCartNaming(unittest.TestCase):
    def test_generate_pattern(self) -> None:
        name = generate_saved_cart_name(
            row_number=17,
            when=datetime(2026, 9, 30, 12, 0),
        )
        self.assertEqual(name, "cart_3026_0017")

    def test_uses_column_k_when_set(self) -> None:
        order = {"saved_card_name": "cart_3026_0099", "row_number": 4}
        self.assertEqual(resolve_saved_cart_name(order), "cart_3026_0099")

    def test_generates_when_k_empty(self) -> None:
        order = {"saved_card_name": "", "row_number": 17}
        name = resolve_saved_cart_name(order)
        self.assertTrue(name.startswith("cart_"))
        self.assertTrue(name.endswith("_0017"))


if __name__ == "__main__":
    unittest.main()
