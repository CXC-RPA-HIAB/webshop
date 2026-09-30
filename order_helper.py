"""
Business logic for processing pending webshop orders.
Handles spreadsheet reads, phase updates, and batch uploads.
"""
from __future__ import annotations

import traceback
from pathlib import Path
from typing import Optional
import pandas as pd
from auth import init_connections, open_items_sheet
from config_loader import batch_max_rows, ensure_runtime_dirs, load_config
from csv_utils import prepare_batch_payload_from_dataframe
from logging_setup import get_logger

from spreadsheet_processing import (
    count_valid_items_for_order,
    find_pending_orders,
    load_order_items_dataframe,
    set_batch_name,
    set_webshop_item_status,
    valid_items_error_reason,
)
from webshop.sheet_writer import (
    claim_order_for_bot,
    mark_bot_done,
    mark_bot_error,
    set_bot_active_progress,
)
from webshop.cart_naming import resolve_saved_cart_name
from webshop.profil_handler import ProfileHandler
from webshop.webshop_orchestration import webshop_orchestration


def _delete_order_batch_csvs(batch_files: list[Path], row_number: int) -> None:
    """Remove download batch CSVs that belong to a finished order row."""
    logger = get_logger()
    for path in batch_files:
        try:
            if path.is_file():
                path.unlink()
                logger.info("Deleted batch CSV for finished row %s: %s", row_number, path.name)
        except OSError as exc:
            logger.warning("Could not delete batch CSV %s for row %s: %s", path, row_number, exc)


def process_single_order(
    sheet,
    sheets_client,
    order: pd.Series,
    config,
    profile: Optional[ProfileHandler] = None,
    *,
    require_existing_session: bool = False,
) -> bool:
    """
    Process one order_level row end-to-end.
    Returns True on success.
    """
    logger = get_logger()
    email_id = str(order.email_id).strip()
    client_number = str(order.client_number).strip()
    client_name = str(order.client_name).strip()
    row_number = int(order.row_number)

    logger.info(
        "Process started for client_number=%s client_name=%s emailID=%s row=%s", client_number, client_name, email_id, row_number
    )

    def on_phase(_phase: str, detail: str) -> None:
        """Playwright progress — active_phase only (phase stays IN PROGRESS)."""
        order["row_number"] = set_bot_active_progress(
            sheet,
            order_id=order.email_id,
            detail=detail,
            row_number=order.row_number,
            config=config,
        )

    def on_batch_name(name: str) -> None:
        order["row_number"] = set_batch_name(
            sheet, name, config, email_id=order.email_id, row_number=order.row_number,
        )

    owns_profile = profile is None
    batch_files: list[Path] = []
    
    try:
        if not order.email_id:
            raise ValueError("order_id is empty on processing row; cannot safely edit phases.")

        if not order.client_number:
            raise ValueError("client_number is empty on processing row.")

        items_sheet = open_items_sheet(sheet, config)
        valid_count, total_rows = count_valid_items_for_order(
            items_sheet, email_id, config
        )
        skip_reason = valid_items_error_reason(email_id, valid_count, total_rows)
        if skip_reason:
            logger.warning(
                "Skipping order_id=%s row=%s: %s",
                email_id,
                row_number,
                skip_reason,
            )
            order["row_number"] = mark_bot_error(
                sheet,
                order_id=order.email_id,
                reason=skip_reason,
                row_number=order.row_number,
                config=config,
            )
            return False

        order["row_number"] = claim_order_for_bot(
            sheet,
            order_id=order.email_id,
            row_number=order.row_number,
            config=config,
        )
        order["row_number"] = set_bot_active_progress(
            sheet,
            order_id=order.email_id,
            detail="Extracting row data",
            row_number=order.row_number,
            config=config,
        )

        order["row_number"] = set_bot_active_progress(
            sheet,
            order_id=order.email_id,
            detail="Loading items from item_level",
            row_number=order.row_number,
            config=config,
        )
        items_df = load_order_items_dataframe(items_sheet, email_id, config)

        max_rows = batch_max_rows(config)
        on_phase("PROCESSING", f"Preparing batch CSVs from item_level (max {max_rows} rows)")

        payload = prepare_batch_payload_from_dataframe(
            items_df,
            config.get("paths", "batch_csv_dir"),
            stem=f"batch_{order.client_number}_{order.email_id or order.row_number}",
            batch_size=max_rows,
        )
        batch_files = list(payload.batch_files)
        logger.info("Order has %s item row(s) -> %s batch file(s).", payload.total_rows, payload.batch_count)

        if profile is None:
            profile = ProfileHandler(config)
            profile.start()

        saved_cart_name = resolve_saved_cart_name(order)
        order["row_number"] = set_batch_name(
            sheet,
            saved_cart_name,
            config,
            email_id=order.email_id,
            row_number=order.row_number,
        )

        failed_items = webshop_orchestration(
            page=profile.page,
            context=profile.context,
            order=order,
            batch_csvs=payload.batch_files,
            config=config,
            on_phase=on_phase,
            on_batch_name=on_batch_name,
            require_existing_session=require_existing_session,
            saved_cart_name=saved_cart_name,
        ) or {}

        if failed_items:
            logger.warning(
                "Webshop rejected %s item(s) for email_id=%s: %s",
                len(failed_items), email_id, failed_items,
            )
        try:
            on_phase("PROCESSING", "Writing webshop item status")
            written = set_webshop_item_status(
                open_items_sheet(sheet, config), email_id, failed_items, config,
            )
            logger.info("item_status (webshop) written for %s item_level row(s).", written)
        except Exception as exc:
            logger.warning(
                "Could not write WEBSHOP_ITEM_STATUS for email_id=%s: %s", email_id, exc
            )

        order["row_number"] = mark_bot_done(
            sheet,
            order_id=order.email_id,
            row_number=order.row_number,
            config=config,
        )
        
        _delete_order_batch_csvs(batch_files, order.row_number)
        logger.info("Process completed successfully for email_id=%s row %s.", order.email_id, order.row_number)
        return True

    except Exception as exc:
        reason = str(exc).strip() or type(exc).__name__
        logger.error("Error processing email_id=%s row %s: %s", order.email_id, order.row_number, reason)
        logger.error(traceback.format_exc())
        
        try:
            order["row_number"] = mark_bot_error(
                sheet,
                order_id=order.email_id,
                reason=reason,
                row_number=order.row_number,
                config=config,
            )
        except Exception as sheet_exc:
            logger.error("Failed to write ERROR phase: %s", sheet_exc)
        return False

    finally:
        if owns_profile and profile is not None:
            profile.stop()

