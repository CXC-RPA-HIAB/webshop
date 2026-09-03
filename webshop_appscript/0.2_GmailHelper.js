const GmailHelper = {
  ensureLabelsExist: function() {
    const requiredLabels = [
      CONFIG.LABELS.NEW,
      CONFIG.LABELS.PROCESSING,
      CONFIG.LABELS.FINISHED,
      CONFIG.LABELS.NOTIFIED,
      CONFIG.LABELS.ERROR
    ];
    
    requiredLabels.forEach(labelName => {
      if (!labelName || labelName.trim() === "") return; 
      
      let label = GmailApp.getUserLabelByName(labelName);
      if (!label) {
        GmailApp.createLabel(labelName);
      }
    });
  }
};