import { uuidv7, nowIso } from "./ids.js";

export async function audit(db, { username, action, subjectType, subjectId, detail }) {
  try {
    await db.run(
      "INSERT INTO audit_log (id, username, action, subject_type, subject_id, detail, created_at) VALUES (?,?,?,?,?,?,?)",
      uuidv7(),
      username || null,
      action,
      subjectType || null,
      subjectId || null,
      detail ? JSON.stringify(detail) : null,
      nowIso()
    );
  } catch (e) {
    console.log("audit_failed", action, e && e.message);
  }
}
