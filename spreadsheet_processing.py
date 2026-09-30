"""Spreadsheet row discovery, phase updates, attachment download."""

from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse
import pandas as pd
import gspread
import requests
from gspread.exceptions import APIError
from gspread.utils import rowcol_to_a1

from config_loader import accept_legacy_main_row, bot_pickup_phase, load_config, pipeline_valid_active_phase
from logging_setup import get_logger
from webshop.config import COLUMN_ALIASES, ORDER_PHASE, WEBSHOP_ITEM_STATUS_OK

logger = get_logger()


def safe_update_cell(
    sheet: gspread.Worksheet,
    row: int,
    col: int,
    value: str,
    retries: int = 6,
    delay: float = 3.0,
) -> None:
    for attempt in range(1, retries + 1):
        try:
            sheet.update_cell(row, col, value)
            return
        except APIError as exc:
            msg = str(exc).lower()
            if attempt < retries and ("429" in msg or "quota" in msg or "rate" in msg):
                wait = delay * (2 ** (attempt - 1))
                logger.warning(
                    "Sheets quota hit updating r%s c%s; retry in %.0fs (%s/%s).",
                    row,col,wait,attempt,retries,
                )
                time.sleep(wait)
                continue
            raise

def _get_col_idx(headers: List[str], target_name: str, fallback_idx: int = -1) -> int:
    """Find 1-based column index; supports legacy header names via COLUMN_ALIASES."""
    norm_headers = [str(h).strip().lower() for h in headers]
    candidates = [str(target_name).strip().lower()]
    candidates.extend(COLUMN_ALIASES.get(candidates[0], []))
    for name in candidates:
        if name in norm_headers:
            return norm_headers.index(name) + 1
    if fallback_idx > 0:
        return fallback_idx
    raise KeyError(f"Column {target_name!r} not found in headers {headers!r}.")

def find_row_by_email_id(
    sheet: gspread.Worksheet,
    email_id: str,
    config=None,
    *,
    known_row: Optional[int] = None,
) -> int:
    """
    Locate the current 1-based sheet row for order_id (legacy param name: email_id).
    """
    email_id = (email_id or "").strip()
    if not email_id:
        raise ValueError("order_id is required to locate the sheet row to edit.")

    config = config or load_config()
    values = sheet.get_all_values()
    if not values:
        raise LookupError(f"order_level sheet is empty; cannot find order_id={email_id!r}.")

    idx_email = _get_col_idx(values[0], "order_id") - 1

    for row_offset, row in enumerate(values[1:], start=2):
        cell = row[idx_email].strip() if idx_email < len(row) else ""
        if cell == email_id:
            if known_row is not None and known_row != row_offset:
                logger.info(
                    "Row for email_id=%s moved %s -> %s (sheet shifted; editing current row).",
                    email_id,
                    known_row,
                    row_offset,
                )
            return row_offset

    raise LookupError(
        f"No order_level row found for order_id={email_id!r} "
        f"(known_row={known_row!r}). Cannot safely edit phase/timestamp."
    )


def _resolve_edit_row(
    sheet: gspread.Worksheet,
    email_id: Optional[str],
    row_number: Optional[int],
    config=None,
) -> int:
    """Prefer email_id lookup; fall back to row_number only if email_id missing."""
    if email_id and str(email_id).strip():
        return find_row_by_email_id(
            sheet, email_id, config, known_row=row_number
        )
    if row_number is None:
        raise ValueError("Either email_id or row_number is required to edit the sheet.")
    logger.warning(
        "Editing sheet row %s without email_id — unsafe if new emails insert rows.",
        row_number,
    )
    return row_number


def set_active_phase(
    sheet: gspread.Worksheet,
    value: str,
    config=None,
    *,
    email_id: Optional[str] = None,
    row_number: Optional[int] = None,
) -> int:
    """Write active_phase (pipeline step or progress / error detail)."""
    config = config or load_config()
    row = _resolve_edit_row(sheet, email_id, row_number, config)
    headers = sheet.row_values(1)
    col_idx = _get_col_idx(headers, "active_phase")
    text = str(value or "").strip()
    safe_update_cell(sheet, row, col_idx, text)
    logger.info(
        "active_phase order_id=%s row %s -> %s",
        email_id or "(none)",
        row,
        text,
    )
    return row


