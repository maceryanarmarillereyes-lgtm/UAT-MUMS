(function (global) {
  'use strict';

  const STOP_WORDS = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'to', 'for', 'in', 'on', 'of', 'and', 'or', 'with', 'at', 'by', 'from']);

  const SYNONYM_MAP = {
    offline: ['down', 'unreachable', 'not responding', 'disconnected', 'no communication', 'comm loss', 'not online'],
    license: ['license key', 'activation', 'licence', 'entitlement'],
    firmware: ['firmware update', 'software update', 'fw update', 'version upgrade'],
    onboarding: ['setup', 'installation', 'commissioning', 'initial setup'],
    e2: ['e2 controller', 'e2e', 'einstein e2'],
    e3: ['e3 controller', 'e3 gateway', 'einstein e3'],
    wm: ['walmart'],
    qb: ['quickbase'],
    modbus: ['modbus rtu', 'modbus tcp', 'serial communication'],
    vfd: ['variable frequency drive', 'drive'],
    rack: ['rack controller', 'refrigeration rack'],
    setpoint: ['setpoints', 'set point', 'set points'],
    azure: ['azure alert', 'azure monitor'],
    'connect+': ['connectplus', 'connect plus'],
    controller: ['ctrl', 'control'],
    sensor: ['probe', 'temperature sensor'],
    alarm: ['alert', 'notification'],
    password: ['credential', 'login'],
    network: ['net', 'lan', 'wan', 'ip'],
    comm: ['communication', 'connectivity'],
    reset: ['reboot', 'restart', 'power cycle'],
    haccp: ['temperature log', 'food safety'],
    floorplan: ['floor plan', 'map screen'],
    supervisor: ['site supervisor', 'ss'],
    xm: ['xm controller'],
    xr: ['xr controller'],
    sporlan: ['danfoss', 'valve'],
    part: ['part number', 'sku', 'pn'],
    pending: ['awaiting', 'in progress'],
    closed: ['resolved', 'complete'],
    open: ['new', 'active'],
    case: ['ticket', 'incident'],
    gateway: ['edge gateway'],
    telemetry: ['data report', 'logs'],
    disconnected: ['offline', 'down'],
    walmart: ['wm'],
    quickbase: ['qb']
  };

  function tokenize(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9+#\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  class InvertedIndex {
    constructor(records) {
      this.records = records || [];
      this.termMap = new Map();
      this.docStats = [];
      this.vocab = new Set();
    }

    build() {
      const fields = ['title', 'res', 'eu', 'case', 'cat'];
      this.records.forEach((record, recordIndex) => {
        const fieldTokens = {};
        let totalTerms = 0;
        fields.forEach((field) => {
          const tokens = tokenize(record[field]);
          fieldTokens[field] = tokens;
          totalTerms += tokens.length;
        });
        this.docStats[recordIndex] = { totalTerms: totalTerms || 1, fieldTokens };

        fields.forEach((field) => {
          const counts = new Map();
          fieldTokens[field].forEach((term, position) => {
            counts.set(term, (counts.get(term) || 0) + 1);
            if (!this.termMap.has(term)) this.termMap.set(term, []);
            this.termMap.get(term).push({ recordIndex, field, position });
            this.vocab.add(term);
          });
          counts.forEach((count, term) => {
            const postings = this.termMap.get(term);
            for (let i = postings.length - 1; i >= 0; i -= 1) {
              const p = postings[i];
              if (p.recordIndex === recordIndex && p.field === field && p.tf === undefined) {
                p.tf = count / this.docStats[recordIndex].totalTerms;
                break;
              }
            }
          });
        });
      });
      return this;
    }

    getPostings(term) {
      return this.termMap.get(term) || [];
    }

    getDocFreq(term) {
      const postings = this.getPostings(term);
      return new Set(postings.map((p) => p.recordIndex)).size;
    }
  }

  class TFIDFScorer {
    constructor(index) {
      this.index = index;
      this.docCount = index.records.length || 1;
      this.boost = { title: 3.0, case: 5.0, eu: 2.0, res: 1.0, cat: 1.5 };
    }

    score(queryTerms, options) {
      const scores = new Map();
      const termMeta = options?.termMeta || new Map();
      queryTerms.forEach((term) => {
        const postings = this.index.getPostings(term);
        const df = this.index.getDocFreq(term);
        if (!df) return;
        const idf = Math.log((this.docCount + 1) / (df + 1)) + 1;
        postings.forEach((p) => {
          const fuzzBoost = termMeta.get(term)?.similarity || 1;
          const s = (p.tf || 0) * idf * (this.boost[p.field] || 1) * fuzzBoost;
          scores.set(p.recordIndex, (scores.get(p.recordIndex) || 0) + s);
        });
      });
      return scores;
    }
  }

  class FuzzyMatcher {
    constructor(vocabulary) {
      this.vocabulary = Array.from(vocabulary || []);
      this.abbr = {
        e2: ['e2', 'controller', 'gateway'],
        e3: ['e3', 'controller', 'gateway'],
        wm: ['walmart'],
        qb: ['quickbase']
      };
    }

    levenshtein(a, b) {
      if (a === b) return 0;
      const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
      for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
      for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
      for (let i = 1; i <= a.length; i += 1) {
        for (let j = 1; j <= b.length; j += 1) {
          const cost = a[i - 1] === b[j - 1] ? 0 : 1;
          dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
        }
      }
      return dp[a.length][b.length];
    }

    bigramSimilarity(a, b) {
      function bigrams(s) {
        const set = new Set();
        for (let i = 0; i < s.length - 1; i += 1) set.add(s.slice(i, i + 2));
        return set;
      }
      const A = bigrams(a);
      const B = bigrams(b);
      if (!A.size || !B.size) return 0;
      let inter = 0;
      A.forEach((x) => {
        if (B.has(x)) inter += 1;
      });
      return (2 * inter) / (A.size + B.size);
    }

    findClosest(term) {
      const t = term.toLowerCase();
      if (this.abbr[t]) {
        return this.abbr[t].map((x) => ({ term: x, similarity: 0.95 }));
      }
      let best = [];
      const threshold = t.length > 4 ? 2 : 1;
      this.vocabulary.forEach((word) => {
        if (Math.abs(word.length - t.length) > 3) return;
        const dist = this.levenshtein(t, word);
        const sim = word.length <= 4 || t.length <= 4 ? this.bigramSimilarity(t, word) : 1 - dist / Math.max(word.length, t.length);
        if ((t.length > 4 && dist <= threshold) || sim >= 0.62) {
          best.push({ term: word, similarity: Math.max(0.5, sim) });
        }
      });
      best = best.sort((a, b) => b.similarity - a.similarity).slice(0, 6);
      return best;
    }
  }

  class TrigramSuggester {
    constructor(vocabulary) {
      this.index = new Map();
      this.termFreq = new Map();
      (vocabulary || []).forEach((term) => this.addTerm(term));
    }

    getTrigrams(term) {
      const t = `  ${term.toLowerCase()} `;
      const grams = [];
      for (let i = 0; i < t.length - 2; i += 1) grams.push(t.slice(i, i + 3));
      return grams;
    }

    addTerm(term) {
      const grams = this.getTrigrams(term);
      this.termFreq.set(term, (this.termFreq.get(term) || 0) + 1);
      grams.forEach((g) => {
        if (!this.index.has(g)) this.index.set(g, new Set());
        this.index.get(g).add(term);
      });
    }

    suggest(input, limit = 8) {
      const q = String(input || '').trim().toLowerCase();
      if (!q || q.length < 2) return [];
      const grams = this.getTrigrams(q);
      const candidates = new Map();
      grams.forEach((g) => {
        (this.index.get(g) || []).forEach((term) => {
          candidates.set(term, (candidates.get(term) || 0) + 1);
        });
      });
      return Array.from(candidates.entries())
        .map(([term, overlap]) => ({ term, overlap, freq: this.termFreq.get(term) || 1 }))
        .sort((a, b) => (b.overlap - a.overlap) || (b.freq - a.freq) || a.term.localeCompare(b.term))
        .slice(0, limit);
    }
  }

  class QueryParser {
    parse(raw) {
      const q = String(raw || '').trim();
      const intent = /^(how to)\b/i.test(q) ? 'how_to' : /^(what is)\b/i.test(q) ? 'definition' : 'general';
      const caseMatch = q.match(/(?:case\s*|#)(\d{4,})/i);
      const phrases = [...q.matchAll(/"([^"]+)"/g)].map((m) => m[1].toLowerCase());
      const mustInclude = [...q.matchAll(/\+([a-z0-9+]+)/gi)].map((m) => m[1].toLowerCase());
      const mustExclude = [...q.matchAll(/-([a-z0-9+]+)/gi)].map((m) => m[1].toLowerCase());
      const cleaned = q.replace(/"[^"]+"/g, ' ').replace(/[+-][a-z0-9+]+/gi, ' ');
      const terms = tokenize(cleaned).filter((t) => !STOP_WORDS.has(t));
      return { raw: q, intent, caseNumber: caseMatch ? caseMatch[1] : null, phrases, mustInclude, mustExclude, terms };
    }

    expandTerms(terms) {
      const out = new Set(terms);
      terms.forEach((term) => {
        const syns = SYNONYM_MAP[term];
        if (!syns) return;
        syns.forEach((s) => tokenize(s).forEach((tk) => out.add(tk)));
      });
      return Array.from(out);
    }
  }

  class SearchEngineV2 {
    constructor(records) {
      this.records = records || [];
      this.index = new InvertedIndex(this.records).build();
      this.parser = new QueryParser();
      this.fuzzy = new FuzzyMatcher(this.index.vocab);
      this.scorer = new TFIDFScorer(this.index);
      this.suggester = new TrigramSuggester(Array.from(this.index.vocab));
    }

    matchesOperators(record, parsed) {
      const blob = `${record.title || ''} ${record.res || ''} ${record.eu || ''} ${record.case || ''} ${record.cat || ''}`.toLowerCase();
      if (parsed.mustInclude.some((x) => !blob.includes(x))) return false;
      if (parsed.mustExclude.some((x) => blob.includes(x))) return false;
      if (parsed.phrases.some((p) => !blob.includes(p))) return false;
      return true;
    }

    search(rawQuery) {
      const parsed = this.parser.parse(rawQuery);
      if (!parsed.raw) return { parsed, results: [], total: 0, fuzzyTerms: [] };

      if (parsed.caseNumber) {
        const exact = this.records
          .map((r, idx) => ({ r, idx }))
          .filter((x) => String(x.r.case || '').includes(parsed.caseNumber))
          .map((x) => ({ ...x.r, _score: 999, _recordIndex: x.idx }));
        return { parsed, results: exact, total: exact.length, fuzzyTerms: [] };
      }

      const expanded = this.parser.expandTerms(parsed.terms);
      const queryTerms = [];
      const termMeta = new Map();
      const fuzzyTerms = [];

      expanded.forEach((term) => {
        if (this.index.termMap.has(term)) {
          queryTerms.push(term);
          termMeta.set(term, { similarity: 1 });
        } else {
          const close = this.fuzzy.findClosest(term);
          close.forEach((m) => {
            queryTerms.push(m.term);
            termMeta.set(m.term, { similarity: m.similarity });
            fuzzyTerms.push(m.term);
          });
        }
      });

      const scores = this.scorer.score(queryTerms, { termMeta });
      let rows = Array.from(scores.entries()).map(([idx, score]) => ({ ...this.records[idx], _score: score, _recordIndex: idx }));
      rows = rows.filter((r) => this.matchesOperators(r, parsed));
      rows.sort((a, b) => b._score - a._score);
      return { parsed, results: rows, total: rows.length, fuzzyTerms: Array.from(new Set(fuzzyTerms)).slice(0, 8) };
    }
  }

  global.SearchEngineV2 = SearchEngineV2;
  global.SE2SynonymMap = SYNONYM_MAP;
})();
