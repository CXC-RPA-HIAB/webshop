"""Backward-compatible re-exports; prefer webshop.config."""

from webshop.config import (  # noqa: F401
    COLUMN_ALIASES,
    ITEM_HEADERS,
    ORDER_HEADERS,
    ORDER_PHASE,
    PIPELINE_PHASE,
    SHEET_ITEMS,
    SHEET_MAIN,
    SHEET_ORDER,
    WEBSHOP_ITEM_STATUS_OK,
)

BOT_READY_ACTIVE_PHASE = ORDER_PHASE.READY
ORDER_PHASE_PROCESSING = ORDER_PHASE.IN_PROGRESS
