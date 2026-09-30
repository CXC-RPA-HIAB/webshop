"""Saved cart name (order_level column K / saved_card_name)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Mapping

CART_PREFIX = "cart_"


def _order_field(order: Mapping[str, Any], *keys: str) -> str:
    for key in keys:
        if key not in order:
            continue
        val = order[key]
        if val is None:
            continue
        text = str(val).strip()
        if text and text.upper() != "N/A":
            return text
    return ""


def generate_saved_cart_name(*, row_number: int, when: datetime | None = None) -> str:
    """
    Default pattern: cart_{DD}{YY}_{NNNN}, e.g. cart_3026_0017 (30 Sep 2026, row 17).
    """
    moment = when or datetime.now()
    date_part = f"{moment.day:02d}{moment.year % 100:02d}"
    seq = max(1, int(row_number or 1))
    return f"{CART_PREFIX}{date_part}_{seq:04d}"


def resolve_saved_cart_name(order: Mapping[str, Any]) -> str:
    """
    Use saved_card_name from column K when set; otherwise generate cart_DDYY_NNNN.
    """
    existing = _order_field(order, "saved_card_name", "batch_name")
    if existing.lower().startswith(CART_PREFIX):
        return existing
    if existing:
        return existing
    row = int(_order_field(order, "row_number") or 1)
    return generate_saved_cart_name(row_number=row)
