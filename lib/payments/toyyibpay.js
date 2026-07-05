// ... (keep your createBill function code here)

/** Actively checks a bill's payment status with toyyibPay */
async function getBillTransactionStatus(billCode) {
  const secretKey = getSecretKey();
  const json = await postForm("/index.php/api/getBillTransactions", {
    billCode,
    userSecretKey: secretKey,
  });
  if (!Array.isArray(json) || json.length === 0) return null;
  return json[0];
}

/** Maps toyyibPay's billpaymentStatus */
function mapPaymentStatus(billpaymentStatus) {
  if (billpaymentStatus === "1") return "verified";
  if (billpaymentStatus === "3") return "failed";
  return "pending";
}

/** Validates a callback's MD5 hash */
function verifyCallbackHash({ status, order_id, refno, hash }) {
  const secretKey = getSecretKey();
  const expected = crypto
    .createHash("md5")
    .update(`${secretKey}${status}${order_id}${refno}ok`)
    .digest("hex");
  return expected === hash;
}

/** Maps the callback's status */
function mapCallbackStatus(status) {
  if (status === "1") return "verified";
  if (status === "3") return "failed";
  return "pending";
}

// Ensure ALL these functions are defined above this line!
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
