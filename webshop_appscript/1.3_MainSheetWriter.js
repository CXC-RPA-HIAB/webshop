const SheetHelper = {
  appendInitialRow: function(mainRecord) {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const mainSheet = ss.getSheetByName(CONFIG.SHEETS.MAIN);
    
    mainSheet.insertRowAfter(1);
    
    // 11 Columns matching the new MAIN sheet layout
    const rowData = [
      mainRecord.EMAIL_ID,
      mainRecord.EMAIL,
      mainRecord.CLIENT_ID,
      mainRecord.CLIENT,
      mainRecord.ATTACHMENT_NAME,
      mainRecord.ATTACHMENT_PATH,
      mainRecord.ACTIVE_PHASE,
      mainRecord.MANUAL_PHASE,
      mainRecord.ROBOT_PHASE,
      mainRecord.EMAIL_FEEDBACK,
      mainRecord.TIMESTAMP_EMAIL_RECEIVE,
      mainRecord.TIMESTAMP_PROCESSED_AT,
      mainRecord.TITLE,
      mainRecord.SECOND_NUMBER
    ];
    
    mainSheet.getRange(2, 1, 1, rowData.length).setValues([rowData]);
    SpreadsheetApp.flush();
    return 2;
  },

  updateStatus: function(rowIndex, activePhase, manualPhase,robotPhase = null) {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.SHEETS.MAIN);
    
    // Column 7 (G) = ACTIVE_PHASE, Column 8 (H) = MANUAL_PHASE
    sheet.getRange(rowIndex, 7).setValue(activePhase); 
    sheet.getRange(rowIndex, 8).setValue(manualPhase); 
    sheet.getRange(rowIndex, 9).setValue(robotPhase);
    
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
      
      // Attempt to create the Smart Chip
      Sheets.Spreadsheets.batchUpdate({ requests: [request] }, CONFIG.SPREADSHEET_ID);
      
    } catch (apiError) {
      // FALLBACK: If the API throws the "No item with the given ID" error due to sync delays,

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

    // A EMAIL_ID, B CUSTOMER_NAME, C CUSTOMER_NUMBER, D ATTACHMENT_NAME,
    // E ITEM_NAME, F ITEM_COUNT, G ITEM_STATUS, H MATCH_TYPE
    const rowsToWrite = parsedItems.map(item => [
      emailId,
      item.FULL_NAME || item.CUSTOMER_NAME || "",
      item.CUSTOMER_NUMBER || "",
      attachmentName,
      item.ITEM_NAME,
      item.ITEM_COUNT,
      CONFIG.ITEM_STATUS.PENDING_BQ,
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
    
    mainSheet.insertRowAfter(1);
    
    // 11 Columns: Placeholders for client/file info, properly positioned phases and dates
    const rowData = [
      emailId, 
      "N/A", 
      "N/A", 
      "N/A", 
      "N/A", 
      "N/A", 
      activePhaseWithError, 
      exactManualPhase, 
      "", 
      "NO",
      new Date(), 
      new Date(),
      "",
      ""
    ];
    
    const targetRange = mainSheet.getRange(2, 1, 1, rowData.length);
    targetRange.setValues([rowData]);
    
    SpreadsheetApp.flush();
  }
};