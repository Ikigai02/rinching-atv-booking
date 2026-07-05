// Replace your existing ensureCategoryCode function with this version
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

  let categoryCode = Array.isArray(json) && json[0] && json[0].CategoryCode;

  // FIX: Handle the case where the category already exists
  if (!categoryCode) {
    const errorString = JSON.stringify(json);
    if (errorString.includes("Category name already exist")) {
      const match = errorString.match(/"CategoryCode":"([^"]+)"/);
      if (match) {
        categoryCode = match[1];
      }
    }
  }

  if (!categoryCode) {
    throw new Error(`toyyibPay createCategory failed: ${JSON.stringify(json).slice(0, 300)}`);
  }

  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('toyyibpay_category_code', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(categoryCode);
  
  return categoryCode;
}
