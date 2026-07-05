const express = require("express");
const db = require("../db/database");
const { requireLogin, requireRole } = require("../middleware/auth");
const sched = require("../lib/scheduling");
const toyyibpay = require("../lib/payments/toyyibpay");

const router = express.Router();

function appBaseUrl() {
  let url = (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).trim();
  // Ensure the URL has https:// so ToyyibPay doesn't treat it as a broken internal path
  if (!url.startsWith("http")) {
    url = "https://" + url;
  }
  return url.replace(/\/+$/, ""); 
}

function getPackage(id) {
  return db.prepare("SELECT * FROM packages WHERE id = ? AND active = 1").get(id);
}

function getBookingWithDetails(id) {
  return db
    .prepare(
      `SELECT b.*, p.code AS package_code, p.name AS package_name, p.duration_label,
              u.name AS customer_name, u.email AS customer_email, u.phone AS customer_phone
       FROM bookings b
       JOIN packages p ON p.id = b.package_id
       JOIN users u ON u.id = b.customer_id
       WHERE b.id = ?`
    )
    .get(id);
}

router.get("/booking-window", (req, res) => {
  const settings = sched.getSettings();
  res.json({
    minDate: sched.getMinBookingDate(settings),
    minAdvanceDays: Number(settings.min_advance_booking_days),
  });
});

router.get("/availability", (req, res) => {
  const { date, package_id } = req.query;
  if (!date || !package_id) return res.status(400).json({ error: "date and package_id are required." });
  const pkg = getPackage(Number(package_id));
  if (!pkg) return res.status(404).json({ error: "Package not found." });

  const result = sched.getAvailability(date, pkg);
  const settings = sched.getSettings();
  res.json({
    ...result,
    package: pkg,
    depositPercentage: Number(settings.deposit_percentage),
    childPassengerPricePct: Number(settings.child_passenger_price_pct),
    minSoloRiderAge: Number(settings.min_solo_rider_age),
    minChildPassengerAge: Number(settings.min_child_passenger_age),
    maxChildPerAdult: Number(settings.max_child_passengers_per_adult),
    minBookingDate: sched.getMinBookingDate(settings),
  });
});

router.post("/", requireRole("customer"), (req, res) => {
  const { package_id, date, time_slot, adult_count = 1, child_count = 0, ack_age_policy, ack_refund_policy } = req.body;

  if (!package_id || !date || !time_slot || !ack_age_policy || !ack_refund_policy) {
    return res.status(400).json({ error: "Missing required booking details or policy acknowledgement." });
  }

  const adults = parseInt(adult_count, 10);
  const children = parseInt(child_count, 10);
  const settings = sched.getSettings();
  const pkg = getPackage(package_id);
  
  if (!pkg) return res.status(404).json({ error: "Package not found." });

  const startMin = sched.hhmmToMinutes(time_slot);
  const endMin = startMin + pkg.duration_minutes;
  const inventory = Number(settings.daily_atv_inventory);
  const used = sched.computeAtvUsage(date, startMin, endMin);
  
  if (used + adults > inventory) return res.status(409).json({ error: "Not enough ATVs available." });

  const childPct = Number(settings.child_passenger_price_pct) / 100;
  const totalPrice = pkg.base_price * adults + pkg.base_price * childPct * children;
  const depositAmount = Math.round(totalPrice * (Number(settings.deposit_percentage) / 100) * 100) / 100;
  const balanceDue = Math.round((totalPrice - depositAmount) * 100) / 100;
  const holdExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");

  const info = db
    .prepare(`INSERT INTO bookings (customer_id, package_id, booking_date, time_slot, adult_count, child_count, total_price, deposit_amount, balance_due, status, hold_expires_at, ack_age_policy, ack_refund_policy) VALUES (?,?,?,?,?,?,?,?,?, 'hold', ?, 1, 1)`)
    .run(req.session.user.id, package_id, date, time_slot, adults, children, totalPrice, depositAmount, balanceDue, holdExpiresAt);

  res.status(201).json(getBookingWithDetails(info.lastInsertRowid));
});

