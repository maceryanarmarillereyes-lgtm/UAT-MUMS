/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Do not modify existing UI/UX, layouts, or core logic in this file without explicitly asking Thunter BOY for clearance. If changes are required here, STOP and provide a RISK IMPACT REPORT first. */
/**
 * api/monitoring.js
 * Vercel Serverless function that returns Quickbase monitoring records.
 * Uses env vars: QB_REALM, QB_USER_TOKEN, QB_TABLE_ID
 */
const { queryRecords } = require('../quickbaseClient');

module.exports = async (req, res) => {
  try {
    const tableId = process.env.QB_TABLE_ID;
    if (!tableId) return res.status(500).json({ ok: false, error: 'QB_TABLE_ID missing' });

    const where = req.query.where || '';
    const data = await queryRecords(tableId, where);
    const records = (data.data || []).map(r => ({
      qbRecordId: r.recordId,
      fields: r.fields
    }));
    res.status(200).json({ ok: true, records });
  } catch (err) {
    console.error('Quickbase read error', err?.response?.data || err.message);
    res.status(500).json({ ok: false, error: 'failed to read quickbase' });
  }
};
