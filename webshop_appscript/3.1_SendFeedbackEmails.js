// MAIN column indexes (0-based) — must match sheet headers A–P:
// email_id, client_mail, client_number, client_name, attachment_name, attachments_path,
// active_phase, manual_phase, robot_phase, email_feedback, timestamp_email_receive,
// timestamp_processed_at, email_title, customer_email, internal_email, batch_name
const MAIN_COL = {
  EMAIL_ID: 0,
  CLIENT_MAIL: 1,
  CUSTOMER_NUMBER: 2,
  CUSTOMER_NAME: 3,
  ATTACHMENT_NAME: 4,
  ATTACHMENTS_PATH: 5,
  ACTIVE_PHASE: 6,
  MANUAL_PHASE: 7,
  ROBOT_PHASE: 8,
  EMAIL_FEEDBACK: 9,
  TIMESTAMP_EMAIL_RECEIVE: 10,
  TIMESTAMP_PROCESSED_AT: 11,
  EMAIL_TITLE: 12,
  CUSTOMER_EMAIL: 13,
  INTERNAL_EMAIL: 14,
  BATCH_NAME: 15
};



const EMAIL_FEEDBACK_COLUMN = 10;



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

  const name = String(row[MAIN_COL.CUSTOMER_NAME] || "").trim();

  return (name && name !== "N/A") ? name : "Customer";

}

function internalEmailFromRow(row) {
  const dedicated = EmailNotifier.normalizeEmailAddress(row[MAIN_COL.INTERNAL_EMAIL]);
  if (dedicated) return dedicated;
  return EmailNotifier.normalizeEmailAddress(row[MAIN_COL.CLIENT_MAIL]);
}

function isLikelyGmailMessageId(emailId) {
  const id = String(emailId || "").trim();
  return id.length >= 12 && /^[a-f0-9]+$/i.test(id);
}



function robotFailureReason(robotPhase) {

  const phase = String(robotPhase || "").trim();

  if (phase.indexOf("ERROR") !== 0) return null;

  return phase.split(" - ").slice(1).join(" - ") || "Unknown robot error";

}



function isRobotFinished(robotPhase) {

  const phase = String(robotPhase || "").trim();

  return phase === "FINISHED" || phase.indexOf("FINISHED") === 0;

}



function appsScriptErrorPhase(manualPhase, legacyActivePhase) {

  const manual = String(manualPhase || "").trim();

  if (manual.indexOf(CONFIG.PHASES.ERROR) === 0) return manual;

  const legacy = String(legacyActivePhase || "").trim();

  if (legacy.indexOf(CONFIG.PHASES.ERROR) === 0) return legacy;

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



    if (String(row[MAIN_COL.EMAIL_FEEDBACK]).trim() !== CONFIG.FEEDBACK_STATES.PENDING) continue;



    const manualPhase = String(row[MAIN_COL.MANUAL_PHASE] || "").trim();

    const robotPhase = String(row[MAIN_COL.ROBOT_PHASE] || "").trim();

    const legacyActivePhase = String(row[MAIN_COL.ACTIVE_PHASE] || "").trim();

    const errorPhase = appsScriptErrorPhase(manualPhase, legacyActivePhase);

    const robotFailure = robotFailureReason(robotPhase);

    const robotDone = isRobotFinished(robotPhase);



    if (!errorPhase && !robotFailure && !robotDone) continue;



    const emailId = String(row[MAIN_COL.EMAIL_ID] || "").trim();

    const customerEmail = EmailNotifier.normalizeEmailAddress(row[MAIN_COL.CUSTOMER_EMAIL]);

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

        customerNumber: String(row[MAIN_COL.CUSTOMER_NUMBER] || "").trim(),

        customerEmail: customerEmail,

        attachmentName: row[MAIN_COL.ATTACHMENT_NAME],

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
          savedCartName: String(row[MAIN_COL.BATCH_NAME] || "").trim()
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
            savedCartName: String(row[MAIN_COL.BATCH_NAME] || "").trim(),
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


