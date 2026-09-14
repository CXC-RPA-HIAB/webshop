const ItemsSheetWriter = {
  // ITEMS layout: A EMAIL_ID, B CUSTOMER_NAME, C CUSTOMER_NUMBER,
  // D ATTACHMENT_NAME, E ITEM_NAME, F ITEM_COUNT, G ITEM_STATUS, H MATCH_TYPE,
  // I WEBSHOP_ITEM_STATUS (written by the Python robot, never by this script)
  HEADERS: [
    "EMAIL_ID",
    "CUSTOMER_NAME",
    "CUSTOMER_NUMBER",
    "ATTACHMENT_NAME",
    "ITEM_NAME",
    "ITEM_COUNT",
    "ITEM_STATUS",
    "MATCH_TYPE",
    "WEBSHOP_ITEM_STATUS"
  ],
  LAST_COLUMN: 9,

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

    for (let c = 0; c < headers.length; c++) {
      const raw = String(headers[c] || "").trim();
      if (!raw) continue;
      indexes[raw] = c;
      indexes[this.normalizeHeader(raw)] = c;
    }

    return indexes;
  },

  writeValidation: function(itemsSheet, rowIndex, item) {
    const lastColumn = Math.max(itemsSheet.getLastColumn(), this.LAST_COLUMN);
    const indexes = this.headerIndexes(itemsSheet);
    const rowValues = itemsSheet.getRange(rowIndex, 1, 1, lastColumn).getValues()[0];

    const itemNameIdx = indexes.ITEM_NAME;
    const customerNumberIdx = indexes.CUSTOMER_NUMBER;
    const itemStatusIdx = indexes.ITEM_STATUS;
    const matchTypeIdx = indexes.MATCH_TYPE;

    if (itemNameIdx !== undefined) {
      rowValues[itemNameIdx] = item.resolvedItemName || item.ITEM_NAME || "";
    }
    if (customerNumberIdx !== undefined) {
      rowValues[customerNumberIdx] = item.resolvedCustomerNumber || item.CUSTOMER_NUMBER || "";
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
