/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

/**
 * MUMS Search Engine v2 — Advanced Client-Side Search
 * Inverted Index + TF-IDF + Fuzzy Matching + Trigram Autocomplete + NLP Query Parser
 * Pure client-side JavaScript — zero external dependencies
 */
(function(global) {
  'use strict';

  // ── STOP WORDS ────────────────────────────────────────────────────────────
  var STOP_WORDS = new Set([
    'the','a','an','is','are','was','were','to','for','in','on','of','and','or',
    'but','not','with','this','that','these','those','from','by','at','be','been',
    'have','has','had','do','does','did','will','would','could','should','may',
    'might','can','its','it','as','so','if','then','than','when','where','how',
    'what','which','who','there','their','they','them','our','your','we','us',
    'i','my','me','he','she','his','her','him','was','about','after','before',
    'also','any','some','all','more','most','just','up','out','get','got','per'
  ]);

  // ── SYNONYM MAP ───────────────────────────────────────────────────────────
  var SYNONYM_MAP = {
    'offline':      ['down','unreachable','not responding','disconnected','no communication','off'],
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
    'offline delay':['offline delay alarm','delayed offline','delay alarm','oda']
  };

  // ── ABBREVIATIONS ─────────────────────────────────────────────────────────
  var ABBREV_MAP = {
    'e2':'e2 controller', 'e3':'e3 gateway', 'wm':'walmart',
    'qb':'quickbase', 'cp':'connect+', 'ss':'site supervisor',
    'lk':'license key', 'cs':'custom screen', 'fp':'floor plan',
    'sw':'software', 'fw':'firmware', 'hw':'hardware', 'rtu':'modbus rtu',
    'tcp':'modbus tcp', 'vfd':'variable frequency drive', 'eev':'electronic expansion valve',
    'rga':'return goods authorization', 'rma':'return merchandise authorization',
    'sp':'setpoint', 'pcr':'programming configuration request', 'oda':'offline delay alarm'
  };

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
    this.index = {};          // term → { df, postings: [{ri, fields, tf}] }
    this.docCount = 0;
    this.docLengths = [];     // total terms per doc (for TF normalisation)
    this.fieldWeights = { title:4, eu:2.5, cat:2, case:5, res:1 };
  }

  InvertedIndex.prototype.build = function(records) {
    var self = this;
    self.docCount = records.length;
    self.index = {};
    self.docLengths = new Array(records.length).fill(0);

    records.forEach(function(r, ri) {
      var fields = {
        title: tokeniseNoStop(r.title),
        eu:    tokeniseNoStop(r.eu),
        cat:   tokeniseNoStop(r.cat),
        case:  tokenise(r.case),
        res:   tokeniseNoStop((r.res || '').slice(0, 400))
      };
      var tfMap = {};   // term → { field, count }

      Object.keys(fields).forEach(function(f) {
        fields[f].forEach(function(term) {
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

  InvertedIndex.prototype.lookup = function(term) {
    return this.index[term] || null;
  };

  InvertedIndex.prototype.allTerms = function() {
    return Object.keys(this.index);
  };

  // ── TF-IDF SCORER ─────────────────────────────────────────────────────────
  function TFIDFScorer(invertedIndex) {
    this.idx = invertedIndex;
    this.FW = invertedIndex.fieldWeights;
  }

  TFIDFScorer.prototype.score = function(records, queryTerms) {
    var self = this;
    var scores = new Float32Array(records.length);
    var N = self.idx.docCount;

    queryTerms.forEach(function(term) {
      var entry = self.idx.lookup(term);
      if (!entry) return;
      var df = entry.df;
      var idf = Math.log((N + 1) / (df + 1)) + 1;

      entry.postings.forEach(function(p) {
        var docLen = self.idx.docLengths[p.ri] || 1;
        var tf = (p.tf / docLen) * 100;  // normalised TF
        var fieldBoost = 0;
        Object.keys(p.fields).forEach(function(f) {
          fieldBoost += (self.FW[f] || 1) * p.fields[f];
        });
        scores[p.ri] += tf * idf * Math.log1p(fieldBoost);
      });
    });

    // Build ranked result array (skip zero scores)
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
    // Keep only terms ≥ 3 chars for fuzzy matching performance
    this.terms = indexedTerms.filter(function(t) { return t.length >= 3; });
  }

  FuzzyMatcher.prototype.suggest = function(typo, maxDist) {
    if (!typo || typo.length < 3) return [];
    maxDist = maxDist || (typo.length <= 4 ? 1 : 2);
    var results = [];
    var self = this;
    self.terms.forEach(function(term) {
      if (Math.abs(term.length - typo.length) > maxDist) return;
      var d = levenshtein(typo, term);
      if (d <= maxDist) results.push({ term: term, dist: d });
    });
    results.sort(function(a, b) { return a.dist - b.dist; });
    return results.slice(0, 5).map(function(r) { return r.term; });
  };

  // ── TRIGRAM SUGGESTER ─────────────────────────────────────────────────────
  function TrigramSuggester(allTerms) {
    this.termFreq = {};   // term → frequency (proxy for importance)
    this.trigramMap = {}; // trigram → [terms]
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
    if (!prefix || prefix.length < 2) return [];
    limit = limit || 8;

    // Prefix matches first
    var prefixMatches = Object.keys(this.termFreq).filter(function(t) {
      return t.startsWith(prefix) && t !== prefix;
    });
    prefixMatches.sort(function(a, b) { return b.length - a.length; });

    // Trigram similarity for non-prefix
    var scored = {};
    var tgs = this._trigrams(prefix);
    var self = this;
    tgs.forEach(function(tg) {
      (self.trigramMap[tg] || []).forEach(function(term) {
        if (term.startsWith(prefix)) return; // already in prefix matches
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

  // ── QUERY PARSER ──────────────────────────────────────────────────────────
  function QueryParser() {}

  QueryParser.prototype.parse = function(raw) {
    var q = String(raw || '').trim();
    var result = {
      original: q,
      type: 'keyword',   // 'case' | 'phrase' | 'boolean' | 'question' | 'keyword'
      caseNumber: null,
      must: [],
      mustNot: [],
      phrases: [],
      tokens: [],
      expanded: []
    };
    if (!q) return result;

    // Detect direct case lookup
    var caseMatch = q.match(/(?:^|\s)(?:#|case\s+)(\d{5,7})(?:\s|$)/i);
    if (caseMatch) {
      result.type = 'case';
      result.caseNumber = caseMatch[1];
      return result;
    }

    // Detect question format
    if (/^(how|what|why|when|where|who|is|can|does|should)\b/i.test(q)) {
      result.type = 'question';
    }

    // Extract quoted phrases
    var phraseRx = /"([^"]+)"/g;
    var m;
    while ((m = phraseRx.exec(q)) !== null) {
      result.phrases.push(m[1].toLowerCase());
    }
    q = q.replace(phraseRx, '');

    // Extract boolean operators: +term -term
    var tokens = q.split(/\s+/);
    tokens.forEach(function(tok) {
      if (tok.startsWith('+') && tok.length > 1) result.must.push(tok.slice(1).toLowerCase());
      else if (tok.startsWith('-') && tok.length > 1) result.mustNot.push(tok.slice(1).toLowerCase());
    });
    q = q.replace(/[+-]\S+/g, '').trim();

    // Tokenise remaining query
    result.tokens = tokeniseNoStop(q).filter(function(t) {
      return !STOP_WORDS.has(t);
    });

    // Expand with synonyms
    var expanded = result.tokens.slice();
    result.tokens.forEach(function(tok) {
      // Check abbreviations
      if (ABBREV_MAP[tok]) {
        tokeniseNoStop(ABBREV_MAP[tok]).forEach(function(t) {
          if (expanded.indexOf(t) < 0) expanded.push(t);
        });
      }
      // Check synonyms
      Object.keys(SYNONYM_MAP).forEach(function(key) {
        if (tok === key || key.startsWith(tok + ' ') || tok.startsWith(key)) {
          SYNONYM_MAP[key].forEach(function(syn) {
            tokeniseNoStop(syn).forEach(function(t) {
              if (expanded.indexOf(t) < 0) expanded.push(t);
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

    // Direct case number lookup
    if (parsed.type === 'case' && parsed.caseNumber) {
      var cn = parsed.caseNumber;
      var caseResults = records.filter(function(r) { return String(r.case || '') === cn; });
      if (caseResults.length) {
        return { results: caseResults.map(function(r) { return { record: r, score: 10000 }; }), parsed: parsed, fuzzyTerms: [] };
      }
    }

    var queryTerms = parsed.expanded.length ? parsed.expanded : parsed.tokens;

    // Exact phrase matching (filter first)
    var pool = records;
    if (parsed.phrases.length) {
      pool = records.filter(function(r) {
        var hay = [r.title, r.res, r.cat, r.eu].join(' ').toLowerCase();
        return parsed.phrases.every(function(ph) { return hay.includes(ph); });
      });
    }

    // Boolean must/must-not filters
    if (parsed.must.length || parsed.mustNot.length) {
      pool = pool.filter(function(r) {
        var hay = [r.title, r.res, r.cat, r.eu].join(' ').toLowerCase();
        var mustOk = parsed.must.every(function(t) { return hay.includes(t); });
        var notOk  = parsed.mustNot.every(function(t) { return !hay.includes(t); });
        return mustOk && notOk;
      });
    }

    // If no queryTerms, return phrase/boolean filtered pool
    if (!queryTerms.length) {
      return { results: pool.slice(0, 500).map(function(r) { return { record: r, score: 1 }; }), parsed: parsed, fuzzyTerms: [] };
    }

    // Rebuild sub-index for filtered pool if needed
    var useIndex = this;
    var scored;
    if (pool.length < records.length && pool.length > 0) {
      // Build a minimal scoring pass over the pool
      scored = this._scorePool(pool, queryTerms);
    } else {
      scored = this.scorer.score(records, queryTerms);
    }

    // Fuzzy fallback: if very few results, expand with fuzzy terms
    if (scored.length < 5 && parsed.tokens.length > 0) {
      var self = this;
      parsed.tokens.forEach(function(tok) {
        if (useIndex.index.lookup(tok)) return; // exact term exists
        var suggestions = self.fuzzy.suggest(tok, tok.length <= 4 ? 1 : 2);
        suggestions.forEach(function(sug) {
          if (fuzzyTerms.indexOf(sug) < 0) fuzzyTerms.push(sug);
        });
      });
      if (fuzzyTerms.length) {
        var extraScored = useIndex.scorer.score(records, fuzzyTerms);
        // Merge with penalty (0.6x for fuzzy matches)
        extraScored.forEach(function(item) {
          var existing = scored.find(function(s) { return s.ri === item.ri; });
          if (!existing) scored.push({ record: item.record, score: item.score * 0.6, ri: item.ri });
        });
        scored.sort(function(a, b) { return b.score - a.score; });
      }
    }

    return { results: scored, parsed: parsed, fuzzyTerms: fuzzyTerms };
  };

  SearchEngine.prototype._scorePool = function(pool, queryTerms) {
    // Lightweight scoring over a subset — no full index needed
    var fw = this.index.fieldWeights;
    var results = pool.map(function(r) {
      var hay = {
        title: tokeniseNoStop(r.title),
        eu:    tokeniseNoStop(r.eu),
        cat:   tokeniseNoStop(r.cat),
        res:   tokeniseNoStop((r.res || '').slice(0, 400))
      };
      var score = 0;
      queryTerms.forEach(function(term) {
        Object.keys(hay).forEach(function(f) {
          var count = hay[f].filter(function(t) { return t === term || t.startsWith(term); }).length;
          if (count) score += count * (fw[f] || 1) * 2;
        });
      });
      return { record: r, score: score };
    }).filter(function(x) { return x.score > 0; });
    results.sort(function(a, b) { return b.score - a.score; });
    return results;
  };

  SearchEngine.prototype.autocomplete = function(prefix) {
    if (!this.ready || !prefix || prefix.length < 2) return [];
    return this.trigram.complete(prefix.toLowerCase(), 8);
  };

  // Expose globally
  global.SE2Engine = SearchEngine;
  global.SE2Tokenise = tokeniseNoStop;

})(window);
