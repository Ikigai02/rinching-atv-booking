// Minimal .env file loader (no dependency needed for this small a job).
// Reads KEY=VALUE lines from a .env file at the project root into
// process.env, without overwriting variables already set in the real
// environment (e.g. by the shell or a hosting platform).
const fs = require("fs");
const path = require("path");

function loadEnvFile(filePath = path.join(__dirname, "..", ".env")) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

module.exports = { loadEnvFile };
