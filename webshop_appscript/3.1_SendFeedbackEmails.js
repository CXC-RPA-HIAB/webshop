// MAIN column indexes (0-based) used by both feedback stages.
const MAIN_COL = {
  EMAIL_ID: 0,
  CLIENT_MAIL: 1,
  CUSTOMER_NUMBER: 2,
  CUSTOMER_NAME: 3,
  ATTACHMENT_NAME: 4,
  ACTIVE_PHASE: 6,
  MANUAL_PHASE: 7,
  ROBOT_PHASE: 8,
  EMAIL_FEEDBACK: 9,
  CUSTOMER_EMAIL: 13
};

const EMAIL_FEEDBACK_COLUMN = 10;

function getOrCreateLabel(labelName) {
  let label = GmailApp.getUserLabelByName(labelName);
  if (!label) {
    label = GmailApp.createLabel(labelName);
    Logger.log(`Created missing label: ${labelName}`);
  }
  return label;
}

// Enforces one base label (ERROR / FINISHED) plus NOTIFIED and makes the thread stand out.
function applyFinalLabels(thread, targetBaseLabelName) {
  const targetLabel = getOrCreateLabel(targetBaseLabelName);
  const notifiedLabel = getOrCreateLabel(CONFIG.LABELS.NOTIFIED);

  const allBaseLabels = [
    GmailApp.getUserLabelByName(CONFIG.LABELS.NEW),
    GmailApp.getUserLabelByName(CONFIG.LABELS.PROCESSING),
    GmailApp.getUserLabelByName(CONFIG.LABELS.ERROR),
    GmailApp.getUserLabelByName(CONFIG.LABELS.FINISHED)
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

// The person who submitted the file is the sender of the original email.
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

// The robot writes ROBOT_PHASE as "FINISHED" or "ERROR - <reason>".
const ROBOT_FINISHED = "FINISHED";

function robotFailureReason(robotPhase) {
  if (robotPhase.indexOf("ERROR") !== 0) return null;
  return robotPhase.split(" - ").slice(1).join(" - ") || "Unknown robot error";
}

// -1_ERROR rows carry the reason after the phase name: "-1_ERROR - <reason>".
function describeError(activePhase) {
  const reason = activePhase.split(" - ").slice(1).join(" - ") || "Unknown Error";

  if (reason.includes("Invalid items") || reason.includes("CLIENT_ERROR")) {
    return { variant: EmailNotifier.VARIANTS.REJECTED, message: reason };
  }
  if (reason.includes("Unsupported file format")) {
    return { variant: EmailNotifier.VARIANTS.FATAL, message: "invalid type of file (only xlsx, csv)" };
  }

  return { variant: EmailNotifier.VARIANTS.FATAL, message: reason };
}

// Stage 1: technical overview for the operator, sent as soon as the file reaches
// 5_VALID or -1_ERROR. EMAIL_FEEDBACK moves NO -> INTERNAL_SENT (or NOTIFIED on error).
function sendInternalFeedbackEmails() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const mainSheet = ss.getSheetByName(CONFIG.SHEETS.MAIN);
  const data = mainSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const rowIdx = i + 1;
    const row = data[i];

    if (String(row[MAIN_COL.EMAIL_FEEDBACK]).trim() !== CONFIG.FEEDBACK_STATES.PENDING) continue;

    const activePhase = String(row[MAIN_COL.ACTIVE_PHASE]).trim();
    const isValid = activePhase === CONFIG.PHASES.VALID;
    const isError = activePhase.indexOf(CONFIG.PHASES.ERROR) === 0;

    if (!isValid && !isError) continue;

    const emailId = row[MAIN_COL.EMAIL_ID];
    // The robot can already have failed before this trigger ran.
    const robotFailure = isValid ? robotFailureReason(String(row[MAIN_COL.ROBOT_PHASE]).trim()) : null;

    let variant = EmailNotifier.VARIANTS.VALID;
    let errorMessage = "";

    if (isError) {
      const errorInfo = describeError(activePhase);
      variant = errorInfo.variant;
      errorMessage = errorInfo.message;
    } else if (robotFailure) {
      variant = EmailNotifier.VARIANTS.UPLOAD_FAILED;
      errorMessage = robotFailure;
    }

    try {
      const message = GmailApp.getMessageById(emailId);
      if (!message) continue;

      EmailNotifier.sendInternalFeedback(message, {
        internalName: internalSenderName(message),
        customerName: customerNameFromRow(row),
        customerNumber: String(row[MAIN_COL.CUSTOMER_NUMBER] || "").trim(),
        customerEmail: String(row[MAIN_COL.CUSTOMER_EMAIL] || "").trim(),
        attachmentName: row[MAIN_COL.ATTACHMENT_NAME],
        variant: variant,
        errorMessage: errorMessage,
        report: ItemsReport.build(ss, emailId)
      });

      if (variant === EmailNotifier.VARIANTS.VALID) {
        // Thread stays in WEBSHOP/PROCESSING until the robot finishes the upload.
        SheetHelper.updateCell(rowIdx, EMAIL_FEEDBACK_COLUMN, CONFIG.FEEDBACK_STATES.INTERNAL_SENT);
      } else {
        applyFinalLabels(message.getThread(), CONFIG.LABELS.ERROR);
        SheetHelper.updateCell(rowIdx, EMAIL_FEEDBACK_COLUMN, CONFIG.FEEDBACK_STATES.DONE);
      }

    } catch (error) {
      Logger.log(`Failed to send internal feedback for row ${rowIdx}: ${error.message}`);
    }
  }
}

