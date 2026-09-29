const GmailHelper = {
  labelName: function(key) {
    if (typeof CONFIG !== "undefined" && CONFIG.defaultLabel) {
      return CONFIG.defaultLabel(key);
    }
    if (typeof CONFIG !== "undefined" && CONFIG.LABELS && CONFIG.LABELS[key]) {
      return CONFIG.LABELS[key];
    }
    const defaults = {
      NEW: "WEBSHOP/NEW",
      PROCESSING: "WEBSHOP/PROCESSING",
      NOTIFIED: "WEBSHOP/NOTIFIED",
      ERROR: "WEBSHOP/ERROR",
      FINISHED: "WEBSHOP/FINISHED"
    };
    return defaults[key] || "";
  },

  getOrCreateLabel: function(labelName) {
    const name = String(labelName || "").trim();
    if (!name) {
      Logger.log("getOrCreateLabel: empty label name skipped.");
      return null;
    }

    let label = GmailApp.getUserLabelByName(name);
    if (label) {
      return label;
    }

    this.ensureParentLabel(name);
    label = GmailApp.createLabel(name);
    return label;
  },

  ensureParentLabel: function(fullName) {
    const slash = fullName.indexOf("/");
    if (slash <= 0) {
      return;
    }
    const parent = fullName.substring(0, slash).trim();
    if (!parent) {
      return;
    }
    if (GmailApp.getUserLabelByName(parent)) {
      return;
    }
    if (GmailApp.getUserLabelByName(fullName)) {
      return;
    }
    try {
      GmailApp.createLabel(parent);
    } catch (error) {
      Logger.log(`Parent label "${parent}" skipped: ${error.message}`);
    }
  },

  ensureLabelsExist: function() {
    ["NEW", "PROCESSING", "FINISHED", "NOTIFIED", "ERROR"].forEach(key => {
      const labelName = this.labelName(key);
      if (!labelName) {
        Logger.log(`Skipping empty CONFIG label key: ${key}`);
        return;
      }
      this.getOrCreateLabel(labelName);
    });
  }
};

/**
 * Legacy trigger entry — do not use as scheduled job.
 * With no argument: ensures WEBSHOP/* labels exist.
 * Prefer trigger on processFeedbackEmails instead.
 */
function getOrCreateLabel(labelName) {
  if (!labelName || String(labelName).trim() === "") {
    Logger.log("getOrCreateLabel() called with no name — ensuring default labels. Update trigger to processFeedbackEmails.");
    GmailHelper.ensureLabelsExist();
    return null;
  }
  return GmailHelper.getOrCreateLabel(labelName);
}
