// order_level column indexes (0-based) — must match CONFIG.ORDER_HEADERS
const ORDER_COL = {
  ORDER_ID: 0,
  PHASE: 1,
  ACTIVE_PHASE: 2,
  EMAIL_RESPONSE: 3,
  CUSTOMER_NAME: 4,
  CUSTOMER_NUMBER: 5,
  CUSTOMER_EMAIL: 6,
  ORDER_CSV: 7,
  TIMESTAMP_ORDER_RECEIVE: 8,
  TIMESTAMP_BOT_DONE: 9,
  SAVED_CARD_NAME: 10,
  INTERNAL_EMAIL: 11
};

const EMAIL_FEEDBACK_COLUMN = 4;



function applyFinalLabels(thread, targetBaseLabelName) {
  const targetLabel = GmailHelper.getOrCreateLabel(targetBaseLabelName);
  const notifiedLabel = GmailHelper.getOrCreateLabel(GmailHelper.labelName("NOTIFIED"));
  if (!targetLabel || !notifiedLabel) {
    Logger.log("applyFinalLabels: could not resolve Gmail labels; thread labels skipped.");
    return;
  }

  const allBaseLabels = [
    GmailApp.getUserLabelByName(GmailHelper.labelName("NEW")),
    GmailApp.getUserLabelByName(GmailHelper.labelName("PROCESSING")),
    GmailApp.getUserLabelByName(GmailHelper.labelName("ERROR")),
    GmailApp.getUserLabelByName(GmailHelper.labelName("FINISHED"))
  ];

  allBaseLabels.forEach(lbl => {
    if (lbl && lbl.getName() !== targetLabel.getName() && lbl.getName() !== notifiedLabel.getName()) {
      thread.removeLabel(lbl);
    }
  });

  thread.addLabel(targetLabel);
  thread.addLabel(notifiedLabel);
  thread.markUnread();
}



function internalSenderName(message) {

  const from = String(message.getFrom() || "");

  const displayName = from.match(/^\s*"?([^"<]+?)"?\s*</);

  if (displayName && displayName[1].trim()) {

    return displayName[1].trim();

  }



  const address = from.match(/<([^>]+)>/);

  return String(address ? address[1] : from).split("@")[0] || "there";

}



function customerNameFromRow(row) {

  const name = String(row[ORDER_COL.CUSTOMER_NAME] || "").trim();

  return (name && name !== "N/A") ? name : "Customer";

}

function internalEmailFromRow(row) {
  return EmailNotifier.normalizeEmailAddress(row[ORDER_COL.INTERNAL_EMAIL]);
}

function isLikelyGmailMessageId(emailId) {
  const id = String(emailId || "").trim();
  return id.length >= 12 && /^[a-f0-9]+$/i.test(id);
}



function robotFailureReason(orderPhase, activePhase) {
  const phase = String(orderPhase || "").trim();
  if (phase !== CONFIG.ORDER_PHASE.ERROR) return null;
  const active = String(activePhase || "").trim();
  if (active.indexOf(CONFIG.PHASES.ERROR) === 0) {
    return active.split(" - ").slice(1).join(" - ") || "Unknown robot error";
  }
  return active || "Unknown robot error";
}

function isRobotFinished(orderPhase) {
  return String(orderPhase || "").trim() === CONFIG.ORDER_PHASE.DONE;
}



function appsScriptErrorPhase(orderPhase, activePhase) {
  const phase = String(orderPhase || "").trim();
  if (phase === CONFIG.ORDER_PHASE.ERROR) {
    const active = String(activePhase || "").trim();
    return active.indexOf(CONFIG.PHASES.ERROR) === 0 ? active : phase;
  }
  const active = String(activePhase || "").trim();
  if (active.indexOf(CONFIG.PHASES.ERROR) === 0) return active;
  return "";
}



function describeError(errorPhase) {

  const reason = errorPhase.split(" - ").slice(1).join(" - ") || "Unknown Error";



  if (reason.includes("Invalid items") || reason.includes("CLIENT_ERROR")) {

    return { variant: EmailNotifier.VARIANTS.REJECTED, message: reason };

  }

  if (reason.includes("Unsupported file format")) {

    return { variant: EmailNotifier.VARIANTS.FATAL, message: "invalid type of file (only xlsx, csv)" };

  }



  return { variant: EmailNotifier.VARIANTS.FATAL, message: reason };

}



// Single pass after the robot finishes (or Apps Script parse failure before the bot runs).