def process_emails(
    max_orders: Optional[int] = None,
    *,
    force_headless: Optional[bool] = None,
    quiet_when_idle: bool = False,
    profile: Optional[ProfileHandler] = None,
    require_existing_session: bool = False,
    logger=None, # Allow injecting logger from main
) -> int:
    """
    Main orchestration (Sheets arrival, then order processing).
    Returns number of successfully finished orders.
    """
    config = load_config()
    ensure_runtime_dirs(config)
    logger = logger or get_logger()

    if force_headless is not None:
        config.set("webshop", "headless", "true" if force_headless else "false")

    if not quiet_when_idle:
        logger.info("Connecting to Google Sheets...")

    sheets_client, main_sheet = init_connections(config)
    
    if not quiet_when_idle:
        logger.info("Sheets connection ready.")

    pending_orders_df = find_pending_orders(main_sheet, config)
    
    if pending_orders_df.empty:
        msg = "No rows ready on order_level (need phase=READY)."
        if quiet_when_idle:
            logger.debug(msg)
        else:
            logger.info(msg)
        return 0

    if max_orders is not None:
        pending_orders_df = pending_orders_df.head(max(0, max_orders))

    success = 0
    owns_profile = profile is None
    try:
        if profile is None:
            profile = ProfileHandler(config)
            profile.start()

        for index, order in pending_orders_df.iterrows():
            ok = process_single_order(
                main_sheet,
                sheets_client,
                order,
                config,
                profile=profile,
                require_existing_session=require_existing_session,
            )
            if ok:
                success += 1
    finally:
        if owns_profile and profile is not None:
            profile.stop()

    logger.info("Finished run: %s/%s order(s) succeeded.", success, len(pending_orders_df))
    return success