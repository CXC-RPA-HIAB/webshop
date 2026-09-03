function processHiabDeals() {
  GmailHelper.ensureLabelsExist();
  
  const labelNew = GmailApp.getUserLabelByName(CONFIG.LABELS.NEW);
  const labelProcessing = GmailApp.getUserLabelByName(CONFIG.LABELS.PROCESSING);
  const labelError = GmailApp.getUserLabelByName(CONFIG.LABELS.ERROR);
  const labelFinished = GmailApp.getUserLabelByName(CONFIG.LABELS.FINISHED);
  const labelNotified = GmailApp.getUserLabelByName(CONFIG.LABELS.NOTIFIED);

  // Helper function to enforce the STRICT ONE-LABEL rule
  function setSingleLabel(targetThread, labelToAdd) {
    const allLabels = [labelNew, labelProcessing, labelError, labelFinished, labelNotified];
    allLabels.forEach(lbl => {
      if (lbl && lbl.getName() !== labelToAdd.getName()) {
        // Do not remove NOTIFIED so threads can be WEBSHOP/ERROR + WEBSHOP/NOTIFIED
        if (lbl.getName() === CONFIG.LABELS.NOTIFIED) return; 
        targetThread.removeLabel(lbl);
      }
    });
    targetThread.addLabel(labelToAdd);
  }

  // Bypass Gmail search bug by getting threads directly from the label
  if (!labelNew) return;
  const rawThreads = labelNew.getThreads();
  if (rawThreads.length === 0) return;

  // FIX: Simply grab anything in the label that is unread, bypassing the target email restriction
  const threads = rawThreads.filter(thread => {
    return thread.isUnread();
  });

  if (threads.length === 0) {
    return;
  }

  threads.forEach(thread => {
    const messages = thread.getMessages();
    
    messages.forEach(message => {
      if (!message.isUnread()) return;
      
      const emailId = message.getId();
      const sender = message.getFrom();
      const pureEmailMatch = sender.match(/<([^>]+)>/);
      const pureEmail = pureEmailMatch ? pureEmailMatch[1] : sender;
      
      message.markRead();
      setSingleLabel(thread, labelProcessing);
      
      let rowIdx = null; 
      let threadHasFatalError = false;
      
      try {
        const attachments = message.getAttachments();
        if (attachments.length === 0) throw new Error("No attachments found.");

        const originalAttachment = attachments[0];
        const attName = originalAttachment.getName();
          
        let baseRecord = {
          EMAIL_ID: emailId,
          EMAIL: pureEmail,
          CLIENT_ID: " ", 
          CLIENT: " ",    
          ATTACHMENT_NAME: attName,
          ATTACHMENT_PATH: "",
          ACTIVE_PHASE: "",
          MANUAL_PHASE: "",
          ROBOT_PHASE: "", 
          EMAIL_FEEDBACK: "NO",
          TIMESTAMP_EMAIL_RECEIVE: message.getDate(),
          TIMESTAMP_PROCESSED_AT: new Date(),
          TITLE: message.getSubject().substring(0, 20),
          SECOND_NUMBER: ""
        };

        // get email
        rowIdx = SheetHelper.appendInitialRow(baseRecord);
        SheetHelper.updateStatus(rowIdx, CONFIG.PHASES.RECEIVED, CONFIG.MANUAL_STATES.PROCESSING);

        

        // save email
        SheetHelper.updateStatus(rowIdx, CONFIG.PHASES.STORAGE, CONFIG.MANUAL_STATES.PROCESSING);
        const savedFile = DriveHelper.saveAttachment(originalAttachment, emailId);
        
        Utilities.sleep(4000);

        SheetHelper.updateSmartChip(rowIdx, 6, savedFile.getUrl()); 
        
        // validate data
        SheetHelper.updateStatus(rowIdx, CONFIG.PHASES.VALIDATION_FILE, CONFIG.MANUAL_STATES.PROCESSING);
        let parsedData = [];
        
        try {
          parsedData = Parser.validateAndParse(originalAttachment);
          
          if (parsedData.length > 0) {
            SheetHelper.updateCell(rowIdx, 3, parsedData[0].CUSTOMER_NUMBER || "N/A"); 
            SheetHelper.updateCell(rowIdx, 4, parsedData[0].FULL_NAME || "N/A");
          }

          SheetHelper.writeToSheets(emailId, attName, parsedData);
          SheetHelper.updateStatus(rowIdx, CONFIG.PHASES.PENDING_BQ, CONFIG.MANUAL_STATES.PROCESSING);

        } catch (fatalErr) {
          SheetHelper.updateStatus(rowIdx, `${CONFIG.PHASES.ERROR} - ${fatalErr.message}`, CONFIG.MANUAL_STATES.ERROR);
          threadHasFatalError = true;
        }

        if (threadHasFatalError) {
          setSingleLabel(thread, labelError);
        } else {
          // Leave in PROCESSING label instead of VALID since it's waiting for BigQuery/Robot
          setSingleLabel(thread, labelProcessing); 
        }

      } catch (error) {
        setSingleLabel(thread, labelError);
        
        if (rowIdx) {
           SheetHelper.updateStatus(rowIdx, `${CONFIG.PHASES.ERROR} - ${error.message}`, CONFIG.MANUAL_STATES.ERROR);
        } else {
           SheetHelper.logErrorToMain(emailId, CONFIG.MANUAL_STATES.ERROR, `${CONFIG.PHASES.ERROR} - ${error.message}`);
        }
      }
    });
  });
}