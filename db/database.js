// Uses Node's built-in `node:sqlite` module (available from Node.js 22.5+)
// so the project runs with zero native/C++ build steps -- just `npm install`.
const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs = require("fs");

const DB_PATH = path.join(__dirname, "rinching.db");
// Treat a missing OR empty (0-byte) file as "new" so the schema/seed always
// run against a genuinely fresh database.
const isNew = !fs.existsSync(DB_PATH) || fs.statSync(DB_PATH).size === 0;

const db = new DatabaseSync(DB_PATH);
// NOTE: journal_mode is intentionally left at SQLite's default (DELETE) rather
// than WAL -- WAL requires shared-memory mmap support that some network/
// container-mounted filesystems reject with "disk I/O error". DELETE mode
// works everywhere and is plenty fast for this app's traffic level.
db.exec("PRAGMA foreign_keys = ON;");

// Thin helper so the rest of the app can do simple manual transactions
// (node:sqlite's DatabaseSync has no built-in db.transaction() helper).
db.transaction = function runInTransaction(fn) {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
};

if (isNew) {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  db.exec(schema);
  require("./seed")(db);
  console.log("Database created at db/rinching.db and seeded with defaults.");
} else {
  // Backfill any settings keys added in later versions of this app so an
  // existing (already-seeded) database doesn't need a full reseed every
  // time a new configurable rule is introduced.
  const defaults = {
    min_advance_booking_days: "7",
  };
  const stmt = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  for (const [k, v] of Object.entries(defaults)) stmt.run(k, v);
}

module.exports = db;
