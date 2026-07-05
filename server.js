require("./lib/env").loadEnvFile(); // loads .env if present

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

// Set the base URL dynamically
// On Render, set the environment variable BASE_URL to 'https://rinching-atv-booking.onrender.com'
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

app.use(express.json());
app.use(express.urlencoded({ extended: false })); 

app.use(
  session({
    secret: process.env.SESSION_SECRET || "rinching-atv-dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 },
  })
);

app.use("/api/auth", authRoutes);
app.use("/api/packages", packageRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/schedule", scheduleRoutes);

app.use(express.static(path.join(__dirname, "public")));

// IMPORTANT: Make the BASE_URL available to your frontend/routes
app.use((req, res, next) => {
  res.locals.BASE_URL = BASE_URL;
  next();
});

app.listen(PORT, () => {
  console.log(`Rinching ATV Booking System running at ${BASE_URL}`);
});
