const express = require("express");
const db = require("../db/database");
const { requireRole } = require("../middleware/auth");
const sched = require("../lib/scheduling");

const router = express.Router();

// ---------------------------------------------------------------------------
// GET/PUT /api/schedule/settings -> "Manage Appointment Schedule"
// ---------------------------------------------------------------------------
router.get("/settings", requireRole("admin", "marshall"), (req, res) => {
  res.json(sched.getSettings());
});

router.put("/settings", requireRole("marshall"), (req, res) => {
  const allowedKeys = [
    "operating_start",
    "operating_end",
    "slot_interval_minutes",
    "daily_atv_inventory",
    "deposit_percentage",
    "min_solo_rider_age",
    "min_child_passenger_age",
    "max_child_passengers_per_adult",
    "marshall_pax_ratio",
    "child_passenger_price_pct",
  ];
  const patch = {};
  for (const k of allowedKeys) {
    if (req.body[k] !== undefined && req.body[k] !== "") patch[k] = req.body[k];
  }
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: "No valid settings provided." });
  sched.updateSettings(patch);
  res.json(sched.getSettings());
});

// ---------------------------------------------------------------------------
// Blocked (fully closed) dates - e.g. maintenance day, public holiday, storm
// ---------------------------------------------------------------------------
router.get("/blocks", requireRole("admin", "marshall"), (req, res) => {
  res.json(db.prepare("SELECT * FROM schedule_blocks ORDER BY block_date ASC").all());
});

router.post("/blocks", requireRole("marshall"), (req, res) => {
  const { date, reason } = req.body;
  if (!date) return res.status(400).json({ error: "date is required." });
  try {
    const info = db
      .prepare("INSERT INTO schedule_blocks (block_date, reason, created_by) VALUES (?, ?, ?)")
      .run(date, reason || null, req.session.user.id);
    res.status(201).json(db.prepare("SELECT * FROM schedule_blocks WHERE id = ?").get(info.lastInsertRowid));
  } catch (e) {
    res.status(409).json({ error: "That date is already blocked." });
  }
});

router.delete("/blocks/:id", requireRole("marshall"), (req, res) => {
  db.prepare("DELETE FROM schedule_blocks WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Slot-level overrides -> "Update Appointment Slot"
// e.g. block a single time slot on a single date (ATV under maintenance).
// ---------------------------------------------------------------------------
router.get("/slot-overrides", requireRole("admin", "marshall"), (req, res) => {
  const { date } = req.query;
  if (date) {
    return res.json(db.prepare("SELECT * FROM slot_overrides WHERE block_date = ? ORDER BY time_slot ASC").all(date));
  }
  res.json(db.prepare("SELECT * FROM slot_overrides ORDER BY block_date ASC, time_slot ASC").all());
});

router.post("/slot-overrides", requireRole("marshall"), (req, res) => {
  const { date, time_slot, blocked = true, reason } = req.body;
  if (!date || !time_slot) return res.status(400).json({ error: "date and time_slot are required." });
  db.prepare(
    `INSERT INTO slot_overrides (block_date, time_slot, blocked, reason, created_by)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(block_date, time_slot) DO UPDATE SET blocked=excluded.blocked, reason=excluded.reason`
  ).run(date, time_slot, blocked ? 1 : 0, reason || null, req.session.user.id);
  res.status(201).json(db.prepare("SELECT * FROM slot_overrides WHERE block_date=? AND time_slot=?").get(date, time_slot));
});

router.delete("/slot-overrides/:id", requireRole("marshall"), (req, res) => {
  db.prepare("DELETE FROM slot_overrides WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /api/schedule/day-summary?date=YYYY-MM-DD
// Powers the "Automated Dashboard Update" / resource-allocation benefit:
// total pax, ATV usage, and a suggested Marshall headcount for the day.
// ---------------------------------------------------------------------------
router.get("/day-summary", requireRole("admin", "marshall"), (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: "date is required." });
  sched.expireStaleHolds();

  const bookings = db
    .prepare(
      `SELECT b.*, p.code AS package_code, p.name AS package_name, p.duration_minutes, p.duration_label,
              u.name AS customer_name
       FROM bookings b
       JOIN packages p ON p.id = b.package_id
       JOIN users u ON u.id = b.customer_id
       WHERE b.booking_date = ? AND b.status IN ('hold','pending_verification','confirmed')
       ORDER BY b.time_slot ASC`
    )
    .all(date);

  const settings = sched.getSettings();
  const totalPax = bookings.reduce((s, b) => s + b.adult_count + b.child_count, 0);
  const totalAtvs = bookings.reduce((s, b) => s + b.adult_count, 0);
  const marshallsNeeded = Math.max(1, Math.ceil(totalPax / Number(settings.marshall_pax_ratio)));
  const blockedDay = sched.isDateBlocked(date);

  res.json({
    date,
    blockedDay: blockedDay ? blockedDay.reason || "Closed" : null,
    bookings,
    totalPax,
    totalAtvsInUse: totalAtvs,
    atvInventory: Number(settings.daily_atv_inventory),
    marshallsNeeded,
  });
});

module.exports = router;
