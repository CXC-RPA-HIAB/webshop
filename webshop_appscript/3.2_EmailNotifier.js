const EmailNotifier = {

  LOGO_FOLDER_ID: "1Ry0zPOQdTPAu10jXfK9MBWoqkr1kw7KM",
  LOGO_FILE_NAME: "hiab-text-logo.png",
  SENDER_NAME: "Hiab Deals Automation",

  VARIANTS: {
    VALID: "VALID",
    FATAL: "FATAL",
    REJECTED: "REJECTED",
    UPLOAD_FAILED: "UPLOAD_FAILED"
  },

  signature: function(inlineImages) {
    let html = `<p>Best regards,`;

    try {
      const folder = DriveApp.getFolderById(this.LOGO_FOLDER_ID);
      const files = folder.getFilesByName(this.LOGO_FILE_NAME);
      inlineImages['hiabLogo'] = files.next().getBlob();
      html += `<br><img src="cid:hiabLogo" alt="Hiab Logo" style="height: 40px; width: auto;">`;
    } catch (e) {

    }

    return html + `</p>`;
  },

  footer: function(note) {
    return `
      <hr style="margin-top: 20px; border: none; border-top: 1px solid #dddddd;">
      <div style="color: #777777; font-size: 12px; margin-top: 10px;">
        This is an automatic notification from the HIAB deals system.<br>
        ${note}
      </div>
    `;
  },

  // Entries are either plain item codes or ItemsReport entries carrying a label.
  renderList: function(entries, limit) {
    const max = limit || CONFIG.CUSTOMER_LIST_LIMIT;
    const names = (entries || []).map(entry =>
      typeof entry === "string" ? entry : (entry.label || entry.item || "")
    );
    const more = names.length > max ? ` (and ${names.length - max} more)` : '';

    return `${names.slice(0, max).join(', ')}${more}`;
  },

  replacementTable: function(replacedItems) {
    const rows = replacedItems.map(entry => `
      <tr>
        <td style="padding: 4px 10px; border: 1px solid #dddddd;">${entry.originalItem}</td>
        <td style="padding: 4px 10px; border: 1px solid #dddddd;">${entry.currentItem}</td>
        <td style="padding: 4px 10px; border: 1px solid #dddddd;">${entry.chain}</td>
        <td style="padding: 4px 10px; border: 1px solid #dddddd; color: #E06666;">${entry.warning || ""}</td>
      </tr>`).join('');

    return `
      <table style="border-collapse: collapse; font-size: 13px;">
        <tr>
          <th style="padding: 4px 10px; border: 1px solid #dddddd;">Ordered item</th>
          <th style="padding: 4px 10px; border: 1px solid #dddddd;">Processed item</th>
          <th style="padding: 4px 10px; border: 1px solid #dddddd;">Replacement</th>
          <th style="padding: 4px 10px; border: 1px solid #dddddd;">Warning</th>
        </tr>
        ${rows}
      </table>
    `;
  },

  clientCheckMessages: function(clientError) {
    const messages = [];
    if (!clientError) return messages;

    if (clientError.missingId) {
      messages.push(`Customer ID is missing from the file. (${CONFIG.CLIENT_ERRORS.MISSING_ID})`);
    }
    if (clientError.notFound) {
      messages.push(`Customer ID was not found in Salesforce. (${CONFIG.CLIENT_ERRORS.NOT_FOUND})`);
    }
    if (clientError.wrongName) {
      messages.push(`${clientError.wrongName} (${CONFIG.CLIENT_ERRORS.WRONG_NAME})`);
    }
    if (clientError.noEmail) {
      messages.push(`No e-mail address found for this customer contact. (${CONFIG.CLIENT_ERRORS.NO_EMAIL})`);
    }
    if (clientError.other) {
      messages.push(clientError.other);
    }

    return messages;
  },

  rejectedSections: function(report) {
    const sections = [
      { label: "Not found in BigQuery", entries: report.notInBq },
      { label: "Blocked for sale", entries: report.blocked },
      { label: "No global price", entries: report.noGlobalPrice },
      { label: "Obsolete", entries: report.obsolete },
      { label: "Failed market / GPO match", entries: report.failedMatch },
      { label: "Needs webshop support", entries: report.anotherProblem },
      { label: "Not validated yet", entries: report.pending },
      { label: "Other problem", entries: report.other }
    ];

    return sections
      .filter(section => section.entries && section.entries.length > 0)
      .map(section => `<li>${section.label}: <b>${this.renderList(section.entries, 100)}</b></li>`)
      .join('');
  },

  // Technical overview for the operator who submitted the file. Sent as a reply in the
  // original Gmail thread right after the 5_VALID / -1_ERROR phase is set.
  sendInternalFeedback: function(message, info) {
    const report = info.report;
    const inlineImages = {};
    const customerLine = info.customerNumber ? `${info.customerName} / ${info.customerNumber}` : info.customerName;

    let body = `<p>Hello ${info.internalName},</p>`;
    body += `<p>Submission overview for file <b>${info.attachmentName}</b> (Customer: <b>${customerLine}</b>).</p>`;

    if (info.variant === this.VARIANTS.FATAL) {
      body += `<p><b>STATUS:</b> <span style="color: red;">FATAL ERROR - nothing will be uploaded</span></p>`;
      body += `<p><b>Reason:</b> <span style="color: red;">${info.errorMessage}</span></p>`;
      body += `<p>Required file layout: column A - item number, column B - order amount, column C - customer id, column D - customer name. Row 1 is reserved for headers.</p>`;
      body += `<p>Please correct the file and resubmit it to ${CONFIG.TARGET_EMAIL}.</p>`;
    }
    else if (info.variant === this.VARIANTS.REJECTED) {
      body += `<p><b>status:</b> <span style="color: #D52B1E;">validation failed, items will not be uploaded</span></p>`;

      const clientMessages = this.clientCheckMessages(report.clientError);
      if (clientMessages.length > 0) {
        body += `<p><b>Client check:</b></p><ul style="color:#480011;">`;
        clientMessages.forEach(text => { body += `<li>${text}</li>`; });
        body += `</ul>`;
      }

      body += `<p>Items validated: <b>${report.total}</b> &nbsp;|&nbsp; Passed: <b>${report.ready.length}</b> &nbsp;|&nbsp; Rejected: <b>${report.rejectedCount}</b></p>`;

      const rejected = this.rejectedSections(report);
      if (rejected) {
        body += `<p><b>These items will not be uploaded (action required):</b></p>`;
        body += `<ul style="color: #E06666;">${rejected}</ul>`;
      }

      if (report.replaced.length > 0) {
        body += `<p><b>Replaced items (successor resolved, would be uploaded):</b></p>`;
        body += this.replacementTable(report.replaced);
      }

      body += `<p>The whole file was rejected - nothing was uploaded to the webshop.<br>Please review the rejected items, correct the file and resubmit it.</p>`;
    }
    else if (info.variant === this.VARIANTS.UPLOAD_FAILED) {
      body += `<p><b>STATUS:</b> <span style="color: red;">UPLOAD FAILED - the robot could not finish the webshop upload</span></p>`;
      body += `<p><b>Reason:</b> <span style="color: red;">${info.errorMessage}</span></p>`;
      body += `<p>The file passed validation (${report.ready.length} of ${report.total} items were ready for upload), but the cart was not completed. The customer has NOT been notified.</p>`;
      body += `<p>Please check the webshop session and retry the upload.</p>`;
    }
    else {
      body += `<p><b>STATUS:</b> <span style="color: green;">PENDING UPLOAD</span></p>`;
      body += `<p>Items ready for upload: <b>${report.ready.length}</b> of <b>${report.total}</b></p>`;

      if (report.replaced.length > 0) {
        body += `<p><b>Replaced items (successors will be uploaded):</b></p>`;
        body += this.replacementTable(report.replaced);
      }

      body += `<p>Customer notification will be sent to: <b>${info.customerEmail || "no address found"}</b></p>`;
      body += `<p>No action required. The robot will upload this file to the webshop.</p>`;
    }

    body += this.signature(inlineImages);
    body += this.footer("Please do not reply for this email.");

    message.reply("", {
      htmlBody: body,
      name: this.SENDER_NAME,
      inlineImages: inlineImages
    });
  },

  // Plain-language confirmation for the external customer. Sent as a standalone email
  // after the FINISHED phase so the internal thread stays internal.
  sendCustomerFeedback: function(info) {
    const buckets = info.buckets;
    const inlineImages = {};
    const hasIssues = buckets.unavailable.length > 0 ||
      buckets.obsolete.length > 0 ||
      buckets.replaced.length > 0;

    let body = `<p>Dear ${info.customerName},</p>`;
    body += `<p><span style="color: green;">Your order (<b>${info.attachmentName}</b>) has been completed.</span></p>`;

    if (hasIssues) {
      body += `<p style="color: #D52B1E;"><b>Notice:</b> Your order has been completed, but the following items are:</p><ul>`;

      if (buckets.unavailable.length > 0) {
        body += `<li>Unavailable: <b>${this.renderList(buckets.unavailable)}</b></li>`;
      }
      if (buckets.obsolete.length > 0) {
        body += `<li>Obsolete: <b>${this.renderList(buckets.obsolete)}</b></li>`;
      }
      if (buckets.replaced.length > 0) {
        const pairs = buckets.replaced
          .slice(0, CONFIG.CUSTOMER_LIST_LIMIT)
          .map(entry => `${entry.originalItem} &rarr; ${entry.currentItem}`)
          .join('<br>');
        const more = buckets.replaced.length > CONFIG.CUSTOMER_LIST_LIMIT
          ? `<br>(and ${buckets.replaced.length - CONFIG.CUSTOMER_LIST_LIMIT} more)`
          : '';

        body += `<li>Replaced (we will send the succeeding items):<br><b>${pairs}${more}</b></li>`;
      }

      body += `</ul>`;
      body += `<p>If you have any questions regarding these items, please contact your customer support representative.</p>`;
    }

    body += this.signature(inlineImages);
    body += this.footer("Please contact your customer support representative if you have any questions.");

    GmailApp.sendEmail(info.customerEmail, "Your HIAB order has been completed", "", {
      htmlBody: body,
      name: this.SENDER_NAME,
      replyTo: info.internalEmail || CONFIG.TARGET_EMAIL,
      inlineImages: inlineImages
    });
  }
};
