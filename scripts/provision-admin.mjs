#!/usr/bin/env node
/**
 * Apply ADMIN_EMAIL / ADMIN_PASSWORD from .env.local to the Convex deployment.
 *
 * Creates the administrator if there is none, otherwise resets that account's
 * password and revokes its live sessions. Safe to re-run.
 *
 * The work happens in the `auth:provisionAdmin` internal action, which only the
 * Convex CLI and dashboard can call — so deploy access is the authorization,
 * and this stays usable when the administrator password has been lost.
 *
 *   npm run provision:admin
 *   npm run provision:admin -- --generate    # write a fresh strong password
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";

const ENV_FILE = ".env.local";

// Same alphabet the app uses for generated passwords: no 0/O/1/l/I, so a
// password can be read off a screen and typed without ambiguity.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function generatePassword(groups = 6, groupSize = 5) {
  const bytes = randomBytes(groups * groupSize);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  return Array.from({ length: groups }, (_, i) =>
    chars.slice(i * groupSize, (i + 1) * groupSize).join("")
  ).join("-");
}

/** Minimal dotenv read — we only need flat KEY=value lines. */
function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    out[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

function upsertEnvLine(text, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^\\s*${key}\\s*=.*$`, "m");
  if (pattern.test(text)) return text.replace(pattern, line);
  return `${text.replace(/\s*$/, "")}\n\n${line}\n`;
}

if (!existsSync(ENV_FILE)) {
  console.error(`${ENV_FILE} not found. Copy .env.example to ${ENV_FILE} first.`);
  process.exit(1);
}

let raw = readFileSync(ENV_FILE, "utf8");
let env = parseEnv(raw);

if (process.argv.includes("--generate") || !env.ADMIN_PASSWORD) {
  const password = generatePassword();
  raw = upsertEnvLine(raw, "ADMIN_PASSWORD", password);
  if (!env.ADMIN_EMAIL) raw = upsertEnvLine(raw, "ADMIN_EMAIL", "admin@example.com");
  writeFileSync(ENV_FILE, raw);
  env = parseEnv(raw);
  console.log(`Wrote a new ADMIN_PASSWORD to ${ENV_FILE}:\n\n  ${password}\n`);
}

if (!env.ADMIN_EMAIL) {
  console.error(`ADMIN_EMAIL is not set in ${ENV_FILE}.`);
  process.exit(1);
}

const args = {
  email: env.ADMIN_EMAIL,
  password: env.ADMIN_PASSWORD,
  ...(env.ADMIN_NAME ? { name: env.ADMIN_NAME } : {}),
};

// Run the CLI's entry point under this same node, rather than going through
// npx: the password travels as an argv entry, never inside a shell string, and
// Node refuses to spawn a .cmd shim without shell:true anyway.
// bin/main.js is not in the package's `exports` map, so it cannot be resolved
// by name — walk up for it instead, which also handles a hoisted node_modules.
function findConvexCli(from) {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", "convex", "bin", "main.js");
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) return null;
  }
}

const cli = findConvexCli(process.cwd());
if (!cli) {
  console.error("Could not find the Convex CLI. Run `npm install` first.");
  process.exit(1);
}
const run = spawnSync(
  process.execPath,
  [cli, "run", "auth:provisionAdmin", JSON.stringify(args)],
  { stdio: "inherit" }
);
if (run.error) {
  console.error(`Could not run the Convex CLI: ${run.error.message}`);
  process.exit(1);
}
if (run.status !== 0) process.exit(run.status ?? 1);

console.log(`\nAdministrator ${env.ADMIN_EMAIL} is ready. Sign in at /login.`);
