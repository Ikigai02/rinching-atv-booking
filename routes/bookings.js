const express = require("express");
const db = require("../db/database");
const { requireLogin, requireRole } = require("../middleware/auth");
const sched = require("../lib/scheduling");
const toyyibpay = require("../lib/payments/toyyibpay");

const router = express.Router();

function appBaseUrl() {
  return (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, "");
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

// ---------------------------------------------------------------------------
// GET /api/bookings/booking-window
// ---------------------------------------------------------------------------
router.get("/booking-window", (req, res) => {
  const settings = sched.getSettings();
  res.json({
    minDate: sched.getMinBookingDate(settings),
    minAdvanceDays: Number(settings.min_advance_booking_days),
  });
});

// ---------------------------------------------------------------------------
// GET /api/bookings/availability
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// POST /api/bookings (Book Appointment)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// POST /api/bookings/:id/pay (Payment Processing)
// ---------------------------------------------------------------------------
router.post("/:id/pay", requireRole("customer"), async (req, res) => {
  try {
    sched.expireStaleHolds();
    const booking = getBookingWithDetails(req.params.id);
    if (!booking || booking.customer_id !== req.session.user.id) return res.status(404).json({ error: "Booking not found." });
    
    const { method, reference } = req.body;
    if (method === "toyyibpay") {
      const base = appBaseUrl();
      // FIX: Use encodeURIComponent to ensure URL is safe and valid for toyyibPay
      const returnUrl = `${base}/payment-return.html?booking=${encodeURIComponent(booking.id)}`;
      const callbackUrl = `${base}/api/bookings/payment-callback`;

      const { billCode, redirectUrl } = await toyyibpay.createBill({
        db,
        amount: booking.deposit_amount,
        bookingId: booking.id,
        packageLabel: `${booking.package_code} ${booking.package_name}`,
        bookingDate: booking.booking_date,
        customerName: booking.customer_name,
        customerEmail: booking.customer_email,
        customerPhone: booking.customer_phone,
        returnUrl: returnUrl,
        callbackUrl: callbackUrl,
      });

      db.prepare("INSERT INTO payments (booking_id, amount, method, reference, status, notes) VALUES (?, ?, 'toyyibpay', ?, 'pending', 'Awaiting payment')")
        .run(booking.id, booking.deposit_amount, billCode);
      return res.status(201).json({ billCode, redirectUrl, booking: getBookingWithDetails(booking.id) });
    }
    // ... (rest of method == 'card' or 'bank_transfer' logic remains same)
    res.json({ booking: getBookingWithDetails(booking.id) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Other routes (callback, status, etc.) remain as they were in your previous code
// ---------------------------------------------------------------------------
// ... (Include payment-callback, payment-status, etc. here)

module.exports = router;
