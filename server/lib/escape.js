/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking Thunter BOY for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
function escapeQuickbaseValue(v) {
  if (v === null) return null;
  return String(v).replace(/'/g, "''");
}

module.exports = {
  escapeQuickbaseValue
};
