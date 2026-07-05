require("./lib/env").loadEnvFile(); // loads .env (e.g. TOYYIBPAY_SECRET_KEY) if present

const express = require("express");
const session = require("express-session");
const path = require("path");

require("./db/database"); // creates + seeds db/rinching.db on first run

const authRoutes = require("./routes/auth");
const packageRoutes = require("./routes/packages");
const bookingRoutes = require("./routes/bookings");
const scheduleRoutes = require("./routes/schedule");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: false })); // toyyibPay posts form-urlencoded callbacks
app.use(
  session({
    secret: process.env.SESSION_SECRET || "rinching-atv-dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 }, // 8 hours
  })
);

app.use("/api/auth", authRoutes);
app.use("/api/packages", packageRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/schedule", scheduleRoutes);

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`Rinching ATV Booking System running at http://localhost:${PORT}`);
});
