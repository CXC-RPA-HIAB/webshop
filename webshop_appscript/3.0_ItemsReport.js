// Single pass over the ITEMS sheet for one EMAIL_ID. Turns ITEM_STATUS, MATCH_TYPE
// and WEBSHOP_ITEM_STATUS into the buckets shared by the internal and the customer mail.
const ItemsReport = {

  replacedPrefix: function() {
    return CONFIG.ITEM_STATUS.REPLACED + " (";
  },

  // "replaced (A->B, B->C) [warning: obsolete]" without " / " means the successor was resolved
  isCleanReplacement: function(status) {
    return status.indexOf(this.replacedPrefix()) === 0 && status.indexOf(" / ") === -1;
  },

  parseReplacement: function(status) {
    const prefix = this.replacedPrefix();
    if (status.indexOf(prefix) !== 0) return null;

    const closing = status.indexOf(")");
    if (closing === -1) return null;

    const chain = status.substring(prefix.length, closing);
    const steps = chain.split(",").map(step => step.trim()).filter(step => step);
    if (steps.length === 0) return null;

    const warning = status.match(/\[warning: (.+)\]$/);

    return {
      chain: chain,
      originalItem: steps[0].split("->")[0].trim(),
      warning: warning ? warning[1] : ""
    };
  },

  clientErrorFrom: function(matchType, clientError) {
    const marker = `${CONFIG.MATCH_TYPE.FAILED} (client:`;
    if (matchType.indexOf(marker) !== 0) return false;

    if (matchType.indexOf(CONFIG.CLIENT_ERRORS.MISSING_ID) !== -1) {
      clientError.missingId = true;
    } else if (matchType.indexOf(CONFIG.CLIENT_ERRORS.NOT_FOUND) !== -1) {
      clientError.notFound = true;
    } else if (matchType.indexOf(CONFIG.CLIENT_ERRORS.NO_EMAIL) !== -1) {
      clientError.noEmail = true;
    } else if (matchType.indexOf(CONFIG.CLIENT_ERRORS.WRONG_NAME) !== -1) {
      const detail = matchType.split(`${CONFIG.CLIENT_ERRORS.WRONG_NAME}: `)[1] || "";
      clientError.wrongName = detail.replace(/\)\s*$/, "").trim();
    } else {
      clientError.other = matchType;
    }

    return true;
  },

  build: function(ss, emailId) {
    const report = {
      total: 0,
      ready: [],
      notInBq: [],
      blocked: [],
      noGlobalPrice: [],
      obsolete: [],
      anotherProblem: [],
      failedMatch: [],
      pending: [],
      other: [],
      replaced: [],
      webshopRejected: [],
      processed: [],
      clientError: { missingId: false, notFound: false, noEmail: false, wrongName: null, other: null },
      hasClientError: false,
      rejectedCount: 0
    };

    const itemsSheet = ss.getSheetByName(CONFIG.SHEETS.ITEMS);
    if (!itemsSheet) return report;

    ItemsSheetWriter.ensureColumns(itemsSheet);
    const indexes = ItemsSheetWriter.headerIndexes(itemsSheet);
    const emailIdIdx = indexes.EMAIL_ID;
    const itemNameIdx = indexes.ITEM_NAME;
    const itemStatusIdx = indexes.ITEM_STATUS;
    const matchTypeIdx = indexes.MATCH_TYPE;
    const webshopStatusIdx = indexes.WEBSHOP_ITEM_STATUS;
    const itemCountIdx = indexes.ITEM_COUNT;

    if (emailIdIdx === undefined || itemNameIdx === undefined || itemStatusIdx === undefined) {
      return report;
    }

    const itemsData = itemsSheet.getDataRange().getValues();

    for (let j = 1; j < itemsData.length; j++) {
      if (itemsData[j][emailIdIdx] !== emailId) continue;

      const currentItem = String(itemsData[j][itemNameIdx] || "").trim();
      const status = String(itemsData[j][itemStatusIdx] || "").trim();
      const matchType = matchTypeIdx !== undefined ? String(itemsData[j][matchTypeIdx] || "").trim() : "";
      const webshopStatus = webshopStatusIdx !== undefined ? String(itemsData[j][webshopStatusIdx] || "").trim() : "";

      report.total++;

      const replacement = this.parseReplacement(status);
      const originalItem = replacement ? replacement.originalItem : currentItem;
      const label = (originalItem && originalItem !== currentItem)
        ? `${originalItem} &rarr; ${currentItem}`
        : currentItem;
      const entry = { item: currentItem, originalItem: originalItem, label: label, status: status };

      if (this.clientErrorFrom(matchType, report.clientError)) {
        report.hasClientError = true;
      }

      if (status === CONFIG.ITEM_STATUS.NOT_IN_BQ) {
        report.notInBq.push(entry);
      } else if (status === CONFIG.ITEM_STATUS.BLOCKED) {
        report.blocked.push(entry);
      } else if (status === CONFIG.ITEM_STATUS.NO_GLOBAL_PRICE) {
        report.noGlobalPrice.push(entry);
      } else if (status === CONFIG.ITEM_STATUS.OBSOLETE) {
        report.obsolete.push(entry);
      } else if (status === CONFIG.ITEM_STATUS.ANOTHER_PROBLEM) {
        report.anotherProblem.push(entry);
      } else if (status === CONFIG.ITEM_STATUS.PENDING_BQ) {
        report.pending.push(entry);
      } else if (this.isCleanReplacement(status)) {
        report.replaced.push({
          originalItem: originalItem,
          currentItem: currentItem,
          chain: replacement ? replacement.chain : "",
          warning: replacement ? replacement.warning : ""
        });

        if (replacement && replacement.warning === CONFIG.ITEM_STATUS.OBSOLETE) {
          report.obsolete.push(entry);
        }
      } else if (status.indexOf(this.replacedPrefix()) === 0) {
        // "replaced (...) / another problem (...)": no single successor could be resolved
        report.anotherProblem.push(entry);
      } else if (status !== CONFIG.ITEM_STATUS.VALID) {
        report.other.push(entry);
      }

      const gatePassed = status === CONFIG.ITEM_STATUS.VALID || this.isCleanReplacement(status);
      const matchOk = matchType === CONFIG.MATCH_TYPE.STANDARD ||
        matchType.indexOf(CONFIG.MATCH_TYPE.GBO + " (") === 0;

      if (gatePassed && matchType.indexOf(CONFIG.MATCH_TYPE.FAILED) === 0) {
        report.failedMatch.push(entry);
      } else if (gatePassed && matchOk) {
        report.ready.push(entry);
      }

      if (webshopStatus && webshopStatus !== CONFIG.WEBSHOP_ITEM_STATUS_OK) {
        report.webshopRejected.push({ item: currentItem, originalItem: originalItem, status: webshopStatus });
      }

      if (webshopStatus === CONFIG.WEBSHOP_ITEM_STATUS_OK) {
        let quantity = 1;
        if (itemCountIdx !== undefined) {
          const parsed = parseInt(itemsData[j][itemCountIdx], 10);
          if (!isNaN(parsed) && parsed > 0) quantity = parsed;
        }
        report.processed.push({
          item: currentItem,
          originalItem: originalItem,
          label: label,
          quantity: quantity
        });
      }
    }

    report.rejectedCount = report.total - report.ready.length;
    return report;
  },

  // Aggregates the technical buckets into the three categories shown to the customer.
  // Every ordered item lands in at most one category: unavailable > obsolete > replaced.
  customerBuckets: function(report) {
    const buckets = { unavailable: [], obsolete: [], replaced: [] };
    const taken = {};

    const take = function(target, code) {
      const key = String(code || "").trim();
      if (!key || taken[key]) return;
      taken[key] = true;
      target.push(key);
    };

    const unavailableSources = []
      .concat(report.notInBq, report.blocked, report.noGlobalPrice,
              report.anotherProblem, report.failedMatch, report.other, report.webshopRejected);

    unavailableSources.forEach(entry => take(buckets.unavailable, entry.originalItem || entry.item));
    report.obsolete.forEach(entry => take(buckets.obsolete, entry.originalItem || entry.item));

    report.replaced.forEach(entry => {
      const key = String(entry.originalItem || "").trim();
      if (!key || taken[key]) return;
      taken[key] = true;
      buckets.replaced.push({ originalItem: entry.originalItem, currentItem: entry.currentItem });
    });

    return buckets;
  }
};
