"""Prepare batch-order CSV"""

from dataclasses import dataclass
from pathlib import Path
import pandas as pd
from logging_setup import get_logger

logger = get_logger()

DEFAULT_BATCH_MAX_ROWS = 100
BATCH_CSV_COLUMNS = ("Item number", "Order amount")


@dataclass
class BatchPayload:
    """Item/quantity dataframe plus on-disk CSV chunks ready for Batch Order upload."""

    items: pd.DataFrame
    batch_files: list[Path]
    total_rows: int
    batch_size: int

    @property
    def batch_count(self) -> int:
        return len(self.batch_files)


def _normalize_items_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    """Col1 part (Item number), col2 qty (Order amount)."""
    part_col, qty_col = BATCH_CSV_COLUMNS
    if not {part_col, qty_col}.issubset(df.columns):
        raise ValueError(
            f"Items dataframe must have columns {BATCH_CSV_COLUMNS!r}, got {list(df.columns)!r}."
        )
    out = df[[part_col, qty_col]].copy()
    out["Item number"] = out["Item number"].astype(str).str.strip()
    out["Order amount"] = out["Order amount"].astype(str).str.strip()
    out = out[(out["Item number"] != "") & (out["Order amount"] != "")]
    out = out.dropna(how="all")
    if out.empty:
        raise ValueError("No item rows after normalization.")
    return out.reset_index(drop=True)


def _write_batch_files(
    df: pd.DataFrame, out_dir: Path, stem: str, batch_size: int
) -> list[Path]:
    batch_files: list[Path] = []
    for i in range(0, len(df), batch_size):
        chunk = df.iloc[i : i + batch_size][list(BATCH_CSV_COLUMNS)]
        target = out_dir / f"{stem}_batch_{i // batch_size + 1}.csv"
        chunk.to_csv(target, index=False)
        batch_files.append(target)
        logger.info("Wrote batch file %s (%s rows).", target.name, len(chunk))
    return batch_files


def prepare_batch_payload_from_dataframe(
    items: pd.DataFrame,
    output_dir,
    stem: str,
    batch_size: int = DEFAULT_BATCH_MAX_ROWS,
) -> BatchPayload:
    """Split item/qty dataframe into on-disk batch CSVs for Batch Order upload."""
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    df = _normalize_items_dataframe(items)
    batch_files = _write_batch_files(df, out_dir, stem, batch_size)
    return BatchPayload(
        items=df, batch_files=batch_files, total_rows=len(df), batch_size=batch_size
    )


def prepare_batch_payload(source_csv, output_dir, stem, batch_size: int = DEFAULT_BATCH_MAX_ROWS) -> BatchPayload:
    """
    Read local CSV (columns A/B), build batches (legacy path).
    Prefer prepare_batch_payload_from_dataframe with item_level data.
    """
    raw = pd.read_csv(source_csv, usecols=[0, 1], dtype=str).dropna(how="all")
    raw.columns = ["Item number", "Order amount"]
    return prepare_batch_payload_from_dataframe(raw, output_dir, stem, batch_size)
