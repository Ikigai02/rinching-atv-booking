const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs = require("fs");

const DB_PATH = path.join(__dirname, "rinching.db");
const isNew = !fs.existsSync(DB_PATH) || fs.statSync(DB_PATH).size === 0;

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA foreign_keys = ON;");

// Migration Logic: Check if ack_waiver exists, if not, add it.
function migrate() {
  try {
    // Get list of columns in bookings table
    const columns = db.prepare("PRAGMA table_info(bookings)").all();
    const hasWaiver = columns.some(col => col.name === 'ack_waiver');
    
    if (!hasWaiver) {
      console.log("Migration: Adding ack_waiver column to bookings table...");
      db.exec("ALTER TABLE bookings ADD COLUMN ack_waiver INTEGER DEFAULT 0;");
    }
  } catch (err) {
    console.error("Migration check failed (this is normal if table doesn't exist yet):", err.message);
  }
}

// Synchronous transaction helper
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
  console.log("Database created and seeded.");
} else {
  // Always run migration check on existing database
  migrate();
}

module.exports = db;