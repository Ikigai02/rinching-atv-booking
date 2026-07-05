const bcrypt = require("bcryptjs");

/**
 * Seeds a freshly-created database with:
 *  - default operating settings
 *  - the 5 ride packages (A-E) described in the project proposal
 *  - one Admin account and one Marshall account (staff are not self-registered)
 *
 * NOTE: The proposal only gave exact figures for Package A (2km / ~20 mins),
 * Package C (17km / 3 hours, most popular) and Package E (28km / 6 hours to a
 * full day). Package B and D distances/durations/prices below are reasonable
 * assumptions filling the gap between A-C and C-E -- adjust them freely from
 * the Marshall/Admin side once real figures are confirmed with the business
 * owner.
 */
module.exports = function seed(db) {
  const insertSetting = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
  const settings = {
    operating_start: "09:00",
    operating_end: "18:00",
    slot_interval_minutes: "60",
    daily_atv_inventory: "10",
    deposit_percentage: "50",
    min_solo_rider_age: "16",
    min_child_passenger_age: "6",
    max_child_passengers_per_adult: "1",
    marshall_pax_ratio: "8",
    child_passenger_price_pct: "50",
  };
  for (const [k, v] of Object.entries(settings)) insertSetting.run(k, v);

  const insertPackage = db.prepare(`INSERT INTO packages
    (code, name, distance_km, duration_minutes, duration_label, base_price, is_popular, active)
    VALUES (?,?,?,?,?,?,?,1)`);
  insertPackage.run("A", "Explorer Ride", 2, 20, "~20 minutes", 60, 0);
  insertPackage.run("B", "Adventure Ride", 8, 60, "~1 hour", 100, 0);
  insertPackage.run("C", "Trailblazer Ride", 17, 180, "~3 hours", 180, 1);
  insertPackage.run("D", "Endurance Ride", 22, 270, "~4-5 hours", 250, 0);
  insertPackage.run("E", "Ultimate Expedition", 28, 360, "6 hours to a full day", 350, 0);

  const insertUser = db.prepare(`INSERT INTO users
    (name, email, phone, password_hash, role, dob, guardian_consent) VALUES (?,?,?,?,?,?,0)`);
  insertUser.run("Rinching Admin", "admin@rinchingatv.com", "011-1000 1000",
    bcrypt.hashSync("Admin@123", 10), "admin", "1990-01-01");
  insertUser.run("Rinching Marshall", "marshall@rinchingatv.com", "011-2000 2000",
    bcrypt.hashSync("Marshall@123", 10), "marshall", "1995-01-01");

  console.log("Seeded settings, packages, and default Admin/Marshall accounts.");
  console.log("  Admin:    admin@rinchingatv.com / Admin@123");
  console.log("  Marshall: marshall@rinchingatv.com / Marshall@123");
};
