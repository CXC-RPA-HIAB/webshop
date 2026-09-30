"""Google Sheets/Drive auth via service account (oauth-keys.json)."""

from __future__ import annotations

from pathlib import Path
from typing import Tuple

import gspread
from google.oauth2.service_account import Credentials

from config_loader import (
    google_scopes,
    item_level_sheet_name,
    load_config,
    order_level_sheet_name,
)
from logging_setup import get_logger

logger = get_logger()


def _service_account_keys_path(config) -> str:
    """Prefer [google] keys_path; fall back to gmail oauth_keys / legacy sheets_keys."""
    for section, key in (
        ("google", "keys_path"),
        ("google", "sheets_keys"),
        ("gmail", "oauth_keys"),
    ):
        if config.has_option(section, key):
            path = config.get(section, key).strip()
            if path:
                return path
    return "static/secrets/oauth-keys.json"


def authenticate_sheets(config=None) -> gspread.Client:
    """Authorize gspread with a service-account JSON key file."""
    config = config or load_config()
    keys_path = _service_account_keys_path(config)
    scopes = google_scopes(config)

    if not Path(keys_path).exists():
        raise FileNotFoundError(
            f"Google service-account keys not found: {keys_path}. "
            "Place the JSON at static/secrets/oauth-keys.json"
        )

    creds = Credentials.from_service_account_file(keys_path, scopes=scopes)
    client = gspread.authorize(creds)
    logger.info("Google Sheets authenticated (%s).", keys_path)
    return client


def open_main_sheet(client: gspread.Client, config=None) -> gspread.Worksheet:
    config = config or load_config()
    url = config.get("spreadsheets", "spreadsheet_url")
    configured = order_level_sheet_name(config)
    items_name = item_level_sheet_name(config)
    spreadsheet = client.open_by_url(url)

    candidates: list[str] = []
    for name in (configured, "order_level", "MAIN"):
        n = (name or "").strip()
        if n and n not in candidates:
            candidates.append(n)

    worksheet = None
    for name in candidates:
        try:
            worksheet = spreadsheet.worksheet(name)
            if name != configured:
                logger.warning(
                    "Worksheet %r opened (configured main_sheet_name=%r was missing). "
                    "Update webshop_config.ini: main_sheet_name = order_level",
                    name,
                    configured,
                )
            break
        except gspread.exceptions.WorksheetNotFound:
            continue

    if worksheet is None and config.has_option("spreadsheets", "main_sheet_gid"):
        gid = int(config.get("spreadsheets", "main_sheet_gid"))
        worksheet = spreadsheet.get_worksheet_by_id(gid)
        title = worksheet.title
        if title == items_name or title.casefold() in ("items", "item_level"):
            available = ", ".join(ws.title for ws in spreadsheet.worksheets())
            raise RuntimeError(
                f"main_sheet_gid={gid} points to item tab {title!r}, not order_level. "
                f"Set main_sheet_name=order_level in static/secrets/webshop_config.ini. "
                f"Available tabs: {available}"
            )
        logger.warning(
            "Opened by main_sheet_gid=%s (%r); prefer main_sheet_name=order_level.",
            gid,
            title,
        )

    if worksheet is None:
        available = ", ".join(ws.title for ws in spreadsheet.worksheets())
        raise RuntimeError(
            f"No order worksheet found (tried {candidates!r}). "
            f"Set main_sheet_name=order_level in webshop_config.ini. "
            f"Available tabs: {available}"
        )

    logger.info("Opened spreadsheet sheet: %s", worksheet.title)
    return worksheet


def open_items_sheet(main_sheet: gspread.Worksheet, config=None) -> gspread.Worksheet:
    """Open the item_level worksheet (fallback names: item_level, ITEMS)."""
    config = config or load_config()
    configured = item_level_sheet_name(config)
    spreadsheet = main_sheet.spreadsheet

    candidates: list[str] = []
    for name in (configured, "item_level", "ITEMS", "Items"):
        n = (name or "").strip()
        if n and n not in candidates:
            candidates.append(n)

    worksheet = None
    for name in candidates:
        try:
            worksheet = spreadsheet.worksheet(name)
            if name != configured:
                logger.warning(
                    "Worksheet %r opened (configured items_sheet_name=%r was missing). "
                    "Update webshop_config.ini: items_sheet_name = item_level",
                    name,
                    configured,
                )
            break
        except gspread.exceptions.WorksheetNotFound:
            continue

    if worksheet is None and config.has_option("spreadsheets", "items_sheet_gid"):
        gid = int(config.get("spreadsheets", "items_sheet_gid"))
        worksheet = spreadsheet.get_worksheet_by_id(gid)
        logger.warning(
            "Opened items tab by items_sheet_gid=%s (%r).",
            gid,
            worksheet.title,
        )

    if worksheet is None:
        available = ", ".join(ws.title for ws in spreadsheet.worksheets())
        raise RuntimeError(
            f"No items worksheet found (tried {candidates!r}). "
            f"Set items_sheet_name=item_level in webshop_config.ini. "
            f"Available tabs: {available}"
        )

    logger.info("Opened spreadsheet sheet: %s", worksheet.title)
    return worksheet


def init_connections(
    config=None,
) -> Tuple[gspread.Client, gspread.Worksheet]:
    """Authorize Sheets and open the order_level worksheet."""
    config = config or load_config()
    sheets = authenticate_sheets(config)
    main = open_main_sheet(sheets, config)
    return sheets, main
