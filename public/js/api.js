// Shared fetch wrapper + auth/nav helpers used by every page.

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    /* no body */
  }
  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  return data;
}

async function getCurrentUser() {
  return api("/auth/me");
}

/** Redirects to /login.html unless the current session matches one of `roles`.
 *  Pass no roles to just require "any logged-in user". */
async function guardPage(roles) {
  const user = await getCurrentUser();
  if (!user || (roles && roles.length && !roles.includes(user.role))) {
    window.location.href = "/login.html";
    return null;
  }
  renderNav(user);
  return user;
}

function roleHome(role) {
  if (role === "admin") return "/admin/dashboard.html";
  if (role === "marshall") return "/marshall/dashboard.html";
  return "/book.html";
}

function renderNav(user) {
  const el = document.getElementById("navbar");
  if (!el) return;
  const links = [];
  if (!user) {
    links.push('<a class="pill" href="/login.html">Login</a>');
    links.push('<a class="pill" href="/register.html">Register</a>');
  } else if (user.role === "customer") {
    links.push('<a href="/book.html">Book a Ride</a>');
    links.push('<a href="/my-bookings.html">My Bookings</a>');
    links.push(`<span class="muted" style="color:#cfe0ff">${user.name}</span>`);
    links.push('<button class="pill" id="logoutBtn">Log out</button>');
  } else if (user.role === "admin") {
    links.push('<a href="/admin/dashboard.html">Admin Dashboard</a>');
    links.push(`<span class="muted" style="color:#cfe0ff">${user.name} (Admin)</span>`);
    links.push('<button class="pill" id="logoutBtn">Log out</button>');
  } else if (user.role === "marshall") {
    links.push('<a href="/marshall/dashboard.html">Marshall Dashboard</a>');
    links.push(`<span class="muted" style="color:#cfe0ff">${user.name} (Marshall)</span>`);
    links.push('<button class="pill" id="logoutBtn">Log out</button>');
  }
  el.innerHTML = `
    <div class="brand">RINCHING<span> ATV</span> ADVENTURE PARK</div>
    <nav>${links.join("")}</nav>
  `;
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await api("/auth/logout", { method: "POST" });
      window.location.href = "/index.html";
    });
  }
}

function money(n) {
  return `RM${Number(n).toFixed(2)}`;
}

function fmtDate(d) {
  return new Date(d + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" });
}

function statusLabel(s) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function showAlert(container, message, type = "error") {
  container.innerHTML = `<div class="alert ${type}">${message}</div>`;
}
