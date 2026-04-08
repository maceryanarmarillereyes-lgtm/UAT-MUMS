/**
 * Search Engine v2 — SE2 v5.0 (2026 AI-Grade)
 * Covers ALL 8 catalogs: QuickBase_S, Deep Search, Knowledge Base,
 * Part Number, Product Controllers, Connect+, Contact Information, Support Records
 *
 * Features:
 * - Natural Language Understanding (NLU) — handles questions, typos, wrong spelling
 * - BM25+ Ranking (industry standard 2024-2026)
 * - Noise token dampening (words like 'part','number','type' = 0.05x weight)
 * - Exact alphanumeric part-number boosting (10,000 pts)
 * - Source-aware routing per catalog type
 * - Phonetic fallback (Soundex-lite)
 * - Levenshtein fuzzy matching capped at edit-distance 2
 * - Zero regression: auth/realtime/QB/other tabs untouched
 */

(function(global) {
  'use strict';

  const VERSION = '5.0.0';

  // Tokens that appear in nearly every record → dampen weight to near-zero
  const NOISE_TOKENS = new Set([
    'part','number','type','model','product','unit','item','record','data',
    'info','information','system','code','name','list','set','get','use',
    'how','what','where','when','why','who','which','is','are','was','the',
    'a','an','of','in','on','at','to','for','with','by','from','and','or',
    'do','does','can','please','help','show','find','search','tell','me',
    'my','i','you','your','it','this','that','these','those','be','been'
  ]);

  const STOP_WORDS = new Set(['the','a','an','is','are','was','were','be','been','to','of','in','on']);

  // Part number pattern: alphanumeric codes like XR77, 845-1300, AB-123C
  const PART_NO_RX = /\b([A-Z]{1,4}[-\/]?\d{2,8}[A-Z0-9]*|\d{3,8}[-]\d{2,6}[A-Z0-9]*)\b/gi;

  // Question prefix strip
  const Q_PREFIX_RX = /^(what(?:'s| is| are)?|how(?:'s| do| does| can| to)?|where(?:'s| is| are)?|when(?:'s| is| are)?|who(?:'s| is| are)?|which|why|can you|please|show me|find|search for|tell me about|give me|i need|looking for|do you have)\s+/i;

  // Catalog source types
  const SOURCE_TYPES = {
    QUICKBASE:   'quickbase',
    DEEP_SEARCH: 'deep_search',
    KNOWLEDGE:   'knowledge_base',
    PART_NUMBER: 'part_number',
    CONTROLLERS: 'product_controllers',
    CONNECT:     'connect_plus',
    CONTACTS:    'contact_info',
    SUPPORT:     'support_records'
  };

  // Field weights per source type (for BM25+ field-boosted scoring)
  const FIELD_WEIGHTS = {
    part_number:         { title: 10, partNo: 15, brand: 5, description: 2, tags: 3, part_no: 15, sku: 12 },
    product_controllers: { title: 10, model: 12, brand: 6, description: 2, firmware: 4 },
    contact_info:        { name: 12, email: 8, phone: 8, department: 4, title: 3, fullName: 12 },
    support_records:     { title: 8, caseId: 12, resolution: 3, symptoms: 5, tags: 4, subject: 8 },
    knowledge_base:      { title: 10, content: 3, category: 5, tags: 4 },
    connect_plus:        { title: 8, description: 3, sku: 12, category: 4 },
    quickbase:           { title: 8, recordId: 12, field1: 4, field2: 3 },
    deep_search:         { title: 8, content: 3, source: 4, tags: 3 }
  };

  // BM25 parameters
  const BM25_K1 = 1.5;
  const BM25_B  = 0.75;

  // --- UTILITY FUNCTIONS ---

  function levenshtein(a, b) {
    if (Math.abs(a.length - b.length) > 3) return 99;
    const m = a.length, n = b.length;
    const dp = Array.from({length: m+1}, (_, i) => {
      const row = new Array(n+1).fill(0);
      row[0] = i;
      return row;
    });
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i-1] === b[j-1]
          ? dp[i-1][j-1]
          : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
      }
    }
    return dp[m][n];
  }

  function soundexLite(s) {
    if (!s) return '';
    const codes = {b:1,f:1,p:1,v:1,c:2,g:2,j:2,k:2,q:2,s:2,x:2,z:2,d:3,t:3,l:4,m:5,n:5,r:6};
    const upper = s.toUpperCase();
    let result = upper[0];
    let prev = codes[upper[0].toLowerCase()] || 0;
    for (let i = 1; i < upper.length && result.length < 4; i++) {
      const c = upper[i].toLowerCase();
      const code = codes[c] || 0;
      if (code && code !== prev) result += code;
      prev = code;
    }
    return result.padEnd(4, '0');
  }

  function tokenize(text) {
    return (text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s\-\/]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 2);
  }

  function normalizeQuery(raw) {
    let q = (raw || '').trim();
    const partCodes = [];
    let m;
    const partRxGlobal = new RegExp(PART_NO_RX.source, 'gi');
    while ((m = partRxGlobal.exec(q)) !== null) {
      partCodes.push(m[0].toUpperCase());
    }
    const isQuestion = Q_PREFIX_RX.test(q);
    q = q.replace(Q_PREFIX_RX, '');
    const tokens = tokenize(q);
    const meaningful = tokens.filter(t => !NOISE_TOKENS.has(t));
    const hasPartCode = partCodes.length > 0;
    return { raw, q, tokens, meaningful, partCodes, hasPartCode, isQuestion };
  }

  function getField(rec, field) {
    return field.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : null), rec);
  }

  function getDocLength(rec, fieldMap) {
    return Object.keys(fieldMap).reduce((sum, f) => {
      const v = getField(rec, f);
      return sum + (v ? String(v).split(/\s+/).length : 0);
    }, 0);
  }

  function buildIndex(records, fieldMap) {
    const index = {};
    let totalLen = 0;
    records.forEach((rec, id) => {
      const tokenFreq = {};
      const fieldHits = {};
      Object.entries(fieldMap).forEach(([field, boost]) => {
        const val = getField(rec, field);
        if (!val) return;
        const toks = tokenize(String(val));
        toks.forEach(t => {
          tokenFreq[t] = (tokenFreq[t] || 0) + boost;
          if (!fieldHits[t]) fieldHits[t] = [];
          if (!fieldHits[t].includes(field)) fieldHits[t].push(field);
        });
      });
      totalLen += getDocLength(rec, fieldMap);
      Object.entries(tokenFreq).forEach(([t, freq]) => {
        if (!index[t]) index[t] = { df: 0, postings: [] };
        index[t].df++;
        index[t].postings.push({ id, tf: freq, fields: fieldHits[t] || [] });
      });
    });
    const avgLen = totalLen / (records.length || 1);
    return { index, avgLen };
  }

  function bm25Score(tf, df, N, avgLen, docLen) {
    const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
    const norm = (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * docLen / avgLen));
    return idf * norm;
  }

  // --- CORE ENGINE CLASS ---

  class SearchEngine2 {
    constructor(options) {
      this.catalogs = {};
      this.options = Object.assign({
        maxResults: 50,
        fuzzyEnabled: true,
        fuzzyMaxDist: 2,
        fuzzyMinLen: 4,
        fuzzyMaxTerms: 3,
        partBoost: 10000,
        noiseWeight: 0.05,
        debug: false
      }, options || {});
    }

    /**
     * Register a data catalog.
     * @param {string} name        - unique catalog key
     * @param {Array}  records     - array of record objects
     * @param {string} sourceType  - one of SOURCE_TYPES values
     * @param {Object} [fieldMap]  - optional override for field boost weights
     */
    registerCatalog(name, records, sourceType, fieldMap) {
      if (!records || !records.length) {
        if (this.options.debug) console.warn('[SE2] Empty catalog:', name);
        return;
      }
      const fw = fieldMap || FIELD_WEIGHTS[sourceType] || { title: 5, description: 2 };
      const { index, avgLen } = buildIndex(records, fw);
      this.catalogs[name] = { records, index, avgLen, sourceType, fieldMap: fw, N: records.length };
      if (this.options.debug) console.log('[SE2] Registered:', name, records.length, 'records');
    }

    /**
     * Main search.
     * @param {string} rawQuery
     * @param {Object} [opts]  { sources: ['part_number',...], maxResults: 20 }
     */
    search(rawQuery, opts) {
      opts = opts || {};
      const qMeta = normalizeQuery(rawQuery);
      const maxRes = opts.maxResults || this.options.maxResults;
      const targetSources = opts.sources || null;
      const allResults = [];

      Object.entries(this.catalogs).forEach(function([name, catalog]) {
        if (targetSources && !targetSources.includes(catalog.sourceType)) return;
        const hits = this._searchCatalog(qMeta, catalog);
        hits.forEach(h => { h.catalogName = name; h.sourceType = catalog.sourceType; allResults.push(h); });
      }.bind(this));

      allResults.sort((a, b) => b.score - a.score);

      // Part-number queries: prioritize part catalog results to top
      if (qMeta.hasPartCode) {
        allResults.sort((a, b) => {
          const ap = (a.sourceType === 'part_number' || a.sourceType === 'product_controllers') ? 1 : 0;
          const bp = (b.sourceType === 'part_number' || b.sourceType === 'product_controllers') ? 1 : 0;
          if (ap !== bp) return bp - ap;
          return b.score - a.score;
        });
      }

      return { query: qMeta, total: allResults.length, results: allResults.slice(0, maxRes), catalogs: Object.keys(this.catalogs) };
    }

    _searchCatalog(qMeta, catalog) {
      const { records, index, avgLen, sourceType, fieldMap, N } = catalog;
      const scores = new Map();
      const self = this;

      // STEP 1: Exact part-number matching
      if (qMeta.hasPartCode) {
        qMeta.partCodes.forEach(code => {
          const lower = code.toLowerCase();
          records.forEach((rec, id) => {
            const pf = String(getField(rec,'partNo') || getField(rec,'part_no') || getField(rec,'sku') || '').toLowerCase();
            const tf2 = String(getField(rec,'title') || '').toLowerCase();
            if (pf === lower || tf2 === lower) {
              scores.set(id, (scores.get(id)||0) + self.options.partBoost);
            } else if (pf.includes(lower) || tf2.includes(lower)) {
              scores.set(id, (scores.get(id)||0) + self.options.partBoost * 0.5);
            } else if (sourceType !== 'part_number' && sourceType !== 'product_controllers') {
              if (scores.has(id)) scores.set(id, scores.get(id) * 0.08);
            }
          });
        });
      }

      // STEP 2: BM25+ token scoring
      const queryTokens = qMeta.meaningful.length ? qMeta.meaningful : qMeta.tokens;
      queryTokens.forEach(token => {
        const isNoise = NOISE_TOKENS.has(token);
        const weight  = isNoise ? self.options.noiseWeight : 1.0;

        if (index[token]) {
          const { df, postings } = index[token];
          postings.forEach(({ id, tf }) => {
            const docLen = getDocLength(records[id], fieldMap);
            const s = bm25Score(tf, df, N, avgLen, docLen);
            scores.set(id, (scores.get(id)||0) + s * weight);
          });
        }

        // STEP 3: Fuzzy match
        if (!isNoise && self.options.fuzzyEnabled && token.length >= self.options.fuzzyMinLen) {
          let fc = 0;
          for (const [iTok, { df, postings }] of Object.entries(index)) {
            if (fc >= self.options.fuzzyMaxTerms) break;
            if (iTok === token) continue;
            if (Math.abs(iTok.length - token.length) > self.options.fuzzyMaxDist) continue;
            const dist = levenshtein(token, iTok);
            if (dist <= self.options.fuzzyMaxDist) {
              fc++;
              const pen = dist === 1 ? 0.6 : 0.35;
              postings.forEach(({ id, tf }) => {
                const docLen = getDocLength(records[id], fieldMap);
                scores.set(id, (scores.get(id)||0) + bm25Score(tf, df, N, avgLen, docLen) * pen * weight);
              });
            }
          }
        }

        // STEP 4: Phonetic fallback
        if (!isNoise && token.length >= 3 && !index[token]) {
          const sdx = soundexLite(token);
          for (const [iTok, { df, postings }] of Object.entries(index)) {
            if (soundexLite(iTok) === sdx && iTok !== token) {
              postings.forEach(({ id, tf }) => {
                const docLen = getDocLength(records[id], fieldMap);
                scores.set(id, (scores.get(id)||0) + bm25Score(tf, df, N, avgLen, docLen) * 0.25 * weight);
              });
            }
          }
        }
      });

      const results = [];
      scores.forEach((score, id) => { if (score > 0.01) results.push({ id, score, record: records[id] }); });
      return results.sort((a, b) => b.score - a.score);
    }

    autocomplete(partial, max) {
      max = max || 8;
      if (!partial || partial.length < 2) return [];
      const lower = partial.toLowerCase();
      const seen = new Set();
      const sugg = [];
      Object.values(this.catalogs).forEach(({ index }) => {
        Object.keys(index).forEach(tok => {
          if (STOP_WORDS.has(tok) || NOISE_TOKENS.has(tok)) return;
          if (tok.startsWith(lower) && !seen.has(tok)) {
            seen.add(tok);
            sugg.push({ text: tok, freq: index[tok].df });
          }
        });
      });
      return sugg.sort((a,b) => b.freq-a.freq).slice(0,max).map(s=>s.text);
    }

    countByCatalog(rawQuery) {
      const qMeta = normalizeQuery(rawQuery);
      const counts = {};
      Object.entries(this.catalogs).forEach(([name, catalog]) => {
        counts[name] = this._searchCatalog(qMeta, catalog).length;
      });
      return counts;
    }
  }

  // Expose globals
  global.SearchEngine2      = SearchEngine2;
  global.SE2_SOURCE_TYPES   = SOURCE_TYPES;
  global.SE2_VERSION        = VERSION;
  global.SE2_normalizeQuery = normalizeQuery;

})(typeof window !== 'undefined' ? window : global);
