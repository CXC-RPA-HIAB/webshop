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

/** Gmail thread when order_id is a message id; null for UUID / synthetic order_id. */
function tryGetGmailMessage(orderId) {
  const id = String(orderId || "").trim();
  if (!id) return null;
  try {
    return GmailApp.getMessageById(id);
  } catch (e) {
    return null;
  }
}

/** order_level column G — customer_email (1-based col 7). */
function customerEmailFromRow(row, sheet, rowIdx) {
  let raw = "";
  if (sheet && rowIdx > 0) {
    raw = sheet.getRange(rowIdx, ORDER_COL_1.CUSTOMER_EMAIL).getDisplayValue();
  } else if (row && row.length > ORDER_COL.CUSTOMER_EMAIL) {
    raw = row[ORDER_COL.CUSTOMER_EMAIL];
  }
  return EmailNotifier.normalizeEmailAddress(raw);
}

/** Reply in Gmail thread, or direct send when order_id is UUID (no message). */
function sendInternalFeedbackForOrder(message, row, orderId, info) {
  const payload = Object.assign({}, info);
  if (!message) {
    payload.deliveryTo = payload.deliveryTo || internalEmailFromRow(row) || CONFIG.TARGET_EMAIL;
    payload.internalName = payload.internalName || "there";
  }
  EmailNotifier.sendInternalFeedback(message, payload);
}

/** ERROR / robot failure — always direct to CONFIG.ERROR_FEEDBACK_TO. */
function sendErrorInternalFeedback(row, info) {
  const payload = Object.assign({}, info);
  payload.deliveryTo = CONFIG.ERROR_FEEDBACK_TO;
  payload.internalName = payload.internalName || "there";
  EmailNotifier.sendInternalFeedback(null, payload);
}

function sendDoneOrderFeedback(message, row, sheet, rowIdx, orderId, baseInfo, report) {
  const savedCartName = String(row[ORDER_COL.SAVED_CARD_NAME] || "").trim();
  sendInternalFeedbackForOrder(message, row, orderId, {
    internalName: baseInfo.internalName,
    customerName: baseInfo.customerName,
    customerNumber: baseInfo.customerNumber,
    customerEmail: baseInfo.customerEmail,
    attachmentName: baseInfo.attachmentName,
    variant: EmailNotifier.VARIANTS.CART_COMPLETED,
    errorMessage: "",
    report: report,
    savedCartName: savedCartName
  });

  const customerEmail = customerEmailFromRow(row, sheet, rowIdx);
  if (customerEmail) {
    try {
      EmailNotifier.sendCustomerFeedback({
        customerEmail: customerEmail,
        customerName: baseInfo.customerName,
        internalEmail: internalEmailFromRow(row),
        savedCartName: savedCartName,
        buckets: ItemsReport.customerBuckets(report),
        processedItems: report.processed
      });
    } catch (customerError) {
      Logger.log(`Row ${rowIdx}: customer feedback failed: ${customerError.message}`);
    }
  } else {
    Logger.log(`No valid customer_email in column G for row ${rowIdx}; customer notification skipped.`);
  }

  if (message) {
    try {
      applyFinalLabels(message.getThread(), GmailHelper.labelName("FINISHED"));
    } catch (labelError) {
      Logger.log(`Gmail labels (FINISHED) skipped for row ${rowIdx}: ${labelError.message}`);
    }
  }

  SheetHelper.updateCell(rowIdx, ORDER_COL_1.EMAIL_RESPONSE, CONFIG.FEEDBACK_STATES.SENT);
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

function processFeedbackEmails() {
  GmailHelper.ensureLabelsExist();

  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const mainSheet = SheetHelper.resolveOrderLevelSheet(ss);
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

    const orderId = String(row[ORDER_COL.ORDER_ID] || "").trim();
    if (!orderId) {
      Logger.log(`Row ${rowIdx}: missing order_id — feedback skipped.`);
      continue;
    }

    try {
      const message = tryGetGmailMessage(orderId);
      const customerEmail = customerEmailFromRow(row, mainSheet, rowIdx);
      const report = ItemsReport.build(ss, orderId);
      const baseInfo = {
        internalName: message ? internalSenderName(message) : "there",
        customerName: customerNameFromRow(row),
        customerNumber: String(row[ORDER_COL.CUSTOMER_NUMBER] || "").trim(),
        customerEmail: customerEmail,
        attachmentName: row[ORDER_COL.SAVED_CARD_NAME],
        report: report
      };

      if (errorPhase) {
        const errorInfo = describeError(errorPhase);
        sendErrorInternalFeedback(row, {
          customerName: baseInfo.customerName,
          customerNumber: baseInfo.customerNumber,
          customerEmail: baseInfo.customerEmail,
          attachmentName: baseInfo.attachmentName,
          variant: errorInfo.variant,
          errorMessage: errorInfo.message,
          report: report
        });
        if (message) {
          try {
            applyFinalLabels(message.getThread(), GmailHelper.labelName("ERROR"));
          } catch (labelError) {
            Logger.log(`Gmail labels (ERROR) skipped for row ${rowIdx}: ${labelError.message}`);
          }
        }
        SheetHelper.updateCell(rowIdx, ORDER_COL_1.EMAIL_RESPONSE, CONFIG.FEEDBACK_STATES.SENT);
        continue;
      }

      if (robotFailure) {
        sendErrorInternalFeedback(row, {
          customerName: baseInfo.customerName,
          customerNumber: baseInfo.customerNumber,
          customerEmail: baseInfo.customerEmail,
          attachmentName: baseInfo.attachmentName,
          variant: EmailNotifier.VARIANTS.UPLOAD_FAILED,
          errorMessage: robotFailure,
          report: report
        });
        if (message) {
          try {
            applyFinalLabels(message.getThread(), GmailHelper.labelName("ERROR"));
          } catch (labelError) {
            Logger.log(`Gmail labels (ERROR) skipped for row ${rowIdx}: ${labelError.message}`);
          }
        }
        SheetHelper.updateCell(rowIdx, ORDER_COL_1.EMAIL_RESPONSE, CONFIG.FEEDBACK_STATES.SENT);
        continue;
      }

      sendDoneOrderFeedback(message, row, mainSheet, rowIdx, orderId, baseInfo, report);
    } catch (error) {
      const detail = error && error.message ? error.message : String(error);
      const stack = error && error.stack ? error.stack : "";
      Logger.log(`Failed to send feedback for row ${rowIdx}: ${detail}${stack ? " | " + stack : ""}`);
    }
  }
}
