const CONFIG = {
  SPREADSHEET_ID: "15YDKASd6QCWy9HOL7YKPTVOCMWMnzZ-a4fYKX3vLb0Q", 
  ROOT_FOLDER_ID: "1-U7FJ__7F65zVxYvmCKE1AW2scajcZvI",
  LOGO_FOLDER_ID: "1gt3Zvlq2Et7BlEhdUAJ5e0QmtnrakMdv",
  LOGO_FILE_NAME: "hiab-text-logo.png",
  TARGET_EMAIL: "hiabdeals@hiab.com",
  ERROR_FEEDBACK_TO: "ext.natalia.sekula@hiab.com",
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
    MAIN: "order_level",
    ITEMS: "item_level",
    PHASES: "PHASES"
  },

  ORDER_HEADERS: [
    "order_id",
    "phase",
    "active_phase",
    "email_response",
    "customer_name",
    "customer_number",
    "customer_email",
    "order_csv",
    "timestamp_order_receive",
    "timestamp_bot_done",
    "saved_card_name",
    "internal_email"
  ],

  ITEM_HEADERS: [
    "order_id",
    "item_number",
    "item_qty",
    "item_status",
    "item_match_type"
  ],
  
PHASES: {
    RECEIVED: "1_EMAIL_RECEIVED",
    STORAGE: "2_DRIVE_STORAGE",
    VALIDATION_FILE: "3_FILE_VALIDATION",
    PENDING_BQ: "4_PENDING_BQ_VALIDATION",
    VALID: "5_VALID",
    ERROR: "-1_ERROR",
  },


  ORDER_PHASE: {
    IN_PROGRESS: "IN PROGRESS",
    READY: "READY",
    DONE: "DONE",
    ERROR: "ERROR"
  },

  MANUAL_STATES: {
    PROCESSING: "IN PROGRESS",
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

  FEEDBACK_STATES: {
    PENDING: "NO",
    SENT: "YES"
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

const ORDER_COL = {
  ORDER_ID: 0,
  PHASE: 1,
  ACTIVE_PHASE: 2,
  EMAIL_RESPONSE: 3,
  CUSTOMER_NAME: 4,
  CUSTOMER_NUMBER: 5,
  CUSTOMER_EMAIL: 6,
  ORDER_CSV: 7,
  TIMESTAMP_ORDER_RECEIVE: 8,
  TIMESTAMP_BOT_DONE: 9,
  SAVED_CARD_NAME: 10,
  INTERNAL_EMAIL: 11
};

const ORDER_COL_1 = {
  ORDER_ID: 1,
  PHASE: 2,
  ACTIVE_PHASE: 3,
  EMAIL_RESPONSE: 4,
  CUSTOMER_NAME: 5,
  CUSTOMER_NUMBER: 6,
  CUSTOMER_EMAIL: 7,
  ORDER_CSV: 8,
  TIMESTAMP_ORDER_RECEIVE: 9,
  TIMESTAMP_BOT_DONE: 10,
  SAVED_CARD_NAME: 11,
  INTERNAL_EMAIL: 12
};

const MAIN_COL = {
  ORDER_ID: ORDER_COL.ORDER_ID,
  EMAIL_ID: ORDER_COL.ORDER_ID,
  PHASE: ORDER_COL.PHASE,
  MANUAL_PHASE: ORDER_COL.PHASE,
  ACTIVE_PHASE: ORDER_COL.ACTIVE_PHASE,
  EMAIL_RESPONSE: ORDER_COL.EMAIL_RESPONSE,
  EMAIL_FEEDBACK: ORDER_COL.EMAIL_RESPONSE,
  CUSTOMER_NAME: ORDER_COL.CUSTOMER_NAME,
  CUSTOMER_NUMBER: ORDER_COL.CUSTOMER_NUMBER,
  CUSTOMER_EMAIL: ORDER_COL.CUSTOMER_EMAIL,
  ORDER_CSV: ORDER_COL.ORDER_CSV,
  ATTACHMENTS_PATH: ORDER_COL.ORDER_CSV,
  ATTACHMENT_PATH: ORDER_COL.ORDER_CSV,
  TIMESTAMP_ORDER_RECEIVE: ORDER_COL.TIMESTAMP_ORDER_RECEIVE,
  TIMESTAMP_EMAIL_RECEIVE: ORDER_COL.TIMESTAMP_ORDER_RECEIVE,
  TIMESTAMP_BOT_DONE: ORDER_COL.TIMESTAMP_BOT_DONE,
  TIMESTAMP_PROCESSED_AT: ORDER_COL.TIMESTAMP_BOT_DONE,
  SAVED_CARD_NAME: ORDER_COL.SAVED_CARD_NAME,
  BATCH_NAME: ORDER_COL.SAVED_CARD_NAME,
  EMAIL_TITLE: ORDER_COL.SAVED_CARD_NAME,
  ATTACHMENT_NAME: ORDER_COL.SAVED_CARD_NAME,
  INTERNAL_EMAIL: ORDER_COL.INTERNAL_EMAIL
};
