/**
 * @file crypto.js
 * @description Server-side crypto helpers — hashing and token generation utilities
 * @module MUMS/Server/Lib
 * @version UAT
 */
/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


const crypto = require('crypto');
function getSecret() { const env = (typeof globalThis !== 'undefined' && globalThis.__MUMS_ENV) || (typeof process !== 'undefined' && process.env) || {}; return String(env.STUDIO_SECRET_KEY || env.SUPPORT_STUDIO_SECRET || '').trim(); }
function encryptText(plain) { const text = String(plain || ''); if (!text) return ''; const secret = getSecret(); if (!secret) return text; const iv = crypto.randomBytes(12); const key = crypto.createHash('sha256').update(secret).digest(); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv); const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]); const tag = cipher.getAuthTag(); return `enc:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`; }
function decryptText(payload) { const raw = String(payload || ''); if (!raw) return ''; if (!raw.startsWith('enc:')) return raw; const secret = getSecret(); if (!secret) return ''; try { const [, ivB64, tagB64, bodyB64] = raw.split(':'); const iv = Buffer.from(ivB64, 'base64'); const tag = Buffer.from(tagB64, 'base64'); const body = Buffer.from(bodyB64, 'base64'); const key = crypto.createHash('sha256').update(secret).digest(); const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv); decipher.setAuthTag(tag); return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8'); } catch (_) { return ''; } }
module.exports = { encryptText, decryptText };