def set_robot_phase(
    sheet: gspread.Worksheet,
    phase: str,
    detail: str = "",
    config=None,
    *,
    email_id: Optional[str] = None,
    row_number: Optional[int] = None,
) -> int:
    """Legacy API: maps to active_phase as 'PHASE' or 'PHASE - detail'."""
    text = phase.strip()
    if detail and detail.upper() != text.upper():
        text = f"{text} - {detail}"
    return set_active_phase(
        sheet, text, config, email_id=email_id, row_number=row_number
    )


def set_batch_name(
    sheet: gspread.Worksheet,
    batch_name: str,
    config=None,
    *,
    email_id: Optional[str] = None,
    row_number: Optional[int] = None,
) -> int:
    """Write saved_card_name — webshop saved cart name chosen by the robot."""
    config = config or load_config()
    row = _resolve_edit_row(sheet, email_id, row_number, config)
    headers = sheet.row_values(1)

    col_idx = _get_col_idx(headers, "saved_card_name", fallback_idx=11)

    text = str(batch_name or "").strip()
    safe_update_cell(sheet, row, col_idx, text)
    logger.info(
        "saved_card_name order_id=%s row %s -> %s",
        email_id or "(none)",
        row,
        text,
    )
    return row


def set_order_phase(
    sheet: gspread.Worksheet,
    phase: str,
    config=None,
    *,
    email_id: Optional[str] = None,
    row_number: Optional[int] = None,
) -> int:
    """Write phase — only IN PROGRESS | READY | DONE | ERROR."""
    config = config or load_config()
    row = _resolve_edit_row(sheet, email_id, row_number, config)
    headers = sheet.row_values(1)
    col_idx = _get_col_idx(headers, "phase")
    text = phase.strip()
    if text and text not in ORDER_PHASE.ALL:
        logger.warning(
            "phase=%r is not in ORDER_PHASE dictionary %s; writing anyway.",
            text,
            sorted(ORDER_PHASE.ALL),
        )
    safe_update_cell(sheet, row, col_idx, text)
    logger.info(
        "phase order_id=%s row %s -> %s",
        email_id or "(none)",
        row,
        text,
    )
    return row


def set_manual_phase(
    sheet: gspread.Worksheet,
    phase: str,
    config=None,
    *,
    email_id: Optional[str] = None,
    row_number: Optional[int] = None,
) -> int:
    """Alias for set_order_phase (legacy name)."""
    return set_order_phase(
        sheet, phase, config, email_id=email_id, row_number=row_number
    )


def set_timestamp_processed_at(
    sheet: gspread.Worksheet,
    config=None,
    *,
    email_id: Optional[str] = None,
    row_number: Optional[int] = None,
    when: Optional[datetime] = None,
) -> Tuple[str, int]:
    """Write timestamp_bot_done (ISO UTC) when the bot finishes or errors."""
    config = config or load_config()
    row = _resolve_edit_row(sheet, email_id, row_number, config)
    moment = when or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    stamp = moment.isoformat(timespec="seconds").replace("+00:00", "Z")
    headers = sheet.row_values(1)
    col_idx = _get_col_idx(headers, "timestamp_bot_done", fallback_idx=10)
    safe_update_cell(sheet, row, col_idx, stamp)
    logger.info(
        "timestamp_bot_done order_id=%s row %s -> %s",
        email_id or "(none)",
        row,
        stamp,
    )
    return stamp, row


def _normalize_material(value: str) -> str:
    text = str(value or "").strip().upper()
    return text.lstrip("0") or text


def _replacement_codes(item_status: str) -> List[str]:
    """Codes from statuses like 'replaced (3393640->3393641)'."""
    pairs = re.findall(r"([\w-]+)\s*->\s*([\w-]+)", str(item_status or ""))
    return [code for pair in pairs for code in pair]


