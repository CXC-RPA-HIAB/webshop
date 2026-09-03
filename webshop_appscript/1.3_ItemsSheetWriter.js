const ItemsSheetWriter = {
  // ITEMS layout: A EMAIL_ID, B ATTACHMENT, C ITEM, D COUNT,
  // E STATUS, F MARKET_MATCH, G GBO_STATUS, H GBO_CHECK, I CUSTOMER_NUMBER
  HEADERS: ["EMAIL_ID", "ATTACHMENT_NAME", "ITEM_NAME", "ITEM_COUNT", "STATUS", "MARKET_MATCH", "GBO_STATUS", "GBO_CHECK", "CUSTOMER_NUMBER"],
  LAST_COLUMN: 9,

  ensureColumns: function(itemsSheet) {
    const maxColumns = itemsSheet.getMaxColumns();
    if (maxColumns < this.LAST_COLUMN) {
      itemsSheet.insertColumnsAfter(maxColumns, this.LAST_COLUMN - maxColumns);
    }

    const headerRow = itemsSheet.getRange(1, 1, 1, this.LAST_COLUMN).getValues()[0];
    let headersChanged = false;

    for (let c = 0; c < this.HEADERS.length; c++) {
      if (String(headerRow[c] || "").trim() === "") {
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

  // find column by exact name and inject values  
  writeValidation: function(itemsSheet, rowIndex, item) {
    const lastColumn = Math.max(itemsSheet.getLastColumn(), this.LAST_COLUMN);
    
    // Fetch headers and the current row data
    const headers = itemsSheet.getRange(1, 1, 1, lastColumn).getValues()[0];
    const rowValues = itemsSheet.getRange(rowIndex, 1, 1, lastColumn).getValues()[0];
    
    // Find the exact index for each column you want to update
    const statusIdx = headers.indexOf("STATUS");
    const marketMatchIdx = headers.indexOf("MARKET_MATCH");
    const gboStatusIdx = headers.indexOf("GBO_STATUS");
    const gboCheckIdx = headers.indexOf("GBO_CHECK");
    const customerNumberIdx = headers.indexOf("CUSTOMER_NUMBER");

    // STATUS (E): VALID only if material exists in BQ; market/GBO stay in F–H
    if (statusIdx !== -1) rowValues[statusIdx] = item.existsInBq ? "VALID" : "INVALID_BQ";
    if (marketMatchIdx !== -1) rowValues[marketMatchIdx] = item.marketMatch || "NO_DATA";
    if (gboStatusIdx !== -1) rowValues[gboStatusIdx] = item.gboStatus || "NO_DATA";
    if (gboCheckIdx !== -1) rowValues[gboCheckIdx] = item.gboCheck || "NO_DATA";
    // CUSTOMER_NUMBER (I): original client on STANDARD_MATCH, GBM1 client on GBO_MATCH
    if (customerNumberIdx !== -1) rowValues[customerNumberIdx] = item.resolvedCustomerNumber || "";

    // Write the updated row back to the sheet
    itemsSheet.getRange(rowIndex, 1, 1, lastColumn).setValues([rowValues]);
  }


};


