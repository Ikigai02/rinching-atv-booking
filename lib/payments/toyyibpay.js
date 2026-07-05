// Real payment gateway integration: toyyibPay (https://toyyibpay.com).
//
// toyyibPay is a Malaysian payment gateway that offers a completely free
// sandbox environment (dev.toyyibpay.com) that anyone can sign up for
// without business/merchant verification -- ideal for a coursework demo.
//
// Flow implemented here:
//   1. ensureCategoryCode() - a Bill must belong to a Category. We create one
//      automatically on first use and cache its code in the settings table.
//   2. createBill()         - creates a Bill for the deposit amount and
//      returns a BillCode. The customer's browser is redirected to
//      `${BASE_URL}/{BillCode}` to complete payment on toyyibPay's hosted page.
//   3. Two ways the result gets back to us:
//        a) Callback URL - toyyibPay's server POSTs the result to us
//           server-to-server. NOTE: toyyibPay explicitly does not deliver
//           callbacks to `localhost`, so this will not fire during local
//           development. It's still implemented for when the app is
//           deployed somewhere with a public URL.
//        b) Return URL - the customer's browser is redirected back to our
//           payment-return.html page. From there we actively call
//           getBillTransactionStatus() (an outbound HTTPS call from our
//           server to toyyibPay, which works fine even on localhost) to
//           fetch the authoritative payment status. This is what makes the
//           demo work end-to-end without a public URL.
//
// Docs: https://toyyibpay.com/apireference/

const crypto = require("crypto");

function getSecretKey() {
  const key = process.env.TOYYIBPAY_SECRET_KEY;
  if (!key) {
    throw new Error(
      "toyyibPay is not configured. Set TOYYIBPAY_SECRET_KEY in your .env file " +
        "(sign up for a free sandbox account at https://dev.toyyibpay.com to get one)."
    );
  }
  return key;
}

function getBaseUrl() {
  // Defaults to the sandbox host so nobody accidentally goes live by accident.
  return (process.env.TOYYIBPAY_BASE_URL || "https://dev.toyyibpay.com").replace(/\/$/, "");
}

function payUrlFor(billCode) {
  return `${getBaseUrl()}/${billCode}`;
}

/** toyyibPay only accepts alphanumeric characters, spaces, and underscores in
 *  billName/billDescription, with a max length. */
function sanitizeText(str, maxLen) {
  return String(str || "")
    .replace(/[^a-zA-Z0-9 _]/g, "")
    .slice(0, maxLen);
}

async function postForm(path, params) {
  const body = new URLSearchParams(params);
  const res = await fetch(`${getBaseUrl()}${path}`, { method: "POST", body });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`toyyibPay returned a non-JSON response from ${path}: ${text.slice(0, 300)}`);
  }
  return json;
}

/** Ensures a Category exists for our bills, creating (and caching) one if
 *  needed. Pass the `db` handle so we can read/write the settings table. */
async function ensureCategoryCode(db) {
  if (process.env.TOYYIBPAY_CATEGORY_CODE) return process.env.TOYYIBPAY_CATEGORY_CODE;

  const cached = db.prepare("SELECT value FROM settings WHERE key = 'toyyibpay_category_code'").get();
  if (cached) return cached.value;

  const secretKey = getSecretKey();
  const json = await postForm("/index.php/api/createCategory", {
    catname: "Rinching ATV Bookings",
    catdescription: "Deposit payments for Rinching ATV Adventure Park bookings",
    userSecretKey: secretKey,
  });
  const categoryCode = Array.isArray(json) && json[0] && json[0].CategoryCode;
  if (!categoryCode) {
    throw new Error(`toyyibPay createCategory failed: ${JSON.stringify(json).slice(0, 300)}`);
  }
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('toyyibpay_category_code', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(categoryCode);
  return categoryCode;
}

/**
 * Creates a Bill for a booking deposit and returns { billCode, redirectUrl }.
 * amount is in Ringgit (e.g. 90.50), converted to cents for the API.
 */
async function createBill({
  db,
  amount,
  bookingId,
  packageLabel,
  bookingDate,
  customerName,
  customerEmail,
  customerPhone,
  returnUrl,
  callbackUrl,
}) {
  const secretKey = getSecretKey();
  const categoryCode = await ensureCategoryCode(db);

  const json = await postForm("/index.php/api/createBill", {
    userSecretKey: secretKey,
    categoryCode,
    billName: sanitizeText(`Booking ${bookingId} Deposit`, 30),
    billDescription: sanitizeText(`Deposit for ${packageLabel} on ${bookingDate}`, 100),
    billPriceSetting: "1",
    billPayorInfo: "1",
    billAmount: String(Math.round(amount * 100)),
    billReturnUrl: returnUrl,
    billCallbackUrl: callbackUrl,
    billExternalReferenceNo: `RATV-${bookingId}`,
    billTo: sanitizeText(customerName, 100) || "Customer",
    billEmail: customerEmail || "",
    billPhone: customerPhone || "",
    billPaymentChannel: "2", // FPX + Credit Card
    billExpiryDays: "1",
  });

  const billCode = Array.isArray(json) && json[0] && json[0].BillCode;
  if (!billCode) {
    throw new Error(`toyyibPay createBill failed: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return { billCode, redirectUrl: payUrlFor(billCode) };
}

/** Actively checks a bill's payment status with toyyibPay (outbound call,
 *  works fine on localhost - this is the fallback for the return-URL flow). */
async function getBillTransactionStatus(billCode) {
  const secretKey = getSecretKey();
  const json = await postForm("/index.php/api/getBillTransactions", {
    billCode,
    userSecretKey: secretKey,
  });
  if (!Array.isArray(json) || json.length === 0) return null;
  return json[0]; // { billpaymentStatus, billpaymentInvoiceNo, billpaymentAmount, ... }
}

/** Maps toyyibPay's billpaymentStatus ("1"|"2"|"3"|"4") to our payment status. */
function mapPaymentStatus(billpaymentStatus) {
  if (billpaymentStatus === "1") return "verified";
  if (billpaymentStatus === "3") return "failed";
  return "pending"; // "2" pending, "4" pending
}

/** Validates a callback's MD5 hash: MD5(secretKey + status + order_id + refno + "ok") */
function verifyCallbackHash({ status, order_id, refno, hash }) {
  const secretKey = getSecretKey();
  const expected = crypto
    .createHash("md5")
    .update(`${secretKey}${status}${order_id}${refno}ok`)
    .digest("hex");
  return expected === hash;
}

/** Maps the callback's `status` ("1"|"2"|"3") to our payment status. */
function mapCallbackStatus(status) {
  if (status === "1") return "verified";
  if (status === "3") return "failed";
  return "pending";
}

module.exports = {
  getBaseUrl,
  payUrlFor,
  ensureCategoryCode,
  createBill,
  getBillTransactionStatus,
  mapPaymentStatus,
  verifyCallbackHash,
  mapCallbackStatus,
};