def set_webshop_item_status(
    items_sheet: gspread.Worksheet,
    email_id: str,
    failed_by_material: Dict[str, str],
    config=None,
) -> int:
    """
    Update item_status on item_level rows for order_id after webshop upload.
    Refused materials get the webshop error text; accepted rows get WEBSHOP_STATUS_OK.
    """
    email_id = (email_id or "").strip()
    if not email_id:
        raise ValueError("order_id is required to write item_status after upload.")

    values = items_sheet.get_all_values()
    if not values:
        raise LookupError("item_level sheet is empty; cannot write item_status.")

    headers = values[0]
    status_col = _get_col_idx(headers, "item_status")
    idx_email = _get_col_idx(headers, "order_id") - 1
    idx_item = _get_col_idx(headers, "item_number") - 1
    idx_status = status_col - 1

    # BigQuery rewrites ITEM_NAME to the replacement material, while the webshop
    # reports the original code from the attachment CSV — match on both.
    failed = {_normalize_material(k): v for k, v in failed_by_material.items()}
    matched: set[str] = set()
    updates: List[dict] = []

    for row_number, row in enumerate(values[1:], start=2):
        if (row[idx_email].strip() if idx_email < len(row) else "") != email_id:
            continue

        item_name = row[idx_item] if idx_item < len(row) else ""
        item_status = row[idx_status] if idx_status < len(row) else ""
        keys = [_normalize_material(item_name)]
        keys += [_normalize_material(code) for code in _replacement_codes(item_status)]

        text = WEBSHOP_ITEM_STATUS_OK
        for key in keys:
            if key in failed:
                text = failed[key]
                matched.add(key)
                break

        updates.append(
            {"range": rowcol_to_a1(row_number, status_col), "values": [[text]]}
        )

    if not updates:
        logger.warning(
            "No item_level row found for order_id=%s; item_status not written.",
            email_id,
        )
        return 0

    unmatched = sorted(set(failed) - matched)
    if unmatched:
        logger.warning(
            "Webshop refused material(s) with no item_level row for order_id=%s: %s",
            email_id,
            ", ".join(unmatched),
        )

    items_sheet.batch_update(updates)
    logger.info(
        "item_status (webshop) order_id=%s -> %s row(s), %s refused by webshop.",
        email_id,
        len(updates),
        len(matched),
    )
    return len(updates)


def _apply_order_column_aliases(full_df: pd.DataFrame) -> pd.DataFrame:
    """Expose legacy pandas field names used by order_helper (email_id, client_number, …)."""
    alias_to_internal = {
        "order_id": "email_id",
        "customer_number": "client_number",
        "customer_name": "client_name",
        "order_csv": "attachments_path",
    }
    for source, target in alias_to_internal.items():
        if source in full_df.columns and target not in full_df.columns:
            full_df[target] = full_df[source]
    if "email_id" not in full_df.columns and "order_id" in full_df.columns:
        full_df["email_id"] = full_df["order_id"]
    return full_df


def _legacy_main_pending_mask(full_df: pd.DataFrame, pipeline_valid: str) -> pd.Series:
    """Old MAIN: MANUAL_PHASE=PROCESSING, ROBOT_PHASE empty, ACTIVE_PHASE=5_VALID."""
    manual = full_df.get("manual_phase", pd.Series("", index=full_df.index)).astype(str)
    robot = full_df.get("robot_phase", pd.Series("", index=full_df.index)).astype(str)
    active = full_df.get("active_phase", pd.Series("", index=full_df.index)).astype(str)
    return (
        manual.str.strip().str.upper().eq("PROCESSING")
        & robot.str.strip().eq("")
        & active.str.strip().str.upper().eq(pipeline_valid.strip().upper())
    )


