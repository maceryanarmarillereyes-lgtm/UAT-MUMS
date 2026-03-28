# KB Download Fix — DIFF SUMMARY
**Date:** 2026-03-28
**Files Changed:** 2
**Bugs Fixed:** 4

---

## FILE 1: `server/services/quickbaseSync.js`

### FIX #2 — `normalizeUrl()` — Reject garbage URLs
**Root cause:** `new URL("1", "https://realm")` is valid JS and produced
`https://realm/1` for numeric QB field values (like Related Instructions count).

```diff
- try { return new URL(val.replace(/^\/+/, ''), `https://${realm}`).toString(); }
+ // Only accept: https:// absolute URLs or /letter QB relative paths
+ if (/^https?:\/\//i.test(val)) { try { return new URL(val).toString(); } ... }
+ if (/^\/[a-zA-Z]/.test(val)) { try { return new URL(val, base).toString(); } ... }
+ return ''; // bare numbers/words → reject
```

### FIX #3 — `mapRecordToKbItem()` — Label-based field discovery
**Root cause:** Hardcoded field IDs 9, 10, 13, 14 don't match the actual QB
table structure for Copeland's app — they were picking up wrong fields
(e.g. "Related Instruction & Template" count = "15" instead of product name).

**Added:** `findFieldByLabel(fields, patterns)` helper — searches by QB field label.

```diff
- let relatedProduct = pickFieldValue(record, 9);
- let productFamily  = pickFieldValue(record, 13) || pickFieldValue(record, 14);
+ const productFid  = findFieldByLabel(fields, /related\s*product|product\s*name/i);
+ const familyFid   = findFieldByLabel(fields, /product\s*family|\bfamily\b/i);
+ let relatedProduct = productFid ? pickFieldValue(record, productFid) : '';
+ let productFamily  = familyFid  ? pickFieldValue(record, familyFid)  : '';
```

Same pattern applied to: `title`, `docNumber`, `type`.

### FIX #4 — `pickFieldValue()` — QB file attachment `versions[]` support
**Root cause:** QB REST v1 file attachment response includes
`{ value: { url: "...", versions: [{url, versionNumber}] } }` — the old code
only checked `v.url` but missed the `versions` array fallback.

```diff
  if (typeof v === 'object') {
+   if (v.url) return String(v.url);
+   if (Array.isArray(v.versions) && v.versions.length) {
+     for (let i = v.versions.length - 1; i >= 0; i--) {
+       if (v.versions[i] && v.versions[i].url) return String(v.versions[i].url);
+     }
+   }
    return String(v.value || v.name || v.text || '');
  }
```

### FIX #4b — `extractDownloadLinks()` — Added `attach` keyword
**Root cause:** QB "File Attachment" typed fields have labels like "Attachment",
"Attach Doc", "File Attach" — none of which matched the old keyword list.

```diff
- if (!low.includes('link') && !low.includes('download') &&
-     !low.includes('file') && !low.includes('url')) return;
+ if (!low.includes('link') && !low.includes('download') &&
+     !low.includes('file') && !low.includes('url') &&
+     !low.includes('attach')) return;  // ← ADDED
```

---

## FILE 2: `public/support_studio.html` (line 4967)

### FIX #1 — Direct QB URL instead of `/api/studio/kb_download` proxy
**Root cause:** The download anchor was routing through a server-side proxy
`/api/studio/kb_download?url=...` that attempted to re-fetch from QB using
a stored User Token. QB rejected this with `401` because the proxy call had
no valid QB session context (QB's `/up/` file paths require a live browser
session cookie OR a full per-file QB token, not just the app User Token).

The correct fix is to link directly to the QB URL — the user's browser already
has an active QB session, so the file downloads transparently.

```diff
- href="/api/studio/kb_download?url=${encodeURIComponent(u)}"
+ href="${esc(u)}"
```

**Zero regressions:** The `kb_download.js` route file is retained untouched —
it's still registered in `api/handler.js` and `functions/api/[[path]].js`
for backwards compatibility. It just won't be called from the KB table anymore.

---

## LAUNCH PROTOCOL

1. Deploy files as-is (no SQL, no env changes needed)
2. In MUMS Support Studio → Knowledge Base tab → click **Sync Now**
3. Wait for sync to complete
4. Click **Download** on any row → should open QB file directly (no 401)
5. Verify Related Product and Type columns show correct data (not "15")
