// Rollen liegen in D1 (radar_user_role). ADMIN_USERS aus wrangler.toml wirkt als
// Startberechtigung, damit sich niemand aussperrt.
import { nowIso } from "./ids.js";

export const ROLES = [
  "admin",
  "product_owner",
  "country_analyst",
  "creator_scout",
  "creator_intelligence_lead",
  "creator_success_manager",
  "sales",
  "product_dev",
  "native_reviewer",
  "viewer",
];

const WRITE_ROLES = {
  "trend.label": ["admin", "product_owner", "country_analyst", "native_reviewer"],
  "creator.decide": ["admin", "product_owner", "creator_scout", "creator_intelligence_lead"],
  "creator.capture": ["admin", "creator_scout", "creator_intelligence_lead"],
  "crm.write": ["admin", "product_owner", "creator_success_manager", "creator_intelligence_lead", "sales"],
  "company.decide": ["admin", "product_owner", "sales"],
  "admin.manage": ["admin"],
};

export async function roleFor(db, env, username) {
  const admins = (env.ADMIN_USERS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (admins.includes(String(username).toLowerCase())) return "admin";
  const row = await db.first("SELECT role FROM radar_user_role WHERE username = ?", username);
  if (row) return row.role;
  await db.run(
    "INSERT OR IGNORE INTO radar_user_role (username, role, created_at, updated_at) VALUES (?, 'viewer', ?, ?)",
    username, nowIso(), nowIso()
  );
  return "viewer";
}

export function can(role, action) {
  const allowed = WRITE_ROLES[action];
  return allowed ? allowed.includes(role) : false;
}
