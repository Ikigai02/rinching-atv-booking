const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db/database");

const router = express.Router();

function calculateAge(dobStr) {
  const dob = new Date(dobStr);
  if (isNaN(dob.getTime())) return null;
  const diffMs = Date.now() - dob.getTime();
  return Math.floor(diffMs / (365.25 * 24 * 3600 * 1000));
}

// Public self-registration is for Customers only. Admin/Marshall are staff
// accounts provisioned directly in the database (see db/seed.js).
router.post("/register", (req, res) => {
  const { name, email, phone, password, dob, guardian_consent } = req.body;
  if (!name || !email || !password || !dob) {
    return res.status(400).json({ error: "Name, email, date of birth, and password are required." });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }
  const age = calculateAge(dob);
  if (age === null) return res.status(400).json({ error: "Invalid date of birth." });
  if (age < 16 && !guardian_consent) {
    return res.status(400).json({
      error: "Customers under 16 years old must confirm guardian consent to register.",
    });
  }
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) return res.status(409).json({ error: "This email is already registered." });

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare(
      `INSERT INTO users (name, email, phone, password_hash, role, dob, guardian_consent)
       VALUES (?, ?, ?, ?, 'customer', ?, ?)`
    )
    .run(name, email, phone || null, hash, dob, guardian_consent ? 1 : 0);

  req.session.user = { id: info.lastInsertRowid, name, role: "customer", email };
  res.json(req.session.user);
});

router.post("/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password." });
  }
  req.session.user = { id: user.id, name: user.name, role: user.role, email: user.email };
  res.json(req.session.user);
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get("/me", (req, res) => {
  res.json(req.session.user || null);
});

module.exports = router;