// Stage 2: plain-language confirmation for the customer once the robot reports FINISHED.
// EMAIL_FEEDBACK moves INTERNAL_SENT -> NOTIFIED.
function sendCustomerFeedbackEmails() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const mainSheet = ss.getSheetByName(CONFIG.SHEETS.MAIN);
  const data = mainSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const rowIdx = i + 1;
    const row = data[i];

    if (String(row[MAIN_COL.EMAIL_FEEDBACK]).trim() !== CONFIG.FEEDBACK_STATES.INTERNAL_SENT) continue;

    const robotPhase = String(row[MAIN_COL.ROBOT_PHASE]).trim();
    const robotFailure = robotFailureReason(robotPhase);
    if (robotPhase !== ROBOT_FINISHED && !robotFailure) continue;

    const emailId = row[MAIN_COL.EMAIL_ID];
    const customerEmail = String(row[MAIN_COL.CUSTOMER_EMAIL] || "").trim();

    try {
      const message = GmailApp.getMessageById(emailId);
      if (!message) continue;

      // The robot failed after validation: tell the operator, never the customer.
      if (robotFailure) {
        EmailNotifier.sendInternalFeedback(message, {
          internalName: internalSenderName(message),
          customerName: customerNameFromRow(row),
          customerNumber: String(row[MAIN_COL.CUSTOMER_NUMBER] || "").trim(),
          customerEmail: customerEmail,
          attachmentName: row[MAIN_COL.ATTACHMENT_NAME],
          variant: EmailNotifier.VARIANTS.UPLOAD_FAILED,
          errorMessage: robotFailure,
          report: ItemsReport.build(ss, emailId)
        });

        applyFinalLabels(message.getThread(), CONFIG.LABELS.ERROR);
        SheetHelper.updateCell(rowIdx, EMAIL_FEEDBACK_COLUMN, CONFIG.FEEDBACK_STATES.DONE);
        continue;
      }

      if (customerEmail) {
        const report = ItemsReport.build(ss, emailId);

        EmailNotifier.sendCustomerFeedback({
          customerEmail: customerEmail,
          customerName: customerNameFromRow(row),
          attachmentName: row[MAIN_COL.ATTACHMENT_NAME],
          internalEmail: String(row[MAIN_COL.CLIENT_MAIL] || "").trim(),
          buckets: ItemsReport.customerBuckets(report)
        });
      } else {
        Logger.log(`No customer_email in column N for row ${rowIdx}; customer notification skipped.`);
      }

      applyFinalLabels(message.getThread(), CONFIG.LABELS.FINISHED);
      SheetHelper.updateCell(rowIdx, EMAIL_FEEDBACK_COLUMN, CONFIG.FEEDBACK_STATES.DONE);

    } catch (error) {
      Logger.log(`Failed to send customer feedback for row ${rowIdx}: ${error.message}`);
    }
  }
}

function processFeedbackEmails() {
  sendInternalFeedbackEmails();
  sendCustomerFeedbackEmails();
}
