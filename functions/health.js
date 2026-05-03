/**
 * @file health.js
 * @description Health-check endpoint — returns 200 OK with build timestamp
 * @module MUMS/API
 * @version UAT
 */
/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Do not modify existing UI/UX, layouts, or core logic in this file without explicitly asking MACE for clearance. If changes are required here, STOP and provide a RISK IMPACT REPORT first. */
export async function onRequest() {
  return new Response('ok', {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}