function processFeedbackEmails() {

  GmailHelper.ensureLabelsExist();

  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

  const mainSheet = ss.getSheetByName(CONFIG.SHEETS.MAIN);

  const data = mainSheet.getDataRange().getValues();



  for (let i = 1; i < data.length; i++) {

    const rowIdx = i + 1;

    const row = data[i];



    if (String(row[ORDER_COL.EMAIL_RESPONSE]).trim() !== CONFIG.FEEDBACK_STATES.PENDING) continue;

    const phase = String(row[ORDER_COL.PHASE] || "").trim();
    const activePhase = String(row[ORDER_COL.ACTIVE_PHASE] || "").trim();

    const errorPhase = appsScriptErrorPhase(phase, activePhase);
    const robotFailure = robotFailureReason(phase, activePhase);
    const robotDone = isRobotFinished(phase);



    if (!errorPhase && !robotFailure && !robotDone) continue;



    const emailId = String(row[ORDER_COL.ORDER_ID] || "").trim();

    const customerEmail = EmailNotifier.normalizeEmailAddress(row[ORDER_COL.CUSTOMER_EMAIL]);

    if (!isLikelyGmailMessageId(emailId)) {
      Logger.log(`Row ${rowIdx}: invalid or missing email_id "${emailId}" — feedback skipped.`);
      continue;
    }

    try {

      let message;
      try {
        message = GmailApp.getMessageById(emailId);
      } catch (idError) {
        Logger.log(`Row ${rowIdx}: getMessageById failed: ${idError.message}`);
        continue;
      }

      if (!message) continue;



      const report = ItemsReport.build(ss, emailId);

      const baseInfo = {

        internalName: internalSenderName(message),

        customerName: customerNameFromRow(row),

        customerNumber: String(row[ORDER_COL.CUSTOMER_NUMBER] || "").trim(),

        customerEmail: customerEmail,

        attachmentName: row[ORDER_COL.SAVED_CARD_NAME],

        report: report

      };



      if (errorPhase) {

        const errorInfo = describeError(errorPhase);

        EmailNotifier.sendInternalFeedback(message, {

          internalName: baseInfo.internalName,

          customerName: baseInfo.customerName,

          customerNumber: baseInfo.customerNumber,

          customerEmail: baseInfo.customerEmail,

          attachmentName: baseInfo.attachmentName,

          variant: errorInfo.variant,

          errorMessage: errorInfo.message,

          report: report

        });

        try {
          applyFinalLabels(message.getThread(), GmailHelper.labelName("ERROR"));
        } catch (labelError) {
          Logger.log(`Gmail labels (ERROR) skipped for row ${rowIdx}: ${labelError.message}`);
        }

        SheetHelper.updateCell(rowIdx, EMAIL_FEEDBACK_COLUMN, CONFIG.FEEDBACK_STATES.INTERNAL_SENT);

        continue;

      }



      if (robotFailure) {

        EmailNotifier.sendInternalFeedback(message, {

          internalName: baseInfo.internalName,

          customerName: baseInfo.customerName,

          customerNumber: baseInfo.customerNumber,

          customerEmail: baseInfo.customerEmail,

          attachmentName: baseInfo.attachmentName,

          variant: EmailNotifier.VARIANTS.UPLOAD_FAILED,

          errorMessage: robotFailure,

          report: report

        });

        try {
          applyFinalLabels(message.getThread(), GmailHelper.labelName("ERROR"));
        } catch (labelError) {
          Logger.log(`Gmail labels (ERROR) skipped for row ${rowIdx}: ${labelError.message}`);
        }

        SheetHelper.updateCell(rowIdx, EMAIL_FEEDBACK_COLUMN, CONFIG.FEEDBACK_STATES.INTERNAL_ONLY_UPLOAD_FAILED);

        continue;

      }



      try {
        EmailNotifier.sendInternalFeedback(message, {
          internalName: baseInfo.internalName,
          customerName: baseInfo.customerName,
          customerNumber: baseInfo.customerNumber,
          customerEmail: baseInfo.customerEmail,
          attachmentName: baseInfo.attachmentName,
          variant: EmailNotifier.VARIANTS.CART_COMPLETED,
          errorMessage: "",
          report: report,
          savedCartName: String(row[ORDER_COL.SAVED_CARD_NAME] || "").trim()
        });
      } catch (internalError) {
        Logger.log(`Row ${rowIdx}: internal feedback failed: ${internalError.message}`);
        throw internalError;
      }

      let feedbackState = CONFIG.FEEDBACK_STATES.INTERNAL_ONLY;

      if (customerEmail) {
        try {
          EmailNotifier.sendCustomerFeedback({
            customerEmail: customerEmail,
            customerName: baseInfo.customerName,
            internalEmail: internalEmailFromRow(row),
            savedCartName: String(row[ORDER_COL.SAVED_CARD_NAME] || "").trim(),
            buckets: ItemsReport.customerBuckets(report),
            processedItems: report.processed
          });
          feedbackState = CONFIG.FEEDBACK_STATES.INTERNAL_AND_EXTERNAL_SENT;
        } catch (customerError) {
          Logger.log(`Row ${rowIdx}: customer feedback failed: ${customerError.message}`);
          feedbackState = CONFIG.FEEDBACK_STATES.INTERNAL_ONLY;
        }
      } else {
        Logger.log(`No valid customer_email in column N for row ${rowIdx}; customer notification skipped.`);
      }



      try {
        applyFinalLabels(message.getThread(), GmailHelper.labelName("FINISHED"));
      } catch (labelError) {
        Logger.log(`Gmail labels (FINISHED) skipped for row ${rowIdx}: ${labelError.message}`);
      }

      SheetHelper.updateCell(rowIdx, EMAIL_FEEDBACK_COLUMN, feedbackState);



    } catch (error) {
      const detail = error && error.message ? error.message : String(error);
      const stack = error && error.stack ? error.stack : "";
      Logger.log(`Failed to send feedback for row ${rowIdx}: ${detail}${stack ? " | " + stack : ""}`);
    }

  }

}


