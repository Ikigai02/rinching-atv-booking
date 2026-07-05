-- Rinching ATV Adventure Park Booking System - database schema (SQLite)

CREATE TABLE users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,
  phone           TEXT,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL CHECK(role IN ('customer','admin','marshall')),
  dob             TEXT,
  guardian_consent INTEGER DEFAULT 0,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE packages (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  code             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  distance_km      REAL NOT NULL,
  duration_minutes INTEGER NOT NULL,
  duration_label   TEXT NOT NULL,
  base_price       REAL NOT NULL,
  is_popular       INTEGER DEFAULT 0,
  active           INTEGER DEFAULT 1
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE schedule_blocks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  block_date TEXT NOT NULL UNIQUE,
  reason     TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE slot_overrides (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  block_date TEXT NOT NULL,
  time_slot  TEXT NOT NULL,
  blocked    INTEGER DEFAULT 1,
  reason     TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(block_date, time_slot)
);

CREATE TABLE bookings (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id      INTEGER NOT NULL REFERENCES users(id),
  package_id       INTEGER NOT NULL REFERENCES packages(id),
  booking_date     TEXT NOT NULL,
  time_slot        TEXT NOT NULL,
  adult_count      INTEGER NOT NULL DEFAULT 1,
  child_count      INTEGER NOT NULL DEFAULT 0,
  total_price      REAL NOT NULL,
  deposit_amount   REAL NOT NULL,
  balance_due      REAL NOT NULL,
  status           TEXT NOT NULL DEFAULT 'hold' CHECK(status IN
                     ('hold','pending_verification','confirmed','payment_failed',
                      'payment_rejected','cancelled','expired','completed','refunded')),
  hold_expires_at  TEXT,
  ack_age_policy   INTEGER DEFAULT 0,
  ack_refund_policy INTEGER DEFAULT 0,
  cancel_reason    TEXT,
  created_at       TEXT DEFAULT (datetime('now')),
  updated_at       TEXT DEFAULT (datetime('now'))
);

CREATE TABLE payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id   INTEGER NOT NULL REFERENCES bookings(id),
  amount       REAL NOT NULL,
  method       TEXT NOT NULL CHECK(method IN ('card','bank_transfer','toyyibpay')),
  reference    TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK(status IN
                 ('pending','verified','failed','rejected','refunded')),
  verified_by  INTEGER REFERENCES users(id),
  verified_at  TEXT,
  notes        TEXT,
  created_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  channel    TEXT NOT NULL,
  message    TEXT NOT NULL,
  sent_by    INTEGER REFERENCES users(id),
  sent_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_bookings_date ON bookings(booking_date);
CREATE INDEX idx_bookings_customer ON bookings(customer_id);
CREATE INDEX idx_payments_booking ON payments(booking_id);