def find_pending_orders(sheet: gspread.Worksheet, config=None) -> pd.DataFrame:
    """
    order_level pick-up: phase == READY (any active_phase).
    Skips IN PROGRESS / DONE / ERROR.
    """
    config = config or load_config()

    values = sheet.get_all_values()
    if not values or len(values) < 2:
        logger.warning("order_level sheet is empty.")
        return pd.DataFrame()

    headers = values[0]
    header_preview = [str(h).strip() for h in headers[:5]]
    logger.debug("order_level headers (first 5): %s", header_preview)

    full_df = pd.DataFrame(values[1:], columns=[str(h).strip().lower() for h in headers])
    full_df["row_number"] = full_df.index + 2
    full_df = _apply_order_column_aliases(full_df)

    phase_col = full_df.get("phase", full_df.get("manual_phase", pd.Series("", index=full_df.index))).astype(str)

    pickup_phase = bot_pickup_phase(config)
    pipeline_valid = pipeline_valid_active_phase(config)

    phase_stripped = phase_col.str.strip()
    pending_mask = phase_stripped == pickup_phase
    if not pending_mask.any():
        pending_mask = phase_stripped.str.upper() == pickup_phase.strip().upper()
    pending_orders_df = full_df[pending_mask].copy()
    if "order_id" in pending_orders_df.columns:
        has_id = pending_orders_df["order_id"].astype(str).str.strip() != ""
        dropped = (~has_id).sum()
        if dropped:
            logger.warning("Skipped %s READY row(s) with empty order_id.", int(dropped))
        pending_orders_df = pending_orders_df[has_id]
    source = "order_level"

    if pending_orders_df.empty and accept_legacy_main_row(config):
        legacy_mask = _legacy_main_pending_mask(full_df, pipeline_valid)
        pending_orders_df = full_df[legacy_mask]
        if not pending_orders_df.empty:
            source = "legacy MAIN"
            logger.warning(
                "Picked %s row(s) via legacy MAIN rule; migrate to phase=READY on order_level.",
                len(pending_orders_df),
            )

    if pending_orders_df.empty and len(full_df) > 0:
        sample_phases = sorted({p for p in phase_stripped.unique() if str(p).strip()})
        ready_like = phase_stripped.str.strip().str.upper().eq(pickup_phase.upper()).sum()
        logger.info(
            "No pending rows on tab %r (looking for phase=%r). "
            "Rows in sheet: %s; phase values seen: %s; case-insensitive READY count: %s.",
            sheet.title,
            pickup_phase,
            len(full_df),
            sample_phases[:15],
            int(ready_like),
        )
        if "phase" not in full_df.columns and "manual_phase" not in full_df.columns:
            logger.error(
                "Missing 'phase' column on %r — bot may be on the wrong tab (e.g. item_level). "
                "Headers: %s",
                sheet.title,
                header_preview,
            )
        elif ready_like and pending_orders_df.empty:
            logger.warning(
                "READY-like values exist but did not match exactly %r (check spaces/casing).",
                pickup_phase,
            )

    logger.info(
        "Found %s pending order row(s) from %s (phase=%r).",
        len(pending_orders_df),
        source,
        pickup_phase,
    )
    return pending_orders_df


