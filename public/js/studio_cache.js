/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

/* ═══════════════════════════════════════════════════════════════════
   MUMS Support Studio — Resource Cache Manager  v1.0
   ═══════════════════════════════════════════════════════════════════
   Strategy per bundle:
     connect_plus → Full IndexedDB cache, 24-hour TTL
     catalog      → Full IndexedDB cache, 12-hour TTL
     qb_schema    → Field definitions only, 24-hour TTL
     qb_records   → NOT cached here (uses existing 55s sessionStorage)

   Flow:
     1. Page load: check manifest → compare server hash vs local hash
     2. If fresh: serve from IndexedDB instantly
     3. If stale: show banner (non-critical) OR modal (critical)
     4. Background: re-check every 30 minutes
   ═══════════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  // ── Constants ────────────────────────────────────────────────────
  var DB_NAME    = 'MUMS_STUDIO_CACHE';
  var DB_VERSION = 1;

  var TTL = {
    connect_plus: 24 * 60 * 60 * 1000,  // 24 hours
    parts_number: 24 * 60 * 60 * 1000,  // 24 hours
    catalog:      12 * 60 * 60 * 1000,  // 12 hours
    qb_schema:    24 * 60 * 60 * 1000,  // 24 hours
  };

  var MANIFEST_CHECK_INTERVAL = 30 * 60 * 1000; // 30 minutes
  var SUPPORT_STUDIO_QB_SETTINGS_KEY = 'support_studio_qb_settings';
  var _db         = null;
  var _dbPromise  = null;
  var _checkTimer = null;

  // ── IndexedDB opener ─────────────────────────────────────────────
  function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise(function (resolve, reject) {
      try {
        var req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          // Store: bundles — the actual cached data
          if (!db.objectStoreNames.contains('bundles')) {
            db.createObjectStore('bundles', { keyPath: 'id' });
          }
          // Store: meta — manifest + misc metadata
          if (!db.objectStoreNames.contains('meta')) {
            db.createObjectStore('meta', { keyPath: 'key' });
          }
        };

        req.onsuccess = function (e) {
          _db = e.target.result;
          _db.onerror = function (ev) {
            console.warn('[StudioCache] DB error:', ev.target.error);
          };
          resolve(_db);
        };

        req.onerror = function (e) {
          console.warn('[StudioCache] IndexedDB open failed:', e.target.error);
          reject(e.target.error);
        };

        req.onblocked = function () {
          console.warn('[StudioCache] DB upgrade blocked — close other tabs.');
        };
      } catch (err) {
        console.warn('[StudioCache] IndexedDB not available:', err);
        reject(err);
      }
    });
    return _dbPromise;
  }

  // ── Low-level DB ops ─────────────────────────────────────────────
  function dbGet(storeName, key) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          var tx  = db.transaction([storeName], 'readonly');
          var req = tx.objectStore(storeName).get(key);
          req.onsuccess = function () { resolve(req.result || null); };
          req.onerror   = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    }).catch(function () { return null; });
  }

  function dbPut(storeName, obj) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          var tx  = db.transaction([storeName], 'readwrite');
          var req = tx.objectStore(storeName).put(obj);
          req.onsuccess = function () { resolve(true); };
          req.onerror   = function () { resolve(false); };
          tx.onerror    = function () { resolve(false); };
        } catch (e) { resolve(false); }
      });
    }).catch(function () { return false; });
  }

  function dbDelete(storeName, key) {
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction([storeName], 'readwrite');
          tx.objectStore(storeName).delete(key);
          tx.oncomplete = function () { resolve(true); };
          tx.onerror    = function () { resolve(false); };
        } catch (e) { resolve(false); }
      });
    }).catch(function () { return false; });
  }

  function dbClear(storeName) {
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction([storeName], 'readwrite');
          tx.objectStore(storeName).clear();
          tx.oncomplete = function () { resolve(true); };
          tx.onerror    = function () { resolve(false); };
        } catch (e) { resolve(false); }
      });
    }).catch(function () { return false; });
  }

  // ── Auth token helper ─────────────────────────────────────────────
  function _getToken() {
    try {
      var raw = localStorage.getItem('mums_supabase_session') ||
                sessionStorage.getItem('mums_supabase_session');
      if (raw) {
        var p = JSON.parse(raw);
        if (p && p.access_token) return p.access_token;
      }
      if (global.CloudAuth && typeof global.CloudAuth.accessToken === 'function') {
        return global.CloudAuth.accessToken() || '';
      }
    } catch (_) {}
    return '';
  }

  function _authHeaders() {
    var tok = _getToken();
    var h   = { 'Content-Type': 'application/json' };
    if (tok) h['Authorization'] = 'Bearer ' + tok;
    return h;
  }

  // ── Bundle read/write ─────────────────────────────────────────────
  /**
   * Get a cached bundle. Returns null if not found or TTL expired.
   * @param {string} bundleId  — 'connect_plus' | 'catalog' | 'qb_schema'
   */
  function getBundle(bundleId) {
    return dbGet('bundles', bundleId).then(function (row) {
      if (!row) return null;
      var ttl = TTL[bundleId] || (24 * 60 * 60 * 1000);
      var age = Date.now() - (row.fetchedAt || 0);
      if (age > ttl) {
        // Expired — delete and return null
        dbDelete('bundles', bundleId);
        return null;
      }
      return row;
    });
  }

  /**
   * Store a bundle in IndexedDB.
   * @param {string} bundleId
   * @param {*}      data      — array of records or object
   * @param {string} hash      — server hash for this bundle
   * @param {number} count     — record count
   */
  function setBundle(bundleId, data, hash, count) {
    var row = {
      id:        bundleId,
      data:      data,
      hash:      hash || '',
      count:     count || (Array.isArray(data) ? data.length : 0),
      fetchedAt: Date.now(),
      version:   '1',
    };
    return dbPut('bundles', row);
  }

  // ── Manifest ops ──────────────────────────────────────────────────
  function getLocalManifest() {
    return dbGet('meta', 'manifest');
  }

  function setLocalManifest(manifest) {
    return dbPut('meta', { key: 'manifest', data: manifest, updatedAt: Date.now() });
  }

  // ── Server manifest fetch ─────────────────────────────────────────
  var _lastManifestCheck = 0;

  function fetchServerManifest(force) {
    var now = Date.now();
    if (!force && (now - _lastManifestCheck) < 60 * 1000) {
      // Debounce: don't check more than once per minute unless forced
      return Promise.resolve(null);
    }
    _lastManifestCheck = now;
    return fetch('/api/studio/cache_manifest', { headers: _authHeaders() })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('manifest_' + r.status)); })
      .catch(function (e) {
        console.warn('[StudioCache] manifest fetch failed:', e.message);
        return null;
      });
  }

  // ── Hash comparison + notification dispatch ───────────────────────
  function _emit(eventName, detail) {
    try {
      global.dispatchEvent(new CustomEvent('studiocache:' + eventName, { detail: detail || {} }));
    } catch (_) {}
  }

  /**
   * checkForUpdates — compare local hashes vs server manifest.
   * Emits:
   *   studiocache:fresh        — all bundles current
   *   studiocache:update       — some bundles outdated (non-critical)
   *   studiocache:critical     — critical update required (deletions or forced)
   *   studiocache:firstrun     — no local cache at all
   */
  function checkForUpdates(force) {
    return Promise.all([
      fetchServerManifest(force),
      getLocalManifest(),
      getBundle('connect_plus'),
      getBundle('parts_number'),
      getBundle('catalog'),
      getBundle('qb_schema'),
    ]).then(function (results) {
      var serverManifest = results[0];
      var localManifest  = results[1];
      var cpBundle       = results[2];
      var pnBundle       = results[3];
      var catBundle      = results[4];
      var schBundle      = results[5];

      var hasAnyLocal = !!(cpBundle || pnBundle || catBundle || schBundle);

      if (!hasAnyLocal) {
        _emit('firstrun', { serverManifest: serverManifest });
        return { status: 'firstrun', serverManifest: serverManifest };
      }

      if (!serverManifest || !serverManifest.ok) {
        // Can't check — use what we have, emit fresh so UI doesn't block
        _emit('fresh', {});
        return { status: 'fresh' };
      }

      var outdated  = [];
      var critical  = [];
      var bundles   = serverManifest.bundles || {};

      // Check each bundle
      _checkBundle('connect_plus', cpBundle,  bundles.connect_plus,  outdated, critical);
      _checkBundle('parts_number', pnBundle,  bundles.parts_number,  outdated, critical);
      _checkBundle('catalog',      catBundle,  bundles.catalog,       outdated, critical);
      _checkBundle('qb_schema',    schBundle,  bundles.qb_schema,     outdated, critical);

      // Update stored manifest
      setLocalManifest({
        server:      bundles,
        checkedAt:   Date.now(),
        serverGenAt: serverManifest.generatedAt,
      });

      if (critical.length > 0) {
        _emit('critical', { critical: critical, outdated: outdated, serverManifest: serverManifest });
        return { status: 'critical', critical: critical, outdated: outdated };
      }
      if (outdated.length > 0) {
        _emit('update', { outdated: outdated, serverManifest: serverManifest });
        return { status: 'update', outdated: outdated };
      }

      _emit('fresh', { bundles: bundles });
      return { status: 'fresh' };
    });
  }

  function _checkBundle(id, localBundle, serverInfo, outdated, critical) {
    if (!serverInfo) return; // server doesn't know about this bundle

    var localHash  = localBundle ? localBundle.hash  : null;
    var localCount = localBundle ? localBundle.count : 0;
    var serverHash  = serverInfo.hash;
    var serverCount = serverInfo.count || 0;
    var isCritical  = !!(serverInfo.isCritical);

    if (!localBundle) {
      // Not cached locally at all
      outdated.push({ id: id, reason: 'not_cached', serverInfo: serverInfo });
      return;
    }

    // CRITICAL: count dropped = deletions on server
    if (serverCount > 0 && localCount > 0 && serverCount < localCount) {
      critical.push({ id: id, reason: 'deletions_detected', localCount: localCount, serverCount: serverCount, serverInfo: serverInfo });
      return;
    }

    // CRITICAL: server flags this bundle
    if (isCritical && localHash !== serverHash) {
      critical.push({ id: id, reason: 'forced_critical', serverInfo: serverInfo });
      return;
    }

    // Normal stale check
    if (localHash !== serverHash) {
      outdated.push({ id: id, reason: 'hash_mismatch', localHash: localHash, serverHash: serverHash, serverInfo: serverInfo });
    }
  }

  // ── Full download per bundle ──────────────────────────────────────
  /**
   * Download and cache a bundle.
   * @param {string}   bundleId
   * @param {string}   serverHash   — from manifest
   * @param {Function} onProgress   — optional callback(pct, loaded, total)
   */
  function downloadBundle(bundleId, serverHash, onProgress) {
    if (bundleId === 'connect_plus') {
      return _downloadConnectPlus(serverHash, onProgress);
    }
    if (bundleId === 'parts_number') {
      return _downloadPartsNumber(serverHash, onProgress);
    }
    if (bundleId === 'catalog') {
      return _downloadCatalog(serverHash, onProgress);
    }
    if (bundleId === 'qb_schema') {
      return _downloadQbSchema(serverHash, onProgress);
    }
    return Promise.reject(new Error('Unknown bundleId: ' + bundleId));
  }

  // Connect+ — fetches the Google Sheets CSV via server proxy
  function _downloadConnectPlus(serverHash, onProgress) {
    if (onProgress) onProgress(5, 0, 1);
    return fetch('/api/studio/cache_bundle?bundle=connect_plus', { headers: _authHeaders() })
      .then(function (r) {
        if (!r.ok) throw new Error('connect_plus fetch failed: ' + r.status);
        return r.json();
      })
      .then(function (d) {
        if (!d.ok) throw new Error(d.message || 'connect_plus error');
        if (onProgress) onProgress(90, d.records.length, d.records.length);
        return setBundle('connect_plus', d.records, serverHash || d.hash, d.records.length)
          .then(function () {
            if (onProgress) onProgress(100, d.records.length, d.records.length);
            return { ok: true, count: d.records.length };
          });
      });
  }

  // Parts Number — fetches the Google Sheets CSV via server proxy
  function _downloadPartsNumber(serverHash, onProgress) {
    if (onProgress) onProgress(5, 0, 1);
    return fetch('/api/studio/cache_bundle?bundle=parts_number', { headers: _authHeaders() })
      .then(function (r) {
        if (!r.ok) throw new Error('parts_number fetch failed: ' + r.status);
        return r.json();
      })
      .then(function (d) {
        if (!d.ok) throw new Error(d.message || 'parts_number error');
        if (onProgress) onProgress(90, d.records.length, d.records.length);
        return setBundle('parts_number', d.records, serverHash || d.hash, d.records.length)
          .then(function () {
            if (onProgress) onProgress(100, d.records.length, d.records.length);
            return { ok: true, count: d.records.length };
          });
      });
  }

  // Catalog — fetches all items from /api/catalog/items
  function _downloadCatalog(serverHash, onProgress) {
    if (onProgress) onProgress(10, 0, 1);
    return fetch('/api/catalog/items', { headers: _authHeaders() })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || 'catalog fetch failed');
        var items = d.items || [];
        if (onProgress) onProgress(90, items.length, items.length);
        return setBundle('catalog', items, serverHash || '', items.length)
          .then(function () {
            if (onProgress) onProgress(100, items.length, items.length);
            return { ok: true, count: items.length };
          });
      });
  }

  // QB Schema — field definitions only, no records
  function _downloadQbSchema(serverHash, onProgress) {
    if (onProgress) onProgress(20, 0, 1);
    return fetch('/api/studio/cache_bundle?bundle=qb_schema', { headers: _authHeaders() })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.message || 'qb_schema fetch failed');
        if (onProgress) onProgress(90, 1, 1);
        return setBundle('qb_schema', d.schema, serverHash || d.hash, 1)
          .then(function () {
            if (onProgress) onProgress(100, 1, 1);
            return { ok: true, schema: d.schema };
          });
      });
  }

  // ── Full sync (download multiple bundles) ─────────────────────────
  /**
   * syncBundles — download a list of bundles sequentially.
   * Emits studiocache:progress events during download.
   * @param {Array}  bundleIds     — ['connect_plus', 'catalog', ...]
   * @param {Object} serverManifest — full manifest from server
   */
  function syncBundles(bundleIds, serverManifest) {
    var bundles = serverManifest && serverManifest.bundles ? serverManifest.bundles : {};
    var total   = bundleIds.length;
    var done    = 0;

    function next(idx) {
      if (idx >= bundleIds.length) {
        _emit('synccomplete', { synced: bundleIds });
        return Promise.resolve({ ok: true, synced: bundleIds });
      }

      var id         = bundleIds[idx];
      var serverInfo = bundles[id] || {};
      var serverHash = serverInfo.hash || '';

      _emit('progress', { bundleId: id, bundlePct: 0, overallDone: done, overallTotal: total });

      return downloadBundle(id, serverHash, function (pct) {
        _emit('progress', { bundleId: id, bundlePct: pct, overallDone: done, overallTotal: total });
      })
        .then(function (result) {
          done++;
          _emit('progress', { bundleId: id, bundlePct: 100, overallDone: done, overallTotal: total });
          return next(idx + 1);
        })
        .catch(function (err) {
          console.warn('[StudioCache] bundle download failed:', id, err.message);
          _emit('bundleerror', { bundleId: id, error: err.message });
          done++;
          return next(idx + 1); // Continue with next bundle despite error
        });
    }

    return next(0);
  }

  // ── Clear all cache ───────────────────────────────────────────────
  function clearAll() {
    return Promise.all([dbClear('bundles'), dbClear('meta')]).then(function () {
      _emit('cleared', {});
      return { ok: true };
    });
  }

  function clearBundle(bundleId) {
    return dbDelete('bundles', bundleId).then(function () {
      _emit('bundlecleared', { bundleId: bundleId });
      return { ok: true };
    });
  }

  // ── Cache stats ───────────────────────────────────────────────────
  function getStats() {
    return Promise.all([
      getBundle('connect_plus'),
      getBundle('parts_number'),
      getBundle('catalog'),
      getBundle('qb_schema'),
      getLocalManifest(),
    ]).then(function (r) {
      var cp  = r[0];
      var pn  = r[1];
      var cat = r[2];
      var sch = r[3];
      var mf  = r[4];

      function bundleStat(b, ttlMs) {
        if (!b) return { cached: false };
        var age = Date.now() - (b.fetchedAt || 0);
        return {
          cached:    true,
          count:     b.count,
          hash:      b.hash,
          fetchedAt: b.fetchedAt,
          ageMs:     age,
          ageHours:  +(age / 3600000).toFixed(1),
          expired:   age > ttlMs,
          fresh:     age <= ttlMs,
        };
      }

      return {
        connect_plus: bundleStat(cp,  TTL.connect_plus),
        parts_number: bundleStat(pn,  TTL.parts_number),
        catalog:      bundleStat(cat, TTL.catalog),
        qb_schema:    bundleStat(sch, TTL.qb_schema),
        manifest:     mf ? mf.data : null,
        checkedAt:    mf ? mf.updatedAt : null,
      };
    });
  }

  // ── Background auto-check ─────────────────────────────────────────
  function startAutoCheck() {
    if (_checkTimer) return;
    _checkTimer = setInterval(function () {
      checkForUpdates(false).catch(function (e) {
        console.warn('[StudioCache] auto-check error:', e.message);
      });
    }, MANIFEST_CHECK_INTERVAL);
  }

  function stopAutoCheck() {
    if (_checkTimer) { clearInterval(_checkTimer); _checkTimer = null; }
  }

  // ── Public API ────────────────────────────────────────────────────
  global.StudioCache = {
    // Core
    getBundle:          getBundle,
    setBundle:          setBundle,
    downloadBundle:     downloadBundle,
    syncBundles:        syncBundles,
    checkForUpdates:    checkForUpdates,
    fetchServerManifest: fetchServerManifest,

    // Stats + management
    getStats:           getStats,
    clearAll:           clearAll,
    clearBundle:        clearBundle,
    getLocalManifest:   getLocalManifest,
    setLocalManifest:   setLocalManifest,

    // Lifecycle
    startAutoCheck:     startAutoCheck,
    stopAutoCheck:      stopAutoCheck,

    // Constants (read-only)
    TTL:                TTL,
    DB_NAME:            DB_NAME,
    SUPPORT_STUDIO_QB_SETTINGS_KEY: SUPPORT_STUDIO_QB_SETTINGS_KEY,
  };

}(window));
