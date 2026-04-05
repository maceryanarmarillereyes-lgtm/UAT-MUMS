/**
 * MUMS Support Studio - High Level Enterprise Search Engine v2
 * Features:
 * - Full dataset ingestion (no field limits)
 * - Fuzzy/typo tolerance (Levenshtein distance)
 * - Question format parsing ("what is", "how to", "where is", etc.)
 * - Dynamic field coverage (covers ALL fields on ANY record, including future ones)
 * - N-gram partial matching
 * - Multi-term AND/OR logic
 * - Relevance scoring with field weighting
 * - Stemming / common abbreviation expansion
 */

// ─── Normalization ────────────────────────────────────────────────────────────
export function normalize(text) {
  if (!text) return '';
  return String(text)
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Question format stripping ────────────────────────────────────────────────
const QUESTION_PREFIXES = [
  'what is', 'what are', 'what was', 'what were',
  'how to', 'how do', 'how does', 'how can', 'how did',
  'where is', 'where are', 'where do', 'where can',
  'why is', 'why are', 'why does', 'why did',
  'when is', 'when was', 'when did',
  'who is', 'who are', 'who was',
  'can i', 'can you', 'please', 'help me', 'tell me',
  'show me', 'find me', 'search for', 'look for',
  'i need', 'i want', 'i am looking for',
];

function stripQuestionWords(query) {
  let q = normalize(query);
  for (const prefix of QUESTION_PREFIXES) {
    if (q.startsWith(prefix + ' ')) {
      q = q.slice(prefix.length).trim();
    }
  }
  q = q.replace(/[?!.,]+$/, '').trim();
  return q;
}

// ─── Common abbreviation / synonym expansion ──────────────────────────────────
const SYNONYMS = {
  'kb': 'knowledge base',
  'qb': 'quickbase',
  'ctrl': 'controller',
  'pn': 'part number',
  'p/n': 'part number',
  'sn': 'serial number',
  's/n': 'serial number',
  'fw': 'firmware',
  'hw': 'hardware',
  'sw': 'software',
  'e2': 'e2 controller',
  'e3': 'e3 controller',
  'rx': 'refrigeration controller',
  'ip': 'ip address',
  'pw': 'password',
  'cfg': 'configuration',
  'config': 'configuration',
  'err': 'error',
  'msg': 'message',
  'rma': 'return merchandise authorization',
  'wo': 'work order',
};

function expandSynonyms(terms) {
  const expanded = new Set(terms);
  terms.forEach(t => {
    if (SYNONYMS[t]) {
      SYNONYMS[t].split(' ').forEach(w => expanded.add(w));
    }
  });
  return [...expanded];
}

// ─── Levenshtein distance for typo tolerance ─────────────────────────────────
function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function fuzzyScore(term, word) {
  if (word === term) return 1;
  if (word.includes(term)) return 0.9;
  if (word.startsWith(term)) return 0.85;
  if (term.length <= 3) return 0;
  const dist = levenshtein(term, word);
  const maxLen = Math.max(term.length, word.length);
  const similarity = 1 - dist / maxLen;
  if (dist <= 1 && term.length >= 4) return 0.7;
  if (dist <= 2 && term.length >= 6) return 0.5;
  return similarity >= 0.75 ? similarity * 0.4 : 0;
}

// ─── Field weight registry ────────────────────────────────────────────────────
const FIELD_WEIGHTS = {
  title: 10,
  case_number: 9,
  part_number: 8,
  end_user: 7,
  category_name: 6,
  description: 5,
  resolution: 4,
  category_id: 3,
};

const SKIP_FIELDS = new Set([
  'id', 'created_date', 'updated_date', 'created_by',
  'icon', 'color', 'source_tab',
]);

function getSearchableFields(record) {
  return Object.entries(record)
    .filter(([key, val]) => !SKIP_FIELDS.has(key) && val && typeof val === 'string')
    .map(([key, val]) => ({
      key,
      value: val,
      weight: FIELD_WEIGHTS[key] || 2,
    }));
}

function scoreRecord(record, queryTerms, fullQuery) {
  let score = 0;
  const fields = getSearchableFields(record);

  for (const field of fields) {
    const normalized = normalize(field.value);

    if (normalized.includes(fullQuery)) {
      score += field.weight * 6;
      continue;
    }

    let termMatchCount = 0;
    for (const term of queryTerms) {
      if (term.length < 2) continue;

      const fieldWords = normalized.split(' ');
      let bestTermScore = 0;

      if (normalized.includes(term)) {
        bestTermScore = Math.max(bestTermScore, field.weight * 3);
        const safeT = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`\\b${safeT}`).test(normalized)) {
          bestTermScore += field.weight * 1;
        }
      }

      for (const word of fieldWords) {
        if (Math.abs(word.length - term.length) > 4) continue;
        const fs = fuzzyScore(term, word);
        if (fs > 0) {
          bestTermScore = Math.max(bestTermScore, field.weight * fs * 2);
        }
      }

      if (bestTermScore > 0) termMatchCount++;
      score += bestTermScore;
    }

    if (termMatchCount === queryTerms.length && queryTerms.length > 1) {
      score += field.weight * 3;
    }
  }

  return score;
}

export function searchRecords(records, query) {
  if (!query || !query.trim()) return [];
  const cleaned = stripQuestionWords(query);
  const queryNormalized = normalize(cleaned);
  let queryTerms = queryNormalized.split(' ').filter(t => t.length >= 1);
  queryTerms = expandSynonyms(queryTerms);
  if (queryTerms.length === 0) return [];

  return records
    .map(record => ({ record, score: scoreRecord(record, queryTerms, queryNormalized) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(item => item.record);
}

export function isPureConnectPlusRecord(record) {
  if (!record || record.source_tab !== 'connect_plus') return false;
  const caseNumber = String(record.case_number || '').trim();
  return caseNumber.length === 0;
}

export function matchesSourceTab(record, tabId) {
  if (!record) return false;
  if (tabId === 'connect_plus') return isPureConnectPlusRecord(record);
  return record.source_tab === tabId;
}

export function countBySource(records) {
  const counts = { all: records.length };
  records.forEach(r => {
    if (isPureConnectPlusRecord(r)) {
      counts.connect_plus = (counts.connect_plus || 0) + 1;
      return;
    }
    const src = r.source_tab || 'unknown';
    if (src === 'connect_plus') return;
    counts[src] = (counts[src] || 0) + 1;
  });
  return counts;
}

export function countTotalBySource(records) {
  const counts = {};
  records.forEach(r => {
    if (isPureConnectPlusRecord(r)) {
      counts.connect_plus = (counts.connect_plus || 0) + 1;
      return;
    }
    const src = r.source_tab || 'unknown';
    if (src === 'connect_plus') return;
    counts[src] = (counts[src] || 0) + 1;
  });
  return counts;
}
