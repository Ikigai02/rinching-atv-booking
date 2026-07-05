const express = require("express");
const db = require("../db/database");

const router = express.Router();

router.get("/", (req, res) => {
  const rows = db
    .prepare("SELECT * FROM packages WHERE active = 1 ORDER BY distance_km ASC")
    .all();
  res.json(rows);
});

module.exports = router;