def _extract_drive_file_id(path_or_url: str) -> Optional[str]:
    text = path_or_url.strip()
    patterns = [
        r"/file/d/([a-zA-Z0-9_-]+)",
        r"id=([a-zA-Z0-9_-]+)",
        r"^([a-zA-Z0-9_-]{25,})$",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return match.group(1)

    parsed = urlparse(text)
    if "drive.google.com" in parsed.netloc:
        qs = parse_qs(parsed.query)
        if "id" in qs:
            return qs["id"][0]
    return None


def _sheet_name_candidates(source: str) -> List[str]:
    """Build possible worksheet titles from values like 'Sheet1.csv'."""
    name = Path(source).name.strip()
    candidates = [name]
    if name.lower().endswith(".csv"):
        candidates.append(name[:-4])
    # Deduplicate while preserving order
    seen = set()
    unique: List[str] = []
    for item in candidates:
        key = item.casefold()
        if item and key not in seen:
            seen.add(key)
            unique.append(item)
    return unique


def export_worksheet_to_csv(
    worksheet: gspread.Worksheet,
    destination_dir: str | Path,
    output_name: Optional[str] = None,
) -> Path:
    """Download all values from a worksheet and save as CSV."""
    dest_dir = Path(destination_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)

    values = worksheet.get_all_values()
    name = output_name or f"{worksheet.title}.csv"
    if not name.lower().endswith(".csv"):
        name = f"{name}.csv"
    target = dest_dir / name

    import csv

    with open(target, "w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerows(values)

    logger.info(
        "Exported worksheet %r -> %s (%s rows).",
        worksheet.title,
        target,
        len(values),
    )
    return target


def _export_named_sheet_as_csv(
    spreadsheet: gspread.Spreadsheet,
    sheet_ref: str,
    destination_dir: str | Path,
) -> Path:
    """Find worksheet by name (Sheet1 / Sheet1.csv) and export to CSV."""
    titles = {ws.title: ws for ws in spreadsheet.worksheets()}
    title_by_lower = {t.casefold(): ws for t, ws in titles.items()}

    for candidate in _sheet_name_candidates(sheet_ref):
        ws = titles.get(candidate) or title_by_lower.get(candidate.casefold())
        if ws is not None:
            out_name = sheet_ref if sheet_ref.lower().endswith(".csv") else f"{ws.title}.csv"
            return export_worksheet_to_csv(ws, destination_dir, output_name=out_name)

    available = ", ".join(sorted(titles)) or "(none)"
    raise FileNotFoundError(
        f"No worksheet matching ATTACHMENTS_PATH={sheet_ref!r}. "
        f"Available sheets: {available}"
    )


def _client_credentials(sheets_client: gspread.Client):
    """gspread 6 stores credentials on http_client.auth (not client.auth)."""
    http_client = getattr(sheets_client, "http_client", None)
    creds = getattr(http_client, "auth", None) if http_client is not None else None
    if creds is None:
        creds = getattr(sheets_client, "auth", None)
    if creds is None:
        raise RuntimeError("Could not read credentials from gspread Client.")
    return creds


def _find_drive_file_by_name(
    sheets_client: gspread.Client,
    file_name: str,
    dest_dir: Path,
) -> Optional[Path]:
    """Search Drive for a file with this exact name and download it."""
    try:
        from googleapiclient.discovery import build
    except ImportError:
        return None

    creds = _client_credentials(sheets_client)
    drive = build("drive", "v3", credentials=creds, cache_discovery=False)
    safe_name = file_name.replace("'", "\\'")
    query = f"name = '{safe_name}' and trashed = false"
    result = (
        drive.files()
        .list(q=query, spaces="drive", fields="files(id, name)", pageSize=5)
        .execute()
    )
    files = result.get("files") or []
    if not files:
        return None
    return _download_drive_file(sheets_client, files[0]["id"], dest_dir)


def download_attachment(
    attachments_path: str,
    destination_dir: str | Path,
    sheets_client: Optional[gspread.Client] = None,
    spreadsheet: Optional[gspread.Spreadsheet] = None,
) -> Path:
    """
    Resolve ATTACHMENTS_PATH:
    - local filesystem path
    - http(s) URL
    - Google Drive file link / id
    - worksheet name in the same spreadsheet (e.g. Sheet1.csv / Sheet1)
    - Drive file name search (e.g. Sheet1.csv)
    """
    dest_dir = Path(destination_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)
    source = attachments_path.strip().strip('"')

    if not source:
        raise ValueError("ATTACHMENTS_PATH is empty.")

    local = Path(source)
    if local.exists() and local.is_file():
        target = dest_dir / local.name
        if local.resolve() != target.resolve():
            target.write_bytes(local.read_bytes())
        logger.info("Copied local attachment: %s", target)
        return target

    drive_id = _extract_drive_file_id(source)
    if drive_id and sheets_client is not None:
        return _download_drive_file(sheets_client, drive_id, dest_dir)

    if source.lower().startswith(("http://", "https://")):
        response = requests.get(source, timeout=120)
        response.raise_for_status()
        name = Path(urlparse(source).path).name or f"attachment_{int(time.time())}.csv"
        if not name.lower().endswith(".csv"):
            name = f"{name}.csv"
        target = dest_dir / name
        target.write_bytes(response.content)
        logger.info("Downloaded attachment from URL: %s", target)
        return target

    # Bare name like Sheet1.csv → export matching worksheet from this spreadsheet
    if spreadsheet is not None:
        try:
            return _export_named_sheet_as_csv(spreadsheet, source, dest_dir)
        except FileNotFoundError:
            logger.info(
                "No worksheet for %r; trying Drive file name search.",
                source,
            )

    if sheets_client is not None:
        found = _find_drive_file_by_name(sheets_client, Path(source).name, dest_dir)
        if found is not None:
            return found
        # Also try without .csv suffix as filename
        for candidate in _sheet_name_candidates(source):
            if candidate == Path(source).name:
                continue
            found = _find_drive_file_by_name(
                sheets_client, f"{candidate}.csv", dest_dir
            )
            if found is not None:
                return found

    raise FileNotFoundError(
        f"Cannot resolve ATTACHMENTS_PATH: {attachments_path!r}. "
        "Expected local path, http(s) URL, Drive link/id, worksheet name "
        "(e.g. Sheet1.csv), or Drive file name."
    )


def _download_drive_file(
    sheets_client: gspread.Client,
    file_id: str,
    dest_dir: Path,
) -> Path:
    """Download a Drive file using the same credentials as gspread."""
    try:
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaIoBaseDownload
        import io
    except ImportError as exc:
        raise RuntimeError("google-api-python-client required for Drive downloads") from exc

    creds = _client_credentials(sheets_client)
    drive = build("drive", "v3", credentials=creds, cache_discovery=False)
    meta = drive.files().get(fileId=file_id, fields="name,mimeType").execute()
    name = meta.get("name") or f"{file_id}.csv"
    target = dest_dir / name

    request = drive.files().get_media(fileId=file_id)
    buffer = io.BytesIO()
    downloader = MediaIoBaseDownload(buffer, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()

    target.write_bytes(buffer.getvalue())
    logger.info("Downloaded Drive file %s -> %s", file_id, target)
    return target


def load_order_items_dataframe(
    items_sheet: gspread.Worksheet,
    order_id: str,
    config=None,
) -> pd.DataFrame:
    """
    Load item_number / item_qty from item_level for one order_id.
    Returns columns Item number, Order amount (webshop batch format).
    """
    order_id = (order_id or "").strip()
    if not order_id:
        raise ValueError("order_id is required to load item_level rows.")

    values = items_sheet.get_all_values()
    if not values or len(values) < 2:
        raise LookupError("item_level sheet is empty.")

    headers = values[0]
    df = pd.DataFrame(values[1:], columns=[str(h).strip().lower() for h in headers])

    if "order_id" in df.columns:
        id_col = "order_id"
    elif "email_id" in df.columns:
        id_col = "email_id"
    else:
        raise KeyError("item_level has no order_id column.")

    mask = df[id_col].astype(str).str.strip() == order_id
    subset = df.loc[mask].copy()
    if subset.empty:
        raise LookupError(f"No item_level rows for order_id={order_id!r}.")

    def _col(name: str, aliases: list[str]) -> str:
        if name in subset.columns:
            return name
        for alt in aliases:
            if alt in subset.columns:
                return alt
        raise KeyError(
            f"item_level missing {name!r} (tried {aliases}); headers={list(df.columns)!r}."
        )

    item_col = _col("item_number", ["item_name"])
    qty_col = _col("item_qty", ["item_count"])

    items = pd.DataFrame(
        {
            "Item number": subset[item_col].astype(str).str.strip(),
            "Order amount": subset[qty_col].astype(str).str.strip(),
        }
    )
    items = items[(items["Item number"] != "") & (items["Order amount"] != "")]
    if items.empty:
        raise ValueError(
            f"item_level rows for order_id={order_id!r} have no item_number/item_qty."
        )

    logger.info(
        "Loaded %s item_level row(s) for order_id=%s.",
        len(items),
        order_id,
    )
    return items.reset_index(drop=True)
