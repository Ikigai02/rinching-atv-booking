const crypto = require("crypto");

function getSecretKey() {
  const key = (process.env.TOYYIBPAY_SECRET_KEY || "").trim();
  if (!key) throw new Error("toyyibPay is not configured.");
  return key;
}

function getBaseUrl() {
  const url = (process.env.TOYYIBPAY_BASE_URL || "").trim();
  return (url || "https://dev.toyyibpay.com").replace(/\/+$/, "");
}

function payUrlFor(billCode) {
  return `${getBaseUrl()}/${billCode}`;
}

// ULTRA-STRICT SANITIZATION:
// Removes spaces, hyphens, and all symbols. 
// "John Doe" -> "JohnDoe". "Deposit 1" -> "Deposit1".
// This completely bypasses the CodeIgniter URI disallowed characters error.
function ultraSafe(str, maxLen) {
  return String(str || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, maxLen) || "Customer";
}

async function postForm(path, params) {
  const body = new URLSearchParams(params);
  const res = await fetch(`${getBaseUrl()}${path}`, { method: "POST", body });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`toyyibPay returned non-JSON response from ${path}`);
  }
  return json;
}

async function ensureCategoryCode(db) {
  if (process.env.TOYYIBPAY_CATEGORY_CODE) return process.env.TOYYIBPAY_CATEGORY_CODE.trim();

  const cached = db.prepare("SELECT value FROM settings WHERE key = 'toyyibpay_category_code'").get();
  if (cached) return cached.value;

  const secretKey = getSecretKey();
  const json = await postForm("/index.php/api/createCategory", {
    catname: "ATVBookings", // Strictly no spaces
    catdescription: "Deposits", // Strictly no spaces
    userSecretKey: secretKey,
  });

  let categoryCode = Array.isArray(json) && json[0] && json[0].CategoryCode;

  if (!categoryCode) {
    const errorString = JSON.stringify(json);
    if (errorString.includes("Category name already exist")) {
      const match = errorString.match(/"CategoryCode":"([^"]+)"/);
      if (match) categoryCode = match[1];
    }
  }

  if (!categoryCode) throw new Error(`toyyibPay createCategory failed: ${JSON.stringify(json).slice(0, 300)}`);

  db.prepare("INSERT INTO settings (key, value) VALUES ('toyyibpay_category_code', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(categoryCode);
  return categoryCode;
}

async function createBill({ db, amount, bookingId, returnUrl, callbackUrl, customerName, customerEmail, customerPhone }) {
  const secretKey = getSecretKey();
  const categoryCode = await ensureCategoryCode(db);

  const json = await postForm("/index.php/api/createBill", {
    userSecretKey: secretKey,
    categoryCode,
    billName: ultraSafe("Booking" + bookingId, 30), // "Booking1"
    billDescription: "ATVDeposit", // "ATVDeposit"
    billPriceSetting: "1",
    billPayorInfo: "1",
    billAmount: String(Math.round(amount * 100)),
    billReturnUrl: returnUrl,
    billCallbackUrl: callbackUrl,
    billExternalReferenceNo: ultraSafe("B" + bookingId, 30), // "B1"
    billTo: ultraSafe(customerName, 30), // "JohnDoe"
    billEmail: customerEmail || "test@example.com",
    billPhone: ultraSafe(customerPhone, 15) || "0123456789",
    billPaymentChannel: "0",
    billExpiryDays: "1",
  });

  const billCode = Array.isArray(json) && json[0] && json[0].BillCode;
  if (!billCode) throw new Error(`toyyibPay createBill failed: ${JSON.stringify(json).slice(0, 300)}`);
  return { billCode, redirectUrl: payUrlFor(billCode) };
}

async function getBillTransactionStatus(billCode) {
  const secretKey = getSecretKey();
  const json = await postForm("/index.php/api/getBillTransactions", { billCode, userSecretKey: secretKey });
  if (!Array.isArray(json) || json.length === 0) return null;
  return json[0];
}

function mapPaymentStatus(billpaymentStatus) {
  if (billpaymentStatus === "1") return "verified";
  if (billpaymentStatus === "3") return "failed";
  return "pending";
}

function verifyCallbackHash({ status, order_id, refno, hash }) {
  const secretKey = getSecretKey();
  const expected = crypto.createHash("md5").update(`${secretKey}${status}${order_id}${refno}ok`).digest("hex");
  return expected === hash;
}

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
