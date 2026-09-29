const CONFIG = {
  SPREADSHEET_ID: "15YDKASd6QCWy9HOL7YKPTVOCMWMnzZ-a4fYKX3vLb0Q", 
  ROOT_FOLDER_ID: "1nOTugI-yoHVhZMk9bLwSBiiuHZnURx2k",
  TARGET_EMAIL: "hiabdeals@hiab.com",
  LABELS: {
    NEW: "WEBSHOP/NEW",
    PROCESSING: "WEBSHOP/PROCESSING",
    NOTIFIED: "WEBSHOP/NOTIFIED",
    ERROR: "WEBSHOP/ERROR",
    FINISHED: "WEBSHOP/FINISHED"
  },

  /** Fallback if CONFIG.LABELS is missing in a deployed copy */
  defaultLabel: function(key) {
    const defaults = {
      NEW: "WEBSHOP/NEW",
      PROCESSING: "WEBSHOP/PROCESSING",
      NOTIFIED: "WEBSHOP/NOTIFIED",
      ERROR: "WEBSHOP/ERROR",
      FINISHED: "WEBSHOP/FINISHED"
    };
    if (typeof CONFIG !== "undefined" && CONFIG.LABELS && CONFIG.LABELS[key]) {
      return CONFIG.LABELS[key];
    }
    return defaults[key] || "";
  },
  
  SHEETS: {
    MAIN: "MAIN",
    ITEMS: "ITEMS",
    PHASES: "PHASES"
  },
  
PHASES: {
    RECEIVED: "1_EMAIL_RECEIVED",
    STORAGE: "2_DRIVE_STORAGE",
    VALIDATION_FILE: "3_FILE_VALIDATION",
    PENDING_BQ: "4_PENDING_BQ_VALIDATION",
    VALID: "5_VALID",
    ERROR: "-1_ERROR",
  },


  MANUAL_STATES: {
    PROCESSING: "PROCESSING",
    ERROR: "ERROR",
    VALID: "VALID"
  },

  ITEM_STATUS: {
    VALID: "valid",
    NOT_IN_BQ: "not exist in big query",
    REPLACED: "replaced",
    OBSOLETE: "obsolete",
    ANOTHER_PROBLEM: "another problem (contact with webshop support)",
    NO_GLOBAL_PRICE: "no_global_price",
    BLOCKED: "blocked",
    PENDING_BQ: "PENDING_BQ",
    QUEUED: "queued"
  },

  MATCH_TYPE: {
    STANDARD: "standard",
    GBO: "gpo",
    FAILED: "failed"
  },

  // EMAIL_FEEDBACK (column J): NO until robot/appscript terminal event, then terminal states
  FEEDBACK_STATES: {
    PENDING: "NO",
    INTERNAL_SENT: "INTERNAL_SENT", // legacy / parse-error-only internal mail
    INTERNAL_AND_EXTERNAL_SENT: "INTERNAL_AND_EXTERNAL_SENT",
    INTERNAL_ONLY: "INTERNAL_ONLY",
    INTERNAL_ONLY_UPLOAD_FAILED: "INTERNAL_ONLY_UPLOAD_FAILED"
  },

  // Written by the Python robot into WEBSHOP_ITEM_STATUS for accepted materials
  WEBSHOP_ITEM_STATUS_OK: "exist",

  CLIENT_ERRORS: {
    MISSING_ID: "MISSING_ID",
    NOT_FOUND: "CLIENT_NOT_FOUND",
    WRONG_NAME: "WRONG_NAME",
    NO_EMAIL: "NO_CUSTOMER_EMAIL"
  },

  CUSTOMER_LIST_LIMIT: 25,

  // Linked in the customer email so the client can open their saved carts
  SAVED_CARTS_URL: "https://webshop.hiab.com/en/my-account/saved-carts/"

};