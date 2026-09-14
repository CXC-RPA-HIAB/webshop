function processFeedbackEmails() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const mainSheet = ss.getSheetByName(CONFIG.SHEETS.MAIN);
  const data = mainSheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    const rowIdx = i + 1;
    
    const emailId = data[i][0]; 
    const clientEmail = String(data[i][1]).trim(); 
    const customerName = data[i][3] !== "N/A" ? String(data[i][3]).trim() : "Customer"; 
    const attachmentName = data[i][4]; 
    const activePhase = String(data[i][6]).trim();
    
    const manualPhase = String(data[i][7]).trim(); 
    const robotPhase = String(data[i][8]).trim();  
    const emailFeedback = String(data[i][9]).trim(); 
    
    if (emailFeedback === "NO" && (robotPhase === "FINISHED" || manualPhase === "ERROR")) {
      
      try {
        const message = GmailApp.getMessageById(emailId);
        if (!message) continue;
        
        const thread = message.getThread(); 

        let results = [];
        let generalError = null;
        let targetBaseLabelName = ""; 
        // ERROR handler
        if (manualPhase === "ERROR") {
          targetBaseLabelName = CONFIG.LABELS.ERROR; 
          
        
          const errorMessage = activePhase.split(" - ").slice(1).join(" - ") || "Unknown Error";
          
          if (errorMessage.includes("Invalid items") || errorMessage.includes("CLIENT_ERROR")) {
            let actualInvalidItems = [];

            // Jeśli to błąd klienta, przekazujemy go do maila
            if (errorMessage.includes("CLIENT_ERROR")) {
              actualInvalidItems.push(errorMessage);
            }

            const itemsSheet = ss.getSheetByName(CONFIG.SHEETS.ITEMS);
            if (itemsSheet) {
              ItemsSheetWriter.ensureColumns(itemsSheet);
              const indexes = ItemsSheetWriter.headerIndexes(itemsSheet);
              const itemsData = itemsSheet.getDataRange().getValues();
              const emailIdIdx = indexes.EMAIL_ID;
              const itemNameIdx = indexes.ITEM_NAME;
              const itemStatusIdx = indexes.ITEM_STATUS;
              const matchTypeIdx = indexes.MATCH_TYPE;

              for (let j = 1; j < itemsData.length; j++) {
                if (itemsData[j][emailIdIdx] !== emailId) continue;

                const status = String(itemsData[j][itemStatusIdx] || "").trim();
                const matchType = String(itemsData[j][matchTypeIdx] || "").trim();
                const itemName = String(itemsData[j][itemNameIdx] || "").trim();

                const gateOk = status === CONFIG.ITEM_STATUS.VALID ||
                  (status.indexOf(CONFIG.ITEM_STATUS.REPLACED + " (") === 0 && status.indexOf(" / ") === -1);
                const matchOk = matchType === CONFIG.MATCH_TYPE.STANDARD ||
                  matchType.indexOf(CONFIG.MATCH_TYPE.GBO + " (") === 0;

                if (!gateOk || !matchOk || matchType.indexOf(CONFIG.MATCH_TYPE.FAILED) === 0) {
                  actualInvalidItems.push({ item: itemName, status: status, matchType: matchType });
                }
              }
            }
            
            results.push({ name: attachmentName, status: 'ITEM_ERROR', invalidItems: actualInvalidItems });
            
          } else if (errorMessage.includes("Unsupported file format") || errorMessage.includes("missing") || errorMessage.includes("incorrect")) {
             results.push({ name: attachmentName, status: 'FATAL', error: errorMessage });
          } else {
             generalError = errorMessage;
          }
        }
        else if (robotPhase === "FINISHED") {
          targetBaseLabelName = CONFIG.LABELS.FINISHED; 
          results.push({ name: attachmentName, status: 'SUCCESS' });
        }

        EmailNotifier.sendFeedback(message, clientEmail, customerName, results, generalError);


        function getOrCreateLabel(labelName) {
          let label = GmailApp.getUserLabelByName(labelName);
          if (!label) {
            label = GmailApp.createLabel(labelName);
            Logger.log(`Created missing label: ${labelName}`);
          }
          return label;
        }

        const targetLabel = getOrCreateLabel(targetBaseLabelName);
        const notifiedLabel = getOrCreateLabel(CONFIG.LABELS.NOTIFIED);
        
        const allBaseLabels = [
          GmailApp.getUserLabelByName(CONFIG.LABELS.NEW),
          GmailApp.getUserLabelByName(CONFIG.LABELS.PROCESSING),
          GmailApp.getUserLabelByName(CONFIG.LABELS.ERROR),
          GmailApp.getUserLabelByName(CONFIG.LABELS.FINISHED)
        ];

        // 1. Remove any old base labels
        allBaseLabels.forEach(lbl => {
          if (lbl && lbl.getName() !== targetLabel.getName() && lbl.getName() !== notifiedLabel.getName()) {
            thread.removeLabel(lbl);
          }
        });

        // 2. Add the correct final base label (ERROR or FINISHED)
        thread.addLabel(targetLabel);
        
        // 3. Ensure NOTIFIED label is firmly attached to the thread
        thread.addLabel(notifiedLabel);
        
        // 4. Mark the entire thread as unread so it stands out
        thread.markUnread();
        // ==========================================

        SheetHelper.updateCell(rowIdx, 10, "NOTIFIED"); 
        
      } catch (error) {
        Logger.log(`Failed to send feedback for row ${rowIdx}: ${error.message}`);
      }
    }
  }
}
