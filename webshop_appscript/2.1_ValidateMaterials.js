function validateMaterials() {

  let ss, mainSheet, itemsSheet, mainData, itemsData;

  // 1: Opening the spreadsheets
  try {
    ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    mainSheet = ss.getSheetByName(CONFIG.SHEETS.MAIN);
    itemsSheet = ss.getSheetByName(CONFIG.SHEETS.ITEMS);
    
    mainData = mainSheet.getDataRange().getValues();
    itemsData = itemsSheet.getDataRange().getValues();
  } catch (error) {
    logger.log( "validate_materials ", error )
    return; 
  }

  ItemsSheetWriter.ensureColumns(itemsSheet);
  const itemIndexes = ItemsSheetWriter.headerIndexes(itemsSheet);
  const emailIdIdx = itemIndexes.EMAIL_ID;
  const itemNameIdx = itemIndexes.ITEM_NAME;

  if (emailIdIdx === undefined || itemNameIdx === undefined) {
    Logger.log("validate_materials: ITEMS sheet is missing EMAIL_ID or ITEM_NAME headers");
    return;
  }

  // Start from row 2 (index 1) to skip headers
  for (let i = 1; i < mainData.length; i++) {
    const rowIdx = i + 1;
    const emailId = mainData[i][0];
    const activePhase = mainData[i][6]; 
    
    if (activePhase === CONFIG.PHASES.PENDING_BQ) {
      
    
      //2: Processing the specific row
      try {
        const customerNumber = mainData[i][2]; // Column C
        const customerName = mainData[i][3];   // Column D
        
        let emailItems = [];
        let itemRowIndexes = [];
        
        // 3: Extracting items for emailid
        try {
          for (let j = 1; j < itemsData.length; j++) {
            if (itemsData[j][emailIdIdx] === emailId) {
              emailItems.push({ 
                ITEM_NAME: String(itemsData[j][itemNameIdx] || "").trim(),
                CUSTOMER_NUMBER: customerNumber,
                CUSTOMER_NAME: customerName
              }); 
              itemRowIndexes.push(j + 1);
            }
          }
        } catch (itemExtractError) {
          throw new Error("Item extraction failed."); 
        }

        if (emailItems.length > 0) {
          
          let validationResult;
          let hasItemError = false;

          // 4: BigQuery Validation execution
          try {
            validationResult = BigQueryValidator.flagInvalidItems(emailItems);
            hasItemError = validationResult.hasInvalid;
          } catch (bqError) {
           
            SheetHelper.updateStatus(rowIdx, `${CONFIG.PHASES.ERROR} - BQ Crash: ${bqError.message}`, CONFIG.MANUAL_STATES.ERROR);
            continue; // Move to the next email if BigQuery crashes
          }

          // 5: Updating the ITEMS sheet with validation statuses
          try {
            ItemsSheetWriter.ensureColumns(itemsSheet);

            emailItems.forEach((item, index) => {
              ItemsSheetWriter.writeValidation(itemsSheet, itemRowIndexes[index], item);
            });
            SpreadsheetApp.flush();

          } catch (itemsUpdateError) {

            Logger.log(`ITEMS update failed for email ${emailId}: ${itemsUpdateError.message}`);
            SheetHelper.updateStatus(rowIdx, `${CONFIG.PHASES.ERROR} - ITEMS write failed: ${itemsUpdateError.message}`, CONFIG.MANUAL_STATES.ERROR);
            continue;
          }

          // . 6: Updating the MAIN sheet based on results
          try {
            if (hasItemError) {

              const errorMsg = validationResult.clientError 
                ? `CLIENT_ERROR - ${validationResult.clientError}` 
                : `Invalid items found: ${validationResult.invalidItems.length} rejected by BigQuery`;
                
              SheetHelper.updateStatus(rowIdx, `${CONFIG.PHASES.ERROR} - ${errorMsg}`, CONFIG.MANUAL_STATES.ERROR);
              
            } else {
              SheetHelper.updateStatus(rowIdx, CONFIG.PHASES.VALID, CONFIG.MANUAL_STATES.PROCESSING, "READY");
            }
          } catch (mainUpdateError) {}

        } else {
          // Fallback if no items were found in the ITEMS sheet for this email
          SheetHelper.updateStatus(rowIdx, `${CONFIG.PHASES.ERROR} - No items found in DB`, CONFIG.MANUAL_STATES.ERROR);
        }

      } catch (rowError) {
        // Catches any unexpected crashes while processing this specific email ID
        SheetHelper.updateStatus(rowIdx, `${CONFIG.PHASES.ERROR} - Internal script error`, CONFIG.MANUAL_STATES.ERROR);
      }
    }
  }

}
