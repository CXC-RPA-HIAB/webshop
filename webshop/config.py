"""Spreadsheet schema and phase dictionary for order_level / item_level."""

from __future__ import annotations

from typing import Dict, List

SHEET_ORDER = "order_level"
SHEET_ITEMS = "item_level"
SHEET_MAIN = SHEET_ORDER

ORDER_HEADERS: List[str] = [
    "order_id",
    "phase",
    "active_phase",
    "email_response",
    "customer_name",
    "customer_number",
    "customer_email",
    "order_csv",
    "timestamp_order_receive",
    "timestamp_bot_done",
    "saved_card_name",
    "internal_email",
]

ITEM_HEADERS: List[str] = [
    "order_id",
    "item_number",
    "item_qty",
    "item_status",
    "item_match_type",
]

# 1-based column indexes on order_level
ORDER_COL: Dict[str, int] = {name: idx + 1 for idx, name in enumerate(ORDER_HEADERS)}

ITEM_COL: Dict[str, int] = {name: idx + 1 for idx, name in enumerate(ITEM_HEADERS)}


class ORDER_PHASE:
    IN_PROGRESS = "IN PROGRESS"
    READY = "READY"
    DONE = "DONE"
    ERROR = "ERROR"

    ALL = frozenset({IN_PROGRESS, READY, DONE, ERROR})


class PIPELINE_PHASE:
    """Values for active_phase (email pipeline steps)."""

    VALID = "5_VALID"
    ERROR = "-1_ERROR"
    RECEIVED = "1_EMAIL_RECEIVED"


def bot_progress_active_phase(detail: str) -> str:
    """Robot progress in active_phase (never in phase column)."""
    text = (detail or "Processing").strip()
    return f"PROCESSING - {text}"


COLUMN_ALIASES: Dict[str, List[str]] = {
    "order_id": ["email_id"],
    "email_id": ["order_id"],
    "phase": ["manual_phase"],
    "manual_phase": ["phase"],
    "active_phase": ["robot_phase"],
    "robot_phase": ["active_phase"],
    "order_csv": ["attachments_path"],
    "attachments_path": ["order_csv"],
    "timestamp_bot_done": ["timestamp_processed_at"],
    "timestamp_processed_at": ["timestamp_bot_done"],
    "saved_card_name": ["batch_name", "title", "email_title"],
    "batch_name": ["saved_card_name"],
    "customer_number": ["client_number", "client_id"],
    "client_number": ["customer_number", "client_id"],
    "customer_name": ["client_name", "client"],
    "client_name": ["customer_name", "client"],
    "item_number": ["item_name"],
    "item_name": ["item_number"],
    "item_qty": ["item_count"],
    "item_count": ["item_qty"],
    "item_match_type": ["match_type"],
    "match_type": ["item_match_type"],
}

WEBSHOP_ITEM_STATUS_OK = "exist"
ITEM_STATUS_VALID = "exist"
