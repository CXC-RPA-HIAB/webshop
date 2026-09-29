/**
 * Hardcoded mail previews — run from the Apps Script editor.
 * Set TEST_TO to your inbox before running.
 */
var TEST_TO = "ext.natalia.sekula@hiab.com";

var TEST_INTERNAL_BASE = {
  internalName: "internal_user",
  customerName: "manual_testing Dealer_SE04_01",
  customerNumber: "12345",
  customerEmail: "customer@example.com",
  attachmentName: "manual_test_order.csv",
  savedCartName: "cart_290926_1400",
  deliveryTo: TEST_TO,
  emailSubject: "[TEST] Internal — Hiab Deals overview"
};

function sendHardcodedTestCustomerEmail() {
  EmailNotifier.sendCustomerFeedback({
    customerEmail: TEST_TO,
    customerName: "manual_testing Dealer_SE04_01",
    internalEmail: CONFIG.TARGET_EMAIL,
    savedCartName: "cart_290926_1400",
    buckets: { unavailable: [], obsolete: [], replaced: [] },
    processedItems: [
      { item: "006.120.0028", label: "006.120.0028", quantity: 1 }
    ]
  });
  Logger.log("Test customer email sent to " + TEST_TO);
}

/** Internal: bot finished, all lines in saved cart. */
function sendHardcodedInternalSuccess() {
  EmailNotifier.sendInternalFeedback(null, {
    internalName: TEST_INTERNAL_BASE.internalName,
    customerName: TEST_INTERNAL_BASE.customerName,
    customerNumber: TEST_INTERNAL_BASE.customerNumber,
    customerEmail: TEST_INTERNAL_BASE.customerEmail,
    attachmentName: TEST_INTERNAL_BASE.attachmentName,
    variant: EmailNotifier.VARIANTS.CART_COMPLETED,
    errorMessage: "",
    savedCartName: TEST_INTERNAL_BASE.savedCartName,
    deliveryTo: TEST_TO,
    emailSubject: "[TEST] Internal SUCCESS — cart completed",
    report: {
      total: 1,
      processed: [
        { item: "006.120.0028", label: "006.120.0028", quantity: 1 }
      ],
      webshopRejected: [],
      pending: []
    }
  });
  Logger.log("Test internal SUCCESS sent to " + TEST_TO);
}

/** Internal: cart saved but some items rejected by webshop. */
function sendHardcodedInternalPartialFailure() {
  EmailNotifier.sendInternalFeedback(null, {
    internalName: TEST_INTERNAL_BASE.internalName,
    customerName: TEST_INTERNAL_BASE.customerName,
    customerNumber: TEST_INTERNAL_BASE.customerNumber,
    customerEmail: TEST_INTERNAL_BASE.customerEmail,
    attachmentName: TEST_INTERNAL_BASE.attachmentName,
    variant: EmailNotifier.VARIANTS.CART_COMPLETED,
    errorMessage: "",
    savedCartName: TEST_INTERNAL_BASE.savedCartName,
    deliveryTo: TEST_TO,
    emailSubject: "[TEST] Internal PARTIAL — webshop rejections",
    report: {
      total: 3,
      processed: [
        { item: "006.120.0028", label: "006.120.0028", quantity: 1 }
      ],
      webshopRejected: [
        {
          item: "464-9700",
          originalItem: "464-9700",
          status: "Item not available in webshop"
        },
        {
          item: "970-1327",
          originalItem: "970-1327",
          status: "Item not available for chosen Customer"
        }
      ],
      pending: []
    }
  });
  Logger.log("Test internal PARTIAL FAILURE sent to " + TEST_TO);
}
