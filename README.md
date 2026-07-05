# Rinching ATV Adventure Park Booking System

A full working web booking system for **Customer**, **Admin**, and **Marshall** users, built
from the Group 6 project proposal and the accompanying use case diagram / use case
descriptions. It replaces Rinching's current WhatsApp + physical logbook process with an
online booking flow, real-time ATV slot availability, deposit payments, and role-based
dashboards for staff.

## What's included

- **Node.js + Express** backend with a REST API
- **SQLite** database via Node's built-in `node:sqlite` module — no native/C++ build step,
  no external database server to install
- **Vanilla HTML/CSS/JS** frontend (no build tooling required) with pages for all three roles
- Session-based authentication with role-based access control

## Requirements

- **Node.js 22.5 or later** (needed for the built-in `node:sqlite` module). Check your version
  with `node -v`. If you're on an older Node, install the current LTS from nodejs.org.

## Setup

```bash
cd rinching-atv-booking-system
npm install
npm start
```

Then open **http://localhost:3000** in your browser. The database (`db/rinching.db`) and all
seed data are created automatically the first time you run the server.

To wipe and reseed the database at any time: `npm run reseed`.

## Default accounts

Customers register themselves from the website. Admin and Marshall are staff accounts and are
seeded automatically:

| Role     | Email                     | Password      |
|----------|---------------------------|---------------|
| Admin    | admin@rinchingatv.com     | Admin@123     |
| Marshall | marshall@rinchingatv.com  | Marshall@123  |

**Change these passwords (edit `db/seed.js` and reseed) before using this anywhere but a local
demo/coursework environment.** Also change `SESSION_SECRET` (see below) for anything beyond
local testing.

## What each role can do

**Customer** — Register Account, Login, Book Appointment (Select Date & Service → Check Slot
Availability → Pay Deposit → Process Payment → Confirm Booking), view My Bookings.

**Admin** — Login, Verify Payment (approve/reject bank-transfer deposits), Manage Booking
(reschedule / update rider count / cancel), Send Confirmation Email, Refund Payment, and a
Daily Operations Summary.

**Marshall** — Login, Manage Appointment Schedule (operating hours, ATV inventory, pricing
rules), block full days (maintenance/weather), block individual time slots (Update Appointment
Slot), and the same Daily Operations Summary used to plan how many Marshalls are needed.

This mirrors the use case diagram and use case description document produced earlier in this
project.

## How booking/availability actually works

- Each package (A–E) has a fixed **duration**. A booking's time slot blocks that many ATVs for
  that whole duration, not just the start minute — so a 3-hour Package C booking at 09:00
  correctly overlaps a 10:00 start time too.
- Real-time availability = `daily_atv_inventory` (Marshall-configurable) minus the ATVs already
  held/confirmed for any overlapping time window that day.
- A new booking is placed on a **15-minute hold** (matches the proposal's "temp-hold slot"
  step). If the customer doesn't complete payment in time, the hold auto-expires and the slot
  frees up again.
- **Card payment** is a simulated instant gateway (auto-verified) since no real payment
  processor is configured in this demo. **Bank transfer** mirrors Rinching's current process:
  the customer submits a reference number and the booking sits as `pending_verification` until
  Admin approves it from the dashboard — this is the same "customer sends receipt in WhatsApp,
  Admin verifies" step from the AS-IS process, just digitized.
- "Send Confirmation Email" is deliberately an **Admin-triggered** action (per the latest use
  case diagram), not an automatic customer-side step. It's simulated — it writes a
  notification record and returns the message text, since no real email/SMS provider
  (SendGrid, Twilio, etc.) is wired up. Swap in a real provider inside
  `routes/bookings.js` (`/:id/send-confirmation`) when you're ready to go live.

## Assumptions made (please confirm with the business owner)

The proposal only gave exact figures for Package A (2km / ~20 min), Package C (17km / 3 hrs,
most popular), and Package E (28km / 6 hrs–full day). Everything below is a placeholder you can
change instantly from the **Marshall → Schedule Settings** tab (or by editing `db/seed.js` and
reseeding) without touching any code:

| Setting | Default | Notes |
|---|---|---|
| Package B | 8km / ~1 hour / RM100 | Not specified in the proposal — estimated between A and C |
| Package D | 22km / ~4–5 hours / RM250 | Not specified in the proposal — estimated between C and E |
| Package A / C / E price | RM60 / RM180 / RM350 | Not specified — placeholder pricing |
| Deposit | 50% of total | Matches the proposal |
| Child passenger price | 50% of adult price | Assumption |
| Min. solo rider age | 16 | Assumption — confirm actual park policy |
| Min. child passenger age | 6 | Assumption — confirm actual park policy |
| Max child passengers per adult ATV | 1 | Assumption |
| Daily ATV inventory | 10 | Assumption — set to Rinching's actual fleet size |
| Operating hours | 09:00–18:00 | Matches the proposal's peak windows (9–11, 2–5) |
| Marshall-to-pax ratio | 1 Marshall per 8 pax | Assumption used for the "Marshalls needed" summary |

## Project structure

```
server.js                 Express app entry point
db/schema.sql             SQLite schema
db/seed.js                Seed data (packages, settings, Admin/Marshall accounts)
db/database.js            DB connection + auto-init on first run
lib/scheduling.js         Shared availability / capacity / hold-expiry logic
middleware/auth.js        Session + role-based route guards
routes/auth.js            Register, login, logout, session check
routes/packages.js        Public package listing
routes/bookings.js        Booking wizard, payment, verify, manage, refund, confirmation
routes/schedule.js        Marshall schedule settings, blocked dates, slot overrides, summary
public/                   Static frontend (Customer, Admin, Marshall pages)
```

## Known limitations (this is a coursework-scope prototype)

- Payment gateway and email/SMS sending are **simulated**, not connected to real providers.
- Session storage is in-memory (`express-session` MemoryStore) — sessions reset if the server
  restarts, and this does not scale to multiple server instances. Fine for local/coursework use;
  swap in a proper session store (Redis, etc.) for production.
- No password-reset flow, no file/image uploads (e.g. IC photo, payment receipt image).
- Single currency (RM) and single timezone assumed.
