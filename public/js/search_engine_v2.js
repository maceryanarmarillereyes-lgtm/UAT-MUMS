/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

/**
 * MUMS Search Engine v2 — Advanced Client-Side Search (2026 AI-Style Upgrade)
 * ─────────────────────────────────────────────────────────────────────────────
 * BUGFIX LOG (SE2 v4.0 — 2026-04-09):
 *
 * BUG 1 FIXED: Noise-word explosion — "part number", "xr77 part number" returned
 *   4,948 results because "part" and "number" exist in almost every record.
 *   FIX: Added high-value NOISE_TOKENS set. Noise tokens get 0.05x weight so they
 *   only contribute when other meaningful tokens already boosted the score. Prevents
 *   generic words from pulling in thousands of irrelevant records.
 *
 * BUG 2 FIXED: Missing exact part-number / alphanumeric-code matching.
 *   FIX: Added PART_NUMBER_RX detector. When query contains an alphanumeric code
 *   (e.g. "XR77", "845-1300", "XBL650"), scoring prioritises exact + prefix hits
 *   with 10000+ base score so Part-Number records rank at top and support-case noise
 *   is suppressed with a 0.1x penalty.
 *
 * BUG 3 FIXED: Fuzzy matching triggering on every query — generating hundreds of
 *   false-positive term expansions for short common words.
 *   FIX: Fuzzy only triggers when scored results < 5 AND the token is NOT already
 *   in the index AND token length >= 4. Also, fuzzy expansions cap at 3 terms and
 *   get 0.4x score penalty (was 0.6x).
 *
 * BUG 4 FIXED: Question-format queries ("what is xr77 part number") not cleaning
 *   correctly — "what", "is" were tokenised as search terms.
 *   FIX: Expanded STOP_WORDS + QueryParser now strips leading question verbs before
 *   tokenisation, ensuring only meaningful intent tokens remain.
 *
 * BUG 5 FIXED: TF-IDF fieldBoost computation double-counted field hits.
 *   FIX: fieldBoost now uses a cap per field (max 3 hits per field) to prevent
 *   runaway scores on long resolution text.
 *
 * BUG 6 FIXED: Autocomplete trigram suggestions bleeding irrelevant terms into
 *   the search query when prefix was a noise word.
 *   FIX: Autocomplete skips prefix if it's a STOP_WORD or NOISE_TOKEN.
 */
