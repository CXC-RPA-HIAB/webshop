"""Google Sheets writes for order_level / item_level (headers + bot lifecycle)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Optional

from webshop.config import (
    ORDER_HEADERS,
    ORDER_PHASE,
    PIPELINE_PHASE,
    bot_progress_active_phase,
)

if TYPE_CHECKING:
    import gspread


def ensure_order_headers(sheet: "gspread.Worksheet") -> None:
    """Ensure row 1 on order_level matches ORDER_HEADERS."""
    last = len(ORDER_HEADERS)
    if sheet.col_count < last:
        sheet.add_cols(last - sheet.col_count)
    header_row = sheet.row_values(1)
    if len(header_row) < last:
        header_row = header_row + [""] * (last - len(header_row))
    changed = False
    for i, name in enumerate(ORDER_HEADERS):
        if (header_row[i] or "").strip() != name:
            header_row[i] = name
            changed = True
    if changed or not sheet.row_values(1):
        end_col = chr(ord("A") + last - 1)
        sheet.update(f"A1:{end_col}1", [header_row[:last]])


def update_status(
    sheet: "gspread.Worksheet",
    *,
    order_id: str,
    phase: str,
    active_phase: str,
    row_number: Optional[int] = None,
    config=None,
) -> int:
    """Write dictionary phase and pipeline active_phase. Returns 1-based row."""
    from spreadsheet_processing import set_active_phase, set_order_phase

    row = set_order_phase(
        sheet, phase, config, email_id=order_id, row_number=row_number
    )
    set_active_phase(
        sheet,
        active_phase,
        config,
        email_id=order_id,
        row_number=row,
    )
    return row


def mark_bot_ready(
    sheet: "gspread.Worksheet",
    *,
    order_id: str,
    row_number: Optional[int] = None,
    config=None,
) -> int:
    """UI Bot start: phase=READY, active_phase=5_VALID (or current pipeline step)."""
    return update_status(
        sheet,
        order_id=order_id,
        phase=ORDER_PHASE.READY,
        active_phase=PIPELINE_PHASE.VALID,
        row_number=row_number,
        config=config,
    )


def claim_order_for_bot(
    sheet: "gspread.Worksheet",
    *,
    order_id: str,
    row_number: Optional[int] = None,
    config=None,
) -> int:
    """
    Playwright pickup: READY → IN PROGRESS on phase only.
    Leaves active_phase unchanged until set_bot_active_progress.
    """
    from spreadsheet_processing import set_order_phase

    return set_order_phase(
        sheet,
        ORDER_PHASE.IN_PROGRESS,
        config,
        email_id=order_id,
        row_number=row_number,
    )


def set_bot_active_progress(
    sheet: "gspread.Worksheet",
    *,
    order_id: str,
    detail: str,
    row_number: Optional[int] = None,
    config=None,
) -> int:
    """Update active_phase with bot progress (never writes to phase column)."""
    from spreadsheet_processing import set_active_phase

    return set_active_phase(
        sheet,
        bot_progress_active_phase(detail),
        config,
        email_id=order_id,
        row_number=row_number,
    )


def mark_bot_in_progress(
    sheet: "gspread.Worksheet",
    *,
    order_id: str,
    detail: str = "",
    row_number: Optional[int] = None,
    config=None,
) -> int:
    """Claim row and set first progress line in active_phase."""
    row = claim_order_for_bot(
        sheet, order_id=order_id, row_number=row_number, config=config
    )
    return set_bot_active_progress(
        sheet,
        order_id=order_id,
        detail=detail,
        row_number=row,
        config=config,
    )


def _stamp_bot_done(sheet, order_id, row_number, config) -> None:
    from spreadsheet_processing import set_timestamp_processed_at

    set_timestamp_processed_at(
        sheet, config, email_id=order_id, row_number=row_number, when=None
    )


def mark_bot_done(
    sheet: "gspread.Worksheet",
    *,
    order_id: str,
    row_number: Optional[int] = None,
    config=None,
) -> int:
    """Success: phase=DONE, active_phase=5_VALID, timestamp_bot_done (UTC)."""
    row = update_status(
        sheet,
        order_id=order_id,
        phase=ORDER_PHASE.DONE,
        active_phase=PIPELINE_PHASE.VALID,
        row_number=row_number,
        config=config,
    )
    _stamp_bot_done(sheet, order_id, row, config)
    return row


def mark_bot_error(
    sheet: "gspread.Worksheet",
    *,
    order_id: str,
    reason: str,
    row_number: Optional[int] = None,
    config=None,
) -> int:
    """Failure: phase=ERROR, error detail in active_phase, timestamp_bot_done."""
    detail = (reason or "Unknown error").strip()
    active = (
        detail
        if detail.startswith(PIPELINE_PHASE.ERROR)
        else f"{PIPELINE_PHASE.ERROR} - {detail}"
    )
    row = update_status(
        sheet,
        order_id=order_id,
        phase=ORDER_PHASE.ERROR,
        active_phase=active,
        row_number=row_number,
        config=config,
    )
    _stamp_bot_done(sheet, order_id, row, config)
    return row
