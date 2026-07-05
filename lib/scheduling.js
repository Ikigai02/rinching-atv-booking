const db = require("../db/database");

/** Read all settings rows into a plain object. */
function getSettings() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

function updateSettings(patch) {
  const stmt = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
  );
  db.transaction(() => {
    for (const [k, v] of Object.entries(patch)) stmt.run(k, String(v));
  });
}

/** Any 'hold' booking whose 15-minute window has passed is auto-expired,
 *  freeing its ATV capacity back up for other customers. */
function expireStaleHolds() {
  db.prepare(
    `UPDATE bookings SET status='expired', updated_at=datetime('now')
     WHERE status='hold' AND hold_expires_at IS NOT NULL AND hold_expires_at < datetime('now')`
  ).run();
}

function hhmmToMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function minutesToHHMM(mins) {
  const h = Math.floor(mins / 60)
    .toString()
    .padStart(2, "0");
  const m = (mins % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

/** All valid ride start times for a package's duration, given operating hours. */
function getCandidateStartTimes(settings, durationMinutes) {
  const startMin = hhmmToMinutes(settings.operating_start);
  const endMin = hhmmToMinutes(settings.operating_end);
  const interval = Number(settings.slot_interval_minutes);
  const times = [];
  for (let t = startMin; t + durationMinutes <= endMin; t += interval) {
    times.push(minutesToHHMM(t));
  }
  return times;
}

/** Earliest date (YYYY-MM-DD) a customer is allowed to book, based on the
 *  configurable `min_advance_booking_days` setting (default 7 - Rinching
 *  requires bookings to be made at least a week ahead). */
function getMinBookingDate(settings) {
  const days = Number((settings || getSettings()).min_advance_booking_days || 0);
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function isDateBlocked(date) {
  const row = db.prepare("SELECT * FROM schedule_blocks WHERE block_date = ?").get(date);
  return row || null;
}

function isSlotBlocked(date, timeSlot) {
  const row = db
    .prepare("SELECT * FROM slot_overrides WHERE block_date = ? AND time_slot = ? AND blocked = 1")
    .get(date, timeSlot);
  return !!row;
}

/** Sum of ATVs already committed (hold/pending_verification/confirmed) that
 *  overlap the requested [startMin, endMin) window on `date`. Excludes a
 *  given booking id (used when re-checking a booking being rescheduled). */
function computeAtvUsage(date, startMin, endMin, excludeBookingId) {
  const rows = db
    .prepare(
      `SELECT b.id, b.adult_count, b.time_slot, p.duration_minutes
       FROM bookings b JOIN packages p ON p.id = b.package_id
       WHERE b.booking_date = ?
         AND b.status IN ('hold','pending_verification','confirmed')`
    )
    .all(date);

  let used = 0;
  for (const row of rows) {
    if (excludeBookingId && row.id === excludeBookingId) continue;
    const bStart = hhmmToMinutes(row.time_slot);
    const bEnd = bStart + row.duration_minutes;
    const overlaps = bStart < endMin && startMin < bEnd;
    if (overlaps) used += row.adult_count;
  }
  return used;
}

/** Full availability listing for a date + package: each candidate start time
 *  with remaining ATV capacity, respecting blocked days/slots. */
function getAvailability(date, pkg) {
  expireStaleHolds();
  const settings = getSettings();
  const inventory = Number(settings.daily_atv_inventory);
  const minDate = getMinBookingDate(settings);
  if (date < minDate) {
    return {
      blockedDay: `Bookings must be made at least ${settings.min_advance_booking_days} day(s) in advance. Earliest available date is ${minDate}.`,
      slots: [],
    };
  }
  const blockedDay = isDateBlocked(date);
  if (blockedDay) {
    return { blockedDay: blockedDay.reason || "Unavailable", slots: [] };
  }
  const candidates = getCandidateStartTimes(settings, pkg.duration_minutes);
  const slots = candidates
    .filter((t) => !isSlotBlocked(date, t))
    .map((t) => {
      const startMin = hhmmToMinutes(t);
      const endMin = startMin + pkg.duration_minutes;
      const used = computeAtvUsage(date, startMin, endMin);
      return { time: t, remaining: Math.max(0, inventory - used) };
    })
    .filter((s) => s.remaining > 0);
  return { blockedDay: null, slots };
}

module.exports = {
  getSettings,
  updateSettings,
  expireStaleHolds,
  hhmmToMinutes,
  minutesToHHMM,
  getCandidateStartTimes,
  getMinBookingDate,
  isDateBlocked,
  isSlotBlocked,
  computeAtvUsage,
  getAvailability,
};
