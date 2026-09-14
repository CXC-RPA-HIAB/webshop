const CONFIG = {
  SPREADSHEET_ID: "15YDKASd6QCWy9HOL7YKPTVOCMWMnzZ-a4fYKX3vLb0Q", 
  ROOT_FOLDER_ID: "1htd1C1LhpussQI2RA94Qgwhd6pD2UxDI",
  TARGET_EMAIL: "hiabdeals@hiab.com",
  BQ_PROJECT_ID: "s-bicloud-curated-0001-p",
  
  LABELS: {
    NEW: "WEBSHOP/NEW",
    PROCESSING: "WEBSHOP/PROCESSING",
    NOTIFIED: "WEBSHOP/NOTIFIED",
    ERROR: "WEBSHOP/ERROR",
    FINISHED: "WEBSHOP/FINISHED"
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
    PENDING_BQ: "PENDING_BQ"
  },

  MATCH_TYPE: {
    STANDARD: "standard",
    GBO: "gpo",
    FAILED: "failed"
  },

};