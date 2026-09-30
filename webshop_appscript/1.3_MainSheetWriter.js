const SheetHelper = {
  ORDER_COL: {
    ORDER_ID: 1,
    PHASE: 2,
    ACTIVE_PHASE: 3,
    EMAIL_RESPONSE: 4,
    ORDER_CSV: 8
  },

  ensureOrderHeaders: function(mainSheet) {
    const lastColumn = CONFIG.ORDER_HEADERS.length;
    const maxColumns = mainSheet.getMaxColumns();
    if (maxColumns < lastColumn) {
      mainSheet.insertColumnsAfter(maxColumns, lastColumn - maxColumns);
    }
    const headerRow = mainSheet.getRange(1, 1, 1, lastColumn).getValues()[0];
    let headersChanged = false;
    for (let c = 0; c < CONFIG.ORDER_HEADERS.length; c++) {
      if (String(headerRow[c] || "").trim() !== CONFIG.ORDER_HEADERS[c]) {
        headerRow[c] = CONFIG.ORDER_HEADERS[c];
        headersChanged = true;
      }
    }
    if (headersChanged) {
      mainSheet.getRange(1, 1, 1, lastColumn).setValues([headerRow]);
    }
  },

  appendInitialRow: function(mainRecord) {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const mainSheet = ss.getSheetByName(CONFIG.SHEETS.MAIN);
    this.ensureOrderHeaders(mainSheet);

    mainSheet.insertRowAfter(1);

    const orderId = mainRecord.order_id || mainRecord.EMAIL_ID || "";
    const rowData = [
      orderId,
      mainRecord.phase || mainRecord.MANUAL_PHASE || "",
      mainRecord.active_phase || mainRecord.ACTIVE_PHASE || "",
      mainRecord.email_response || mainRecord.EMAIL_FEEDBACK || "NO",
      mainRecord.customer_name || mainRecord.CLIENT || "",
      mainRecord.customer_number || mainRecord.CLIENT_ID || "",
      mainRecord.customer_email || mainRecord.CUSTOMER_EMAIL || "",
      mainRecord.order_csv || mainRecord.ATTACHMENT_PATH || "",
      mainRecord.timestamp_order_receive || mainRecord.TIMESTAMP_EMAIL_RECEIVE || new Date(),
      mainRecord.timestamp_bot_done || mainRecord.TIMESTAMP_PROCESSED_AT || "",
      mainRecord.saved_card_name || mainRecord.TITLE || mainRecord.ATTACHMENT_NAME || "",
      mainRecord.internal_email || mainRecord.INTERNAL_EMAIL || mainRecord.EMAIL || ""
    ];

    mainSheet.getRange(2, 1, 1, rowData.length).setValues([rowData]);
    SpreadsheetApp.flush();
    return 2;
  },

  /**
   * @param {number} rowIndex 1-based sheet row
   * @param {string} activePhase pipeline step or bot state (column active_phase)
   * @param {string} phase manual phase (column phase)
   */
  updateStatus: function(rowIndex, activePhase, phase) {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.SHEETS.MAIN);

    const activePhaseStr = String(activePhase);
    let phaseValue = phase;
    if (activePhaseStr.indexOf(CONFIG.PHASES.ERROR) === 0) {
      phaseValue = activePhaseStr;
    }
    sheet.getRange(rowIndex, this.ORDER_COL.PHASE).setValue(phaseValue);
    sheet.getRange(rowIndex, this.ORDER_COL.ACTIVE_PHASE).setValue(activePhaseStr);

    SpreadsheetApp.flush();
  },

  updateCell: function(rowIndex, colIndex, value) {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.SHEETS.MAIN);

    sheet.getRange(rowIndex, colIndex).setValue(value);
    SpreadsheetApp.flush();
  },

  updateSmartChip: function(rowIndex, colIndex, fileUrl) {
    try {
      const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
      const sheetId = ss.getSheetByName(CONFIG.SHEETS.MAIN).getSheetId();

      const request = {
        updateCells: {
          range: {
            sheetId: sheetId,
            startRowIndex: rowIndex - 1,
            endRowIndex: rowIndex,
            startColumnIndex: colIndex - 1,
            endColumnIndex: colIndex
          },
          rows: [{
            values: [{
              userEnteredValue: { stringValue: "@" },
              chipRuns: [{
                startIndex: 0,
                chip: {
                  richLinkProperties: {
                    uri: fileUrl
                  }
                }
              }]
            }]
          }],
          fields: "userEnteredValue,chipRuns"
        }
      };

      Sheets.Spreadsheets.batchUpdate({ requests: [request] }, CONFIG.SPREADSHEET_ID);
    } catch (apiError) {
      const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
      const sheet = ss.getSheetByName(CONFIG.SHEETS.MAIN);
      sheet.getRange(rowIndex, colIndex).setFormula(`=HYPERLINK("${fileUrl}", "📄 View File")`);
    }
  },

  writeToSheets: function(emailId, attachmentName, parsedItems) {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const itemsSheet = ss.getSheetByName(CONFIG.SHEETS.ITEMS);

    if (!itemsSheet) {
      throw new Error(`Could not find sheet named: ${CONFIG.SHEETS.ITEMS}`);
    }

    ItemsSheetWriter.ensureColumns(itemsSheet);

    const rowsToWrite = parsedItems.map(item => [
      emailId,
      item.ITEM_NAME,
      item.ITEM_COUNT,
      CONFIG.ITEM_STATUS.QUEUED,
      ""
    ]);

    itemsSheet.insertRowsAfter(1, rowsToWrite.length);
    itemsSheet.getRange(2, 1, rowsToWrite.length, rowsToWrite[0].length).setValues(rowsToWrite);

    SpreadsheetApp.flush();
  },

  ensureItemsColumns: function(itemsSheet) {
    return ItemsSheetWriter.ensureColumns(itemsSheet);
  },

  logErrorToMain: function(emailId, exactManualPhase, activePhaseWithError) {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const mainSheet = ss.getSheetByName(CONFIG.SHEETS.MAIN);
    this.ensureOrderHeaders(mainSheet);

    mainSheet.insertRowAfter(1);

    const rowData = [
      emailId,
      activePhaseWithError || exactManualPhase,
      activePhaseWithError,
      "NO",
      "N/A",
      "N/A",
      "",
      "",
      new Date(),
      "",
      "",
      ""
    ];

    mainSheet.getRange(2, 1, 1, rowData.length).setValues([rowData]);
    SpreadsheetApp.flush();
  }
};