router.post("/:id/pay", requireRole("customer"), async (req, res) => {
  try {
    sched.expireStaleHolds();
    const booking = getBookingWithDetails(req.params.id);
    if (!booking || booking.customer_id !== req.session.user.id) return res.status(404).json({ error: "Booking not found." });
    
    const { method, reference } = req.body;
    
    if (method === "card") {
      const info = db.prepare(`INSERT INTO payments (booking_id, amount, method, reference, status, verified_at, notes) VALUES (?, ?, 'card', ?, 'verified', datetime('now'), 'Simulated gateway auto-approval')`).run(booking.id, booking.deposit_amount, reference || `SIM-${Date.now()}`);
      db.prepare("UPDATE bookings SET status='confirmed', updated_at=datetime('now') WHERE id=?").run(booking.id);
      return res.json({ payment: db.prepare("SELECT * FROM payments WHERE id=?").get(info.lastInsertRowid), booking: getBookingWithDetails(booking.id) });
    }

    if (method === "toyyibpay") {
      const base = appBaseUrl();
      
      const returnUrl = `${base}/payment-return.html`;
      const callbackUrl = `${base}/api/bookings/payment-callback`;

      const { billCode, redirectUrl } = await toyyibpay.createBill({
        db,
        amount: booking.deposit_amount,
        bookingId: booking.id,
        returnUrl: returnUrl,
        callbackUrl: callbackUrl,
        customerName: booking.customer_name,
        customerEmail: booking.customer_email,
        customerPhone: booking.customer_phone,
      });

      db.prepare("INSERT INTO payments (booking_id, amount, method, reference, status, notes) VALUES (?, ?, 'toyyibpay', ?, 'pending', 'Awaiting payment')")
        .run(booking.id, booking.deposit_amount, billCode);
      return res.status(201).json({ billCode, redirectUrl, booking: getBookingWithDetails(booking.id) });
    }
    
    const info = db.prepare(`INSERT INTO payments (booking_id, amount, method, reference, status) VALUES (?, ?, 'bank_transfer', ?, 'pending')`).run(booking.id, booking.deposit_amount, reference);
    db.prepare("UPDATE bookings SET status='pending_verification', hold_expires_at=NULL, updated_at=datetime('now') WHERE id=?").run(booking.id);
    res.json({ payment: db.prepare("SELECT * FROM payments WHERE id=?").get(info.lastInsertRowid), booking: getBookingWithDetails(booking.id) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post("/payment-callback", (req, res) => {
  try {
    const { refno, status, reason, billcode, order_id } = req.body;
    if (!billcode || !status) return res.status(400).send("Missing fields.");
    if (!toyyibpay.verifyCallbackHash({ status, order_id, refno, hash: req.body.hash })) return res.status(400).send("Invalid signature.");
    
    const payment = db.prepare("SELECT * FROM payments WHERE reference = ? AND method = 'toyyibpay' ORDER BY created_at DESC LIMIT 1").get(billcode);
    if (!payment) return res.status(404).send("Unknown bill.");

    const newStatus = toyyibpay.mapCallbackStatus(status);
    db.prepare("UPDATE payments SET status=?, verified_at=datetime('now'), notes=? WHERE id=?").run(newStatus, `toyyibPay callback: ${reason || newStatus} (refno ${refno || "n/a"})`, payment.id);
    
    if (newStatus === "verified") {
      db.prepare("UPDATE bookings SET status='confirmed', updated_at=datetime('now') WHERE id=? AND status IN ('hold','pending_verification')").run(payment.booking_id);
    }
    res.send("OK");
  } catch (err) {
    res.status(500).send(err.message);
  }
});

router.get("/:id/payment-status", requireLogin, async (req, res) => {
  try {
    const booking = getBookingWithDetails(req.params.id);
    if (!booking) return res.status(404).json({ error: "Booking not found." });
    if (req.session.user.role === "customer" && booking.customer_id !== req.session.user.id) return res.status(403).json({ error: "Access denied." });

    const payment = db.prepare("SELECT * FROM payments WHERE booking_id = ? AND method = 'toyyibpay' ORDER BY created_at DESC LIMIT 1").get(booking.id);
    if (!payment) return res.json({ booking, payment: null });

    if (payment.status === "pending") {
      const tx = await toyyibpay.getBillTransactionStatus(payment.reference);
      if (tx) {
        const newStatus = toyyibpay.mapPaymentStatus(tx.billpaymentStatus);
        if (newStatus !== "pending") {
          db.prepare("UPDATE payments SET status=?, verified_at=datetime('now'), notes=? WHERE id=?").run(newStatus, `toyyibPay status check: billpaymentStatus=${tx.billpaymentStatus}`, payment.id);
          if (newStatus === "verified") {
            db.prepare("UPDATE bookings SET status='confirmed', updated_at=datetime('now') WHERE id=? AND status IN ('hold','pending_verification')").run(booking.id);
          }
        }
      }
    }

    res.json({ booking: getBookingWithDetails(booking.id), payment: db.prepare("SELECT * FROM payments WHERE id = ?").get(payment.id) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get("/mine", requireRole("customer"), (req, res) => {
  sched.expireStaleHolds();
  const rows = db.prepare(`SELECT b.*, p.code AS package_code, p.name AS package_name, p.duration_label FROM bookings b JOIN packages p ON p.id = b.package_id WHERE b.customer_id = ? ORDER BY b.created_at DESC`).all(req.session.user.id);
  res.json(rows);
});

router.get("/", requireRole("admin", "marshall"), (req, res) => {
  sched.expireStaleHolds();
  const { date, status } = req.query;
  let sql = `SELECT b.*, p.code AS package_code, p.name AS package_name, p.duration_label, u.name AS customer_name, u.email AS customer_email, u.phone AS customer_phone FROM bookings b JOIN packages p ON p.id = b.package_id JOIN users u ON u.id = b.customer_id WHERE 1=1`;
  const params = [];
  if (date) { sql += " AND b.booking_date = ?"; params.push(date); }
  if (status) { sql += " AND b.status = ?"; params.push(status); }
  sql += " ORDER BY b.booking_date ASC, b.time_slot ASC";
  res.json(db.prepare(sql).all(...params));
});

router.get("/:id", requireLogin, (req, res) => {
  const booking = getBookingWithDetails(req.params.id);
  if (!booking) return res.status(404).json({ error: "Booking not found." });
  if (req.session.user.role === "customer" && booking.customer_id !== req.session.user.id) return res.status(403).json({ error: "Access denied." });
  const payments = db.prepare("SELECT * FROM payments WHERE booking_id = ? ORDER BY created_at DESC").all(booking.id);
  const notifications = db.prepare("SELECT * FROM notifications WHERE booking_id = ? ORDER BY sent_at DESC").all(booking.id);
  res.json({ ...booking, payments, notifications });
});

router.post("/:id/verify-payment", requireRole("admin"), (req, res) => {
  const booking = getBookingWithDetails(req.params.id);
  if (!booking) return res.status(404).json({ error: "Booking not found." });
  const payment = db.prepare("SELECT * FROM payments WHERE booking_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1").get(booking.id);
  if (!payment) return res.status(409).json({ error: "No pending payment." });

  const { approve, notes } = req.body;
  if (approve) {
    db.prepare("UPDATE payments SET status='verified', verified_by=?, verified_at=datetime('now'), notes=? WHERE id=?").run(req.session.user.id, notes || null, payment.id);
    db.prepare("UPDATE bookings SET status='confirmed', updated_at=datetime('now') WHERE id=?").run(booking.id);
  } else {
    db.prepare("UPDATE payments SET status='rejected', verified_by=?, verified_at=datetime('now'), notes=? WHERE id=?").run(req.session.user.id, notes || "Rejected by Admin", payment.id);
    db.prepare("UPDATE bookings SET status='payment_rejected', updated_at=datetime('now') WHERE id=?").run(booking.id);
  }
  res.json(getBookingWithDetails(booking.id));
});

router.patch("/:id", requireRole("admin"), (req, res) => {
  const booking = getBookingWithDetails(req.params.id);
  if (!booking) return res.status(404).json({ error: "Booking not found." });
  if (["cancelled", "refunded", "completed"].includes(booking.status)) return res.status(409).json({ error: "Booking cannot be modified." });

  const { action } = req.body;
  if (action === "cancel") {
    db.prepare("UPDATE bookings SET status='cancelled', cancel_reason=?, updated_at=datetime('now') WHERE id=?").run(req.body.reason || "Cancelled by Admin", booking.id);
    return res.json(getBookingWithDetails(booking.id));
  }
  
  if (action === "reschedule") {
    const { date, time_slot } = req.body;
    const pkg = getPackage(booking.package_id);
    const settings = sched.getSettings();
    const startMin = sched.hhmmToMinutes(time_slot);
    const endMin = startMin + pkg.duration_minutes;
    const used = sched.computeAtvUsage(date, startMin, endMin, booking.id);
    if (used + booking.adult_count > Number(settings.daily_atv_inventory)) return res.status(409).json({ error: "Not enough ATV capacity." });
    
    db.prepare("UPDATE bookings SET booking_date=?, time_slot=?, updated_at=datetime('now') WHERE id=?").run(date, time_slot, booking.id);
    return res.json(getBookingWithDetails(booking.id));
  }

  if (action === "update_pax") {
    const adults = parseInt(req.body.adult_count, 10);
    const children = parseInt(req.body.child_count, 10);
    const pkg = getPackage(booking.package_id);
    const settings = sched.getSettings();
    const startMin = sched.hhmmToMinutes(booking.time_slot);
    const endMin = startMin + pkg.duration_minutes;
    const used = sched.computeAtvUsage(booking.booking_date, startMin, endMin, booking.id);
    if (used + adults > Number(settings.daily_atv_inventory)) return res.status(409).json({ error: "Not enough ATV capacity." });
    
    const childPct = Number(settings.child_passenger_price_pct) / 100;
    const totalPrice = pkg.base_price * adults + pkg.base_price * childPct * children;
    const depositAmount = Math.round(totalPrice * (Number(settings.deposit_percentage) / 100) * 100) / 100;
    const balanceDue = Math.round((totalPrice - depositAmount) * 100) / 100;
    
    db.prepare(`UPDATE bookings SET adult_count=?, child_count=?, total_price=?, deposit_amount=?, balance_due=?, updated_at=datetime('now') WHERE id=?`).run(adults, children, totalPrice, depositAmount, balanceDue, booking.id);
    return res.json(getBookingWithDetails(booking.id));
  }
  return res.status(400).json({ error: "Unsupported action." });
});

router.post("/:id/refund", requireRole("admin"), (req, res) => {
  const booking = getBookingWithDetails(req.params.id);
  if (!booking) return res.status(404).json({ error: "Booking not found." });
  const verifiedPayment = db.prepare("SELECT * FROM payments WHERE booking_id = ? AND status = 'verified' ORDER BY created_at DESC LIMIT 1").get(booking.id);
  if (!verifiedPayment) return res.status(409).json({ error: "No verified payment exists." });

  const { amount, reason } = req.body;
  const refundAmount = amount != null ? Number(amount) : verifiedPayment.amount;
  db.prepare("UPDATE payments SET status='refunded', notes=? WHERE id=?").run(`Refunded RM${refundAmount.toFixed(2)}. Reason: ${reason || "n/a"}`, verifiedPayment.id);
  db.prepare("UPDATE bookings SET status='refunded', cancel_reason=?, updated_at=datetime('now') WHERE id=?").run(reason || "Refunded by Admin", booking.id);
  res.json(getBookingWithDetails(booking.id));
});

router.post("/:id/send-confirmation", requireRole("admin"), (req, res) => {
  const booking = getBookingWithDetails(req.params.id);
  if (!booking || booking.status !== "confirmed") return res.status(409).json({ error: "Only confirmed bookings can have a confirmation sent." });
  const message = `Hi ${booking.customer_name}, your Rinching ATV booking is CONFIRMED. Reference: #RATV-${String(booking.id).padStart(5, "0")}`;
  const info = db.prepare("INSERT INTO notifications (booking_id, channel, message, sent_by) VALUES (?, 'email+sms', ?, ?)").run(booking.id, message, req.session.user.id);
  res.json({ notification: db.prepare("SELECT * FROM notifications WHERE id = ?").get(info.lastInsertRowid), note: "Simulated send." });
});

module.exports = router;
