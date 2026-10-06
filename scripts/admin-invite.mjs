#!/usr/bin/env node
/**
 * Creates (or re-invites) an admin team member and prints a one-time invitation link.
 * The person opens the link, chooses a password, then confirms with a code sent by email.
 *
 *   npm run admin:invite -- --email ilyas@example.com --name Ilyas --role owner
 *   npm run admin:invite -- --email ilyas@example.com --name Ilyas --role owner --remote --origin https://henine.xxx.workers.dev
 *
 * Roles: owner, manager, confirmation, fulfilment, marketing, readonly
 */
import { execSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
    return acc;
  }, []),
);
const email = String(args.email ?? "").trim().toLowerCase();
const name = String(args.name ?? "").trim();
const role = String(args.role ?? "owner");
const remote = args.remote === true;
const origin = String(args.origin ?? "http://127.0.0.1:8787").replace(/\/$/, "");

if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || name.length < 2) {
  console.error("Usage: npm run admin:invite -- --email you@example.com --name \"Ilyas\" [--role owner] [--remote --origin https://…]");
  process.exit(1);
}
if (!["owner", "manager", "confirmation", "fulfilment", "marketing", "readonly"].includes(role)) {
  console.error(`Unknown role "${role}"`);
  process.exit(1);
}

const token = randomBytes(32).toString("hex");
const tokenHash = createHash("sha256").update(token).digest("hex");
const now = Date.now();
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const sql = [
  `INSERT INTO team_members (email, name, role_id, is_active, created_at) SELECT ${q(email)}, ${q(name)}, id, 1, ${now} FROM roles WHERE key = ${q(role)}
     ON CONFLICT(email) DO UPDATE SET name = excluded.name, role_id = excluded.role_id, is_active = 1;`,
  `DELETE FROM auth_challenges WHERE purpose = 'invite_link' AND member_id = (SELECT id FROM team_members WHERE email = ${q(email)});`,
  `INSERT INTO auth_challenges (id, member_id, purpose, code_hash, expires_at, created_at)
     SELECT ${q(tokenHash)}, id, 'invite_link', '', ${now + 7 * 86400_000}, ${now} FROM team_members WHERE email = ${q(email)};`,
].join("\n");

const workerDir = join(dirname(fileURLToPath(import.meta.url)), "../apps/worker");
// SQL goes through a temp file: passing it as an argument breaks on Windows shells
const dir = mkdtempSync(join(tmpdir(), "henine-invite-"));
const file = join(dir, "invite.sql");
writeFileSync(file, sql);
try {
  execSync(`npx wrangler d1 execute DB ${remote ? "--remote" : "--local"} --file "${file}"`, { cwd: workerDir, stdio: ["ignore", "ignore", "inherit"] });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n✓ ${name} <${email}> (${role}) invited.\n\nInvitation link (valid 7 days, single use):\n${origin}/admin/invitation?token=${token}\n`);
