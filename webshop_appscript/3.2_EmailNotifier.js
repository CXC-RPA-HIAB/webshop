const EmailNotifier = {

  sendFeedback: function(message, clientEmail, cscName, results, generalError = null) {
    let body = `<p>Hello ${cscName},</p>`;

    // If generalError has text in it, it will print it. Otherwise it moves to the success logic.
    if (generalError) {
      body += `<p>There was a problem processing your request:</p>`;
      
      // We convert it to a string just in case to prevent [object Object] crashes
      const errorString = String(generalError); 
      
      if (errorString.includes("Unsupported file format")) {
        body += `<p style="color: red;"><b>invalid type of file (only xlsx,csv)</b></p>`;
      } else {
        body += `<p style="color: red;"><b>${errorString}</b></p>`;
      }
    } else {
      body += `<p>Here are the processing results for your submitted files:</p><ul>`;
      
      let allSuccess = true;

      results.forEach(res => {
        body += `<li><b>${res.name}</b>:<br>`;
        
        if (res.status === 'SUCCESS' || res.status === 'FINISHED') {
          body += `<span style="color: green;">your order has been completed</span>`;
          if (res.unavailableItems && res.unavailableItems.length > 0) {
            const preview = res.unavailableItems.slice(0, 10).join(', ');
            const moreCount = res.unavailableItems.length > 10 ? ` (and ${res.unavailableItems.length - 10} more)` : '';
            
            body += `<br><span style="color: #E06666;"><b>Notice:</b> Your order has been completed, but the following items are unavailable: <b>${preview}${moreCount}</b></span>`;
          }
        } 
        else if (res.status === 'FATAL') {
          allSuccess = false;
          if (res.error && res.error.includes("Unsupported file format")) {
            body += `<span style="color: red;">invalid type of file (only xlsx,csv)</span>`;
          } else {
            body += `<span style="color: red;">incorrect data saved : In your file: in column A, row 2 write the item number. In column B, row 2 write the order amount. Row 1 is reserved for headers. Column C - customer id, column D - customer name</span>`;
          }
        } 
        else if (res.status === 'ITEM_ERROR') {
          allSuccess = false;
          let itemErrors = [];
          

          let clientNotFound = false;
          let clientIdNotFound = false;
          let nameMismatchError = null;

          res.invalidItems.forEach(item => {
            if (item.includes("CLIENT_ERROR - MISSING_ID")) {
              clientIdNotFound = true;
            } else if (item.includes("CLIENT_ERROR - WRONG_NAME")) {
              nameMismatchError = item.split("WRONG_NAME: ")[1];
            } else if (item.includes("CLIENT_ERROR - CLIENT_NOT_FOUND")) {
              clientNotFound = true;
            } else {
              itemErrors.push(item);
            }
          });

          let errorMessages = [];
          if (clientNotFound) { errorMessages.push("Client ID was not found."); }
          if (clientIdNotFound) { errorMessages.push("Client ID is missing from the file."); }
          if (nameMismatchError) { errorMessages.push(`<span style="color: orange;">Client Name mismatch. ${nameMismatchError}</span>`); }
          
          if (itemErrors.length > 0) {
            errorMessages.push(`The following items were not found: <br><b>${itemErrors.join(', ')}</b>`);
          }

          body += `<span style="color: #E06666;">${errorMessages.join('<br>')}</span>`;
        }
        
        body += `</li><br>`;
      });
      
      body += `</ul>`;

      if (!allSuccess) {
        body += `<p>Please correct the highlighted errors and resubmit the affected files.</p>`;
      }
    }

    body += `<p>Best regards,`;

    let inlineImagesObj = {};
    
    try {
      const folder = DriveApp.getFolderById("1Ry0zPOQdTPAu10jXfK9MBWoqkr1kw7KM");
      const files = folder.getFilesByName("hiab-text-logo.png");
      const logoBlob = files.next().getBlob();
      inlineImagesObj['hiabLogo'] = logoBlob;
      body += `<br><img src="cid:hiabLogo" alt="Hiab Logo" style="height: 40px; width: auto;">`;

    } catch (e) {

    }

    body += `
      <hr style="margin-top: 20px; border: none; border-top: 1px solid #dddddd;">
      <div style="color: #777777; font-size: 12px; margin-top: 10px;">
        This is an automatic notification from the HIAB deals system.<br>
        Please do not reply for this email.
      </div>
    `;


    // Send to the explicit client email
    message.reply("", {
      htmlBody: body,
      name: "Hiab Deals Automation",
      replyTo: clientEmail ,
      inlineImages: inlineImagesObj
    });

    const notifiedLabel = GmailApp.getUserLabelByName(CONFIG.LABELS.NOTIFIED);
    if (notifiedLabel) {
      message.getThread().addLabel(notifiedLabel);
    }
  }
};