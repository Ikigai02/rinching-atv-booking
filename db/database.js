const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs = require("fs");

const DB_PATH = path.join(__dirname, "rinching.db");
const isNew = !fs.existsSync(DB_PATH) || fs.statSync(DB_PATH).size === 0;

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA foreign_keys = ON;");

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
}

module.exports = db;
