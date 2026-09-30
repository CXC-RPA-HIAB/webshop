const ItemsSheetWriter = {
  HEADERS: CONFIG.ITEM_HEADERS,
  LAST_COLUMN: CONFIG.ITEM_HEADERS.length,

  ensureColumns: function(itemsSheet) {
    const maxColumns = itemsSheet.getMaxColumns();
    if (maxColumns < this.LAST_COLUMN) {
      itemsSheet.insertColumnsAfter(maxColumns, this.LAST_COLUMN - maxColumns);
    }

    const headerRow = itemsSheet.getRange(1, 1, 1, this.LAST_COLUMN).getValues()[0];
    let headersChanged = false;

    for (let c = 0; c < this.HEADERS.length; c++) {
      if (String(headerRow[c] || "").trim() !== this.HEADERS[c]) {
        headerRow[c] = this.HEADERS[c];
        headersChanged = true;
      }
    }

    if (headersChanged) {
      itemsSheet.getRange(1, 1, 1, this.LAST_COLUMN).setValues([headerRow]);
    }
  },

  normalizeHeader: function(value) {
    return String(value == null ? "" : value).replace(/[\s_\-.]/g, "").trim().toUpperCase();
  },

  headerIndexes: function(itemsSheet) {
    const lastColumn = Math.max(itemsSheet.getLastColumn(), this.LAST_COLUMN);
    const headers = itemsSheet.getRange(1, 1, 1, lastColumn).getValues()[0];
    const indexes = {};

    const alias = {
      EMAILID: "ORDERID",
      ITEMNAME: "ITEMNUMBER",
      ITEMCOUNT: "ITEMQTY",
      MATCHTYPE: "ITEMMATCHTYPE"
    };

    for (let c = 0; c < headers.length; c++) {
      const raw = String(headers[c] || "").trim();
      if (!raw) continue;
      indexes[raw] = c;
      const norm = this.normalizeHeader(raw);
      indexes[norm] = c;
      if (alias[norm]) {
        indexes[alias[norm]] = c;
      }
    }

    return indexes;
  },

  writeValidation: function(itemsSheet, rowIndex, item) {
    const lastColumn = Math.max(itemsSheet.getLastColumn(), this.LAST_COLUMN);
    const indexes = this.headerIndexes(itemsSheet);
    const rowValues = itemsSheet.getRange(rowIndex, 1, 1, lastColumn).getValues()[0];

    const itemNumberIdx = indexes.ITEM_NUMBER !== undefined ? indexes.ITEM_NUMBER : indexes.ITEMNAME;
    const itemStatusIdx = indexes.ITEM_STATUS;
    const matchTypeIdx = indexes.ITEM_MATCH_TYPE !== undefined ? indexes.ITEM_MATCH_TYPE : indexes.ITEMMATCHTYPE;

    if (itemNumberIdx !== undefined) {
      rowValues[itemNumberIdx] = item.resolvedItemName || item.ITEM_NAME || "";
    }
    if (itemStatusIdx !== undefined) {
      rowValues[itemStatusIdx] = item.itemStatus || "";
    }
    if (matchTypeIdx !== undefined) {
      rowValues[matchTypeIdx] = item.matchType || "";
    }

    itemsSheet.getRange(rowIndex, 1, 1, lastColumn).setValues([rowValues]);
  }
};