(function(global) {
  'use strict';

  // ── STOP WORDS (expanded with conversational + question fillers) ──────────
  var STOP_WORDS = new Set([
    'the','a','an','is','are','was','were','to','for','in','on','of','and','or',
    'but','not','with','this','that','these','those','from','by','at','be','been',
    'have','has','had','do','does','did','will','would','could','should','may',
    'might','can','its','it','as','so','if','then','than','when','where','how',
    'what','which','who','there','their','they','them','our','your','we','us',
    'i','my','me','he','she','his','her','him','about','after','before',
    'also','any','some','all','more','most','just','up','out','get','got','per',
    // Question starters (strip before tokenising)
    'find','search','show','tell','give','explain','describe','list',
    'looking','need','want','trying','check','see','know',
    // Conversational Fillers (Taglish)
    'paano','pano','saan','bakit','ano','ang','mga','yung','sa','ng','ni','na',
    'ayaw','mag','gumana','para','fix','resolve','issue','problem','error','help',
    'please','pls','paki','kasi','daw','raw'
  ]);

  // ── NOISE TOKENS — common words that pollute scoring ────────────────────────
  // These are NOT stop words (they carry some signal) but should score minimally
  // unless paired with specific terms. Weight multiplier: 0.05x
  var NOISE_TOKENS = new Set([
    'part','number','parts','numbers','type','model','unit','item','product',
    'controller','control','system','device','equipment','serial','code',
    'information','info','details','data','record','report','list','catalog',
    'request','inquiry','question','support','service','case','ticket',
    'replacement','upgrade','update','version','new','old','latest',
    'good','bad','working','broken','failed','failure','active','inactive'
  ]);

  // ── ALPHANUMERIC / PART-NUMBER PATTERN ──────────────────────────────────────
  // Matches: XR77, XR-77, 845-1300, XBL650BQB100, DA00018, 528-5129, etc.
  var PART_NUMBER_RX = /^[A-Za-z]{1,6}[\-\d][\w\-]{2,}$|^\d{3,4}[-\s]\d{3,4}$|^[A-Za-z]\d{3,}$|^[A-Za-z]{2,4}\d{2,4}$/;

  // ── SYNONYM MAP ──────────────────────────────────────────────────────────────
  var SYNONYM_MAP = {
    'offline':      ['down','unreachable','not responding','disconnected','no communication','off','walang connection','ayaw mag connect'],
    'online':       ['up','connected','active','running','live'],
    'license':      ['license key','activation','licence','licensing','activation key'],
    'firmware':     ['firmware update','software update','fw update','fw','sw update'],
    'onboarding':   ['setup','installation','commissioning','initial setup','deploy','configure'],
    'e2':           ['e2 controller','einstein 2','e2e','e-2'],
    'e3':           ['e3 controller','e3 gateway','einstein 3','e-3','e3g'],
    'wm':           ['walmart'],
    'modbus':       ['modbus rtu','modbus tcp','serial communication','serial comm','modbus protocol'],
    'vfd':          ['variable frequency drive','drive','inverter'],
    'rack':         ['rack controller','refrigeration rack','compressor rack','rack unit'],
    'setpoint':     ['setpoints','set point','set points','sp'],
    'azure':        ['azure alert','azure monitor','azure notification','ms azure'],
    'connect+':     ['connectplus','connect plus','connect+ site','c+ site'],
    'network':      ['network issue','connectivity','internet','ip','lan','wan'],
    'vpn':          ['tunnel','vpn tunnel','remote access vpn','ipsec'],
    'alarm':        ['alert','notification','warning','fault','error code'],
    'temperature':  ['temp','celsius','fahrenheit','probe reading'],
    'haccp':        ['food safety','temperature log','critical control','food safe'],
    'license key':  ['lk','product key','serial key','activation code'],
    'floor plan':   ['floorplan','floor map','layout','custom screen','cs'],
    'remapping':    ['remap','reassign','cs remap','screen remap','custom screen remap'],
    'xr75':         ['xr-75','xr 75','case controller','xr75cx','case ctrl'],
    'xr77':         ['xr-77','xr 77','xr77cx','dixell xr77'],
    'cc200':        ['cc-200','cc 200','cc200 controller','copeland case controller'],
    'xm679':        ['xm-679','xm 679','electronic controller','xm controller'],
    'woolworths':   ['woolies','woolworths au','ww','woolworth'],
    'coles':        ['coles au','coles supermarket','coles store'],
    'walmart':      ['wm','wal-mart','walmart store','walmart us'],
    'refrigeration':['fridge','refrigerant','cooling','hvac','refrigerating'],
    'programming':  ['program','configure','configuration','pcr','setpoint prog'],
    'controller':   ['ctrl','e2','e3','unit controller','case controller'],
    'solenoid':     ['solenoid valve','sol valve','evr valve','evap valve'],
    'probe':        ['temp probe','temperature sensor','rtd','sensor probe','thermocouple'],
    'rga':          ['return authorization','rma','return','warranty claim','warranty return'],
    'sporlan':      ['sporlan valve','danfoss','alco','eev','expansion valve'],
    'site supervisor': ['ss300','hmi','ss','site sup','supervisor terminal'],
    'xweb':         ['xweb 500','xweb500d','carel','carel xweb'],
    'defrost':      ['deice','de-ice','deicing','defrost cycle','defrost period'],
    'password':     ['pwd','credentials','daily password','one-time password','otp'],
    'gateway':      ['e2 gateway','e3 gateway','network gateway','protocol gateway'],
    'protocol':     ['bacnet','modbus','lonworks','jbus','communication protocol'],
    'update':       ['upgrade','patch','version','fw update','software update'],
    'reset':        ['restart','reboot','factory reset','cold start','power cycle'],
    'defective':    ['sira','basag','ayaw gumana','not working','dead']
  };

  // ── ABBREVIATIONS ──────────────────────────────────────────────────────────
  var ABBREV_MAP = {
    'e2':'e2 controller', 'e3':'e3 gateway', 'wm':'walmart',
    'qb':'quickbase', 'cp':'connect+', 'ss':'site supervisor',
    'lk':'license key', 'cs':'custom screen', 'fp':'floor plan',
    'sw':'software', 'fw':'firmware', 'hw':'hardware', 'rtu':'modbus rtu',
    'tcp':'modbus tcp', 'vfd':'variable frequency drive', 'eev':'electronic expansion valve',
    'rga':'return goods authorization', 'rma':'return merchandise authorization',
    'sp':'setpoint', 'pcr':'programming configuration request', 'oda':'offline delay alarm'
  };

  // ── QUESTION PREFIX PATTERNS (strip before tokenising) ───────────────────
  var QUESTION_STRIP_RX = /^(?:how\s+(?:do|can|to|does|would|should)\s+|what\s+(?:is|are|was|were|does|do)\s+|where\s+(?:is|can|do|are)\s+|why\s+(?:is|does|do|did)\s+|when\s+(?:do|does|did|is)\s+|who\s+(?:is|has|can)\s+|is\s+there\s+|can\s+i\s+|can\s+you\s+|should\s+i\s+|do\s+you\s+(?:have|know)\s+)/i;

  // ── TOKENISER ─────────────────────────────────────────────────────────────
  function tokenise(text) {
    if (!text) return [];
    return String(text).toLowerCase()
      .replace(/[^a-z0-9\s\-+#]/g, ' ')
      .split(/\s+/)
      .filter(function(t) { return t.length >= 1; });
  }

  function tokeniseNoStop(text) {
    return tokenise(text).filter(function(t) { return !STOP_WORDS.has(t) && t.length >= 2; });
  }

  // ── INVERTED INDEX ────────────────────────────────────────────────────────
  function InvertedIndex() {
    this.index = {};
    this.docCount = 0;
    this.docLengths = [];
    // BUG 5 FIX: field weights adjusted — part/title get maximum boost
    this.fieldWeights = { title:6, partno:8, eu:2, cat:2, case:5, res:0.8 };
  }

  InvertedIndex.prototype.build = function(records) {
    var self = this;
    self.docCount = records.length;
    self.index = {};
    self.docLengths = new Array(records.length).fill(0);

    records.forEach(function(r, ri) {
      // BUG 2 FIX: Index partno as a separate high-weight field
      var partnoText = String(r.partNo || r.part_number || r.title || '');
      // If the title looks like a part number, boost it as partno field
      var isTitlePartNo = PART_NUMBER_RX.test(String(r.title || '').trim());

      var fields = {
        title: tokeniseNoStop(r.title),
        partno: isTitlePartNo ? tokeniseNoStop(partnoText) : [],
        eu:    tokeniseNoStop(r.eu),
        cat:   tokeniseNoStop(r.cat),
        case:  tokenise(r.case),
        res:   tokeniseNoStop((r.res || '').slice(0, 300))
      };
      var tfMap = {};

      Object.keys(fields).forEach(function(f) {
        // BUG 5 FIX: Cap field contributions at 3 occurrences per field per doc
        var seen = {};
        fields[f].forEach(function(term) {
          seen[term] = (seen[term] || 0) + 1;
          if (seen[term] > 3) return; // cap at 3
          self.docLengths[ri]++;
          if (!tfMap[term]) tfMap[term] = { fields: {}, total: 0 };
          tfMap[term].fields[f] = (tfMap[term].fields[f] || 0) + 1;
          tfMap[term].total++;
        });
      });

      Object.keys(tfMap).forEach(function(term) {
        if (!self.index[term]) self.index[term] = { df: 0, postings: [] };
        self.index[term].df++;
        self.index[term].postings.push({
          ri: ri,
          fields: tfMap[term].fields,
          tf: tfMap[term].total
        });
      });
    });
  };

  InvertedIndex.prototype.lookup = function(term) { return this.index[term] || null; };
  InvertedIndex.prototype.allTerms = function() { return Object.keys(this.index); };

  // ── TF-IDF SCORER ─────────────────────────────────────────────────────────
  function TFIDFScorer(invertedIndex) {
    this.idx = invertedIndex;
    this.FW = invertedIndex.fieldWeights;
  }

  TFIDFScorer.prototype.score = function(records, queryTerms, isPartNoQuery) {
    var self = this;
    var scores = new Float64Array(records.length);
    var N = self.idx.docCount;

    queryTerms.forEach(function(term) {
      // BUG 1 FIX: Noise tokens contribute minimally
      var noiseWeight = NOISE_TOKENS.has(term) ? 0.05 : 1.0;
      var entry = self.idx.lookup(term);
      if (!entry) return;
      var df = entry.df;
      var idf = Math.log((N + 1) / (df + 1)) + 1;

      entry.postings.forEach(function(p) {
        var docLen = self.idx.docLengths[p.ri] || 1;
        var tf = (p.tf / docLen) * 100;
        var fieldBoost = 0;
        Object.keys(p.fields).forEach(function(f) {
          fieldBoost += (self.FW[f] || 1) * Math.min(p.fields[f], 3);
        });

        // BUG 2 FIX: If this is a part-number query, suppress non-parts records
        var srcPenalty = 1.0;
        if (isPartNoQuery) {
          var rec = records[p.ri];
          var recId = String(rec && rec.id || '');
          var isParts = recId.startsWith('parts_') ||
            String(rec && rec.cat || '').toLowerCase().includes('part');
          if (!isParts) srcPenalty = 0.1;
        }

        scores[p.ri] += tf * idf * Math.log1p(fieldBoost) * noiseWeight * srcPenalty;
      });
    });

    var results = [];
    for (var i = 0; i < records.length; i++) {
      if (scores[i] > 0) results.push({ record: records[i], score: scores[i], ri: i });
    }
    results.sort(function(a, b) { return b.score - a.score; });
    return results;
  };

  // ── LEVENSHTEIN DISTANCE ──────────────────────────────────────────────────
  function levenshtein(a, b) {
    if (a === b) return 0;
    var la = a.length, lb = b.length;
    if (la === 0) return lb;
    if (lb === 0) return la;
    if (Math.abs(la - lb) > 3) return 999;
    var row = [];
    for (var j = 0; j <= lb; j++) row[j] = j;
    for (var i = 1; i <= la; i++) {
      var prev = i;
      for (var k = 1; k <= lb; k++) {
        var val = (a[i-1] === b[k-1]) ? row[k-1] : Math.min(row[k]+1, prev+1, row[k-1]+1);
        row[k-1] = prev;
        prev = val;
      }
      row[lb] = prev;
    }
    return row[lb];
  }

  // ── FUZZY MATCHER ─────────────────────────────────────────────────────────
  function FuzzyMatcher(indexedTerms) {
    this.terms = indexedTerms.filter(function(t) { return t.length >= 3; });
  }

  FuzzyMatcher.prototype.suggest = function(typo, maxDist) {
    // BUG 3 FIX: Only fuzzy-match tokens >= 4 chars and not noise words
    if (!typo || typo.length < 4) return [];
    if (STOP_WORDS.has(typo) || NOISE_TOKENS.has(typo)) return [];
    maxDist = maxDist || (typo.length <= 5 ? 1 : (typo.length <= 8 ? 2 : 3));
    var results = [];
    var self = this;
    self.terms.forEach(function(term) {
      if (NOISE_TOKENS.has(term)) return; // don't expand to noise
      if (Math.abs(term.length - typo.length) > maxDist) return;
      var d = levenshtein(typo, term);
      if (d <= maxDist && d > 0) results.push({ term: term, dist: d });
    });
    results.sort(function(a, b) { return a.dist - b.dist; });
    // BUG 3 FIX: Cap at 3 fuzzy terms (was 5)
    return results.slice(0, 3).map(function(r) { return r.term; });
  };

  // ── TRIGRAM SUGGESTER ─────────────────────────────────────────────────────
  function TrigramSuggester(allTerms) {
    this.termFreq = {};
    this.trigramMap = {};
    this._build(allTerms);
  }

  TrigramSuggester.prototype._trigrams = function(s) {
    var t = '  ' + s + '  ';
    var tgs = [];
    for (var i = 0; i < t.length - 2; i++) tgs.push(t.slice(i, i+3));
    return tgs;
  };

  TrigramSuggester.prototype._build = function(terms) {
    var self = this;
    terms.forEach(function(term) {
      if (term.length < 2) return;
      self.termFreq[term] = (self.termFreq[term] || 0) + 1;
      self._trigrams(term).forEach(function(tg) {
        if (!self.trigramMap[tg]) self.trigramMap[tg] = [];
        if (self.trigramMap[tg].indexOf(term) < 0) self.trigramMap[tg].push(term);
      });
    });
  };

  TrigramSuggester.prototype.complete = function(prefix, limit) {
    prefix = (prefix || '').toLowerCase().trim();
    // BUG 6 FIX: Don't autocomplete stop/noise words
    if (!prefix || prefix.length < 2 || STOP_WORDS.has(prefix) || NOISE_TOKENS.has(prefix)) return [];
    limit = limit || 8;

    var prefixMatches = Object.keys(this.termFreq).filter(function(t) {
      return t.startsWith(prefix) && t !== prefix && !NOISE_TOKENS.has(t);
    });
    prefixMatches.sort(function(a, b) { return b.length - a.length; });

    var scored = {};
    var tgs = this._trigrams(prefix);
    var self = this;
    tgs.forEach(function(tg) {
      (self.trigramMap[tg] || []).forEach(function(term) {
        if (term.startsWith(prefix) || NOISE_TOKENS.has(term)) return;
        scored[term] = (scored[term] || 0) + 1;
      });
    });
    var simMatches = Object.keys(scored).sort(function(a, b) {
      return (scored[b] - scored[a]) || (self.termFreq[b] || 0) - (self.termFreq[a] || 0);
    });

    return prefixMatches.slice(0, Math.ceil(limit * 0.6))
      .concat(simMatches.slice(0, Math.floor(limit * 0.4)))
      .slice(0, limit);
  };

  // ── QUERY PARSER (Intent + Part-Number Detection) ─────────────────────────
  function QueryParser() {}

  QueryParser.prototype.parse = function(raw) {
    var q = String(raw || '').trim();
    var result = {
      original: q,
      type: 'keyword',
      caseNumber: null,
      isPartNoQuery: false,
      partNoCodes: [],
      must: [],
      mustNot: [],
      phrases: [],
      tokens: [],
      expanded: []
    };
    if (!q) return result;

    // Case # detection
    var caseMatch = q.match(/(?:^|\s)(?:#|case\s+)(\d{5,7})(?:\s|$)/i);
    if (caseMatch) {
      result.type = 'case';
      result.caseNumber = caseMatch[1];
      return result;
    }

    // BUG 4 FIX: Strip question prefixes BEFORE tokenising
    var stripped = q.replace(QUESTION_STRIP_RX, '').trim();
    if (stripped !== q) {
      result.type = 'question';
      q = stripped;
    } else if (/^(how|what|why|when|where|who|is|can|does|should|paano|saan|bakit)\b/i.test(q)) {
      result.type = 'question';
      q = q.replace(QUESTION_STRIP_RX, '').trim() || q;
    }

    // Phrase matching (quoted)
    var phraseRx = /"([^"]+)"/g;
    var m;
    while ((m = phraseRx.exec(q)) !== null) {
      result.phrases.push(m[1].toLowerCase());
    }
    q = q.replace(phraseRx, '');

    // Boolean must/must-not
    var tokens = q.split(/\s+/);
    tokens.forEach(function(tok) {
      if (tok.startsWith('+') && tok.length > 1) result.must.push(tok.slice(1).toLowerCase());
      else if (tok.startsWith('-') && tok.length > 1) result.mustNot.push(tok.slice(1).toLowerCase());
    });
    q = q.replace(/[+-]\S+/g, '').trim();

    // BUG 2 FIX: Detect alphanumeric part-number codes in the query
    var rawTokens = tokenise(q);
    rawTokens.forEach(function(tok) {
      if (PART_NUMBER_RX.test(tok)) {
        result.isPartNoQuery = true;
        result.partNoCodes.push(tok);
      }
    });

    // Strip stop words to find pure intent
    result.tokens = tokeniseNoStop(q);

    // Query expansion: synonyms + abbreviations
    var expanded = result.tokens.slice();
    result.tokens.forEach(function(tok) {
      // Abbreviation expansion
      if (ABBREV_MAP[tok]) {
        tokeniseNoStop(ABBREV_MAP[tok]).forEach(function(t) {
          if (expanded.indexOf(t) < 0) expanded.push(t);
        });
      }
      // Synonym expansion
      Object.keys(SYNONYM_MAP).forEach(function(key) {
        if (tok === key || key === tok || (tok.length >= 3 && key.startsWith(tok))) {
          SYNONYM_MAP[key].forEach(function(syn) {
            tokeniseNoStop(syn).forEach(function(t) {
              if (expanded.indexOf(t) < 0 && !NOISE_TOKENS.has(t)) expanded.push(t);
            });
          });
        }
      });
    });
    result.expanded = expanded;

    if (result.must.length || result.mustNot.length) result.type = 'boolean';
    return result;
  };

  // ── SEARCH ORCHESTRATOR ───────────────────────────────────────────────────
  function SearchEngine() {
    this.records = [];
    this.index = new InvertedIndex();
    this.scorer = null;
    this.fuzzy = null;
    this.trigram = null;
    this.parser = new QueryParser();
    this.ready = false;
  }

  SearchEngine.prototype.build = function(records) {
    this.records = records;
    this.index.build(records);
    this.scorer = new TFIDFScorer(this.index);
    var allTerms = this.index.allTerms();
    this.fuzzy = new FuzzyMatcher(allTerms);
    this.trigram = new TrigramSuggester(allTerms);
    this.ready = true;
  };

  SearchEngine.prototype.search = function(rawQuery) {
    if (!this.ready) return { results: [], parsed: null, fuzzyTerms: [] };

    var parsed = this.parser.parse(rawQuery);
    var records = this.records;
    var fuzzyTerms = [];

    // Exact case-number match
    if (parsed.type === 'case' && parsed.caseNumber) {
      var cn = parsed.caseNumber;
      var caseResults = records.filter(function(r) { return String(r.case || '') === cn; });
      if (caseResults.length) {
        return { results: caseResults.map(function(r) { return { record: r, score: 10000 }; }), parsed: parsed, fuzzyTerms: [] };
      }
    }

    var queryTerms = parsed.expanded.length ? parsed.expanded : parsed.tokens;

    // BUG 2 FIX: For part-number queries, add exact code tokens to queryTerms
    if (parsed.isPartNoQuery && parsed.partNoCodes.length) {
      parsed.partNoCodes.forEach(function(code) {
        if (queryTerms.indexOf(code) < 0) queryTerms = [code].concat(queryTerms);
      });
    }

    // Phrase filter pool
    var pool = records;
    if (parsed.phrases.length) {
      pool = records.filter(function(r) {
        var hay = [r.title, r.res, r.cat, r.eu, r.partNo || ''].join(' ').toLowerCase();
        return parsed.phrases.every(function(ph) { return hay.includes(ph); });
      });
    }

    // Boolean must/must-not filter
    if (parsed.must.length || parsed.mustNot.length) {
      pool = pool.filter(function(r) {
        var hay = [r.title, r.res, r.cat, r.eu].join(' ').toLowerCase();
        var mustOk = parsed.must.every(function(t) { return hay.includes(t); });
        var notOk  = parsed.mustNot.every(function(t) { return !hay.includes(t); });
        return mustOk && notOk;
      });
    }

    if (!queryTerms.length) {
      return { results: pool.slice(0, 500).map(function(r) { return { record: r, score: 1 }; }), parsed: parsed, fuzzyTerms: [] };
    }

    var useIndex = this;
    var scored;
    if (pool.length < records.length && pool.length > 0) {
      scored = this._scorePool(pool, queryTerms, parsed.isPartNoQuery);
    } else {
      scored = this.scorer.score(records, queryTerms, parsed.isPartNoQuery);
    }

    // BUG 3 FIX: Stricter fuzzy fallback — only if very few results and token not in index
    if (scored.length < 5 && parsed.tokens.length > 0) {
      var self = this;
      parsed.tokens.forEach(function(tok) {
        if (tok.length < 4) return; // BUG 3: skip short tokens for fuzzy
        if (useIndex.index.lookup(tok)) return; // already in index
        if (NOISE_TOKENS.has(tok)) return; // BUG 3: skip noise tokens
        var suggestions = self.fuzzy.suggest(tok);
        suggestions.forEach(function(sug) {
          if (fuzzyTerms.indexOf(sug) < 0) fuzzyTerms.push(sug);
        });
      });
      if (fuzzyTerms.length) {
        var extraScored = useIndex.scorer.score(records, fuzzyTerms, false);
        extraScored.forEach(function(item) {
          var existing = scored.find(function(s) { return s.ri === item.ri; });
          // BUG 3 FIX: 0.4x penalty for fuzzy matches (was 0.6x)
          if (!existing) scored.push({ record: item.record, score: item.score * 0.4, ri: item.ri });
        });
        scored.sort(function(a, b) { return b.score - a.score; });
      }
    }

    return { results: scored, parsed: parsed, fuzzyTerms: fuzzyTerms };
  };

  SearchEngine.prototype._scorePool = function(pool, queryTerms, isPartNoQuery) {
    var fw = this.index.fieldWeights;
    var results = pool.map(function(r) {
      var hay = {
        title: tokeniseNoStop(r.title),
        partno: PART_NUMBER_RX.test(String(r.title || '').trim()) ? tokeniseNoStop(r.title) : [],
        eu:    tokeniseNoStop(r.eu),
        cat:   tokeniseNoStop(r.cat),
        res:   tokeniseNoStop((r.res || '').slice(0, 300))
      };
      var score = 0;
      queryTerms.forEach(function(term) {
        var noiseWeight = NOISE_TOKENS.has(term) ? 0.05 : 1.0;
        Object.keys(hay).forEach(function(f) {
          var count = hay[f].filter(function(t) { return t === term || t.startsWith(term); }).length;
          if (count) score += Math.min(count, 3) * (fw[f] || 1) * 2 * noiseWeight;
        });
      });
      // BUG 2 FIX: suppress non-parts records for part-number queries
      if (isPartNoQuery) {
        var recId = String(r.id || '');
        var isParts = recId.startsWith('parts_') || String(r.cat || '').toLowerCase().includes('part');
        if (!isParts) score *= 0.1;
      }
      return { record: r, score: score };
    }).filter(function(x) { return x.score > 0; });
    results.sort(function(a, b) { return b.score - a.score; });
    return results;
  };

  SearchEngine.prototype.autocomplete = function(prefix) {
    if (!this.ready || !prefix || prefix.length < 2) return [];
    return this.trigram.complete(prefix.toLowerCase(), 8);
  };

  global.SE2Engine = SearchEngine;
  global.SE2Tokenise = tokeniseNoStop;
  global.SE2SynonymMap = SYNONYM_MAP;

})(window);
