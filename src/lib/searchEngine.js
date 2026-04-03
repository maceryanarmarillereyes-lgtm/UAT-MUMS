function normalize(text) {
  if (!text) return '';
  return String(text).toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function scoreRecord(record, queryTerms, queryNormalized) {
  let score = 0;
  const fields = [
    { value: record.title, weight: 10 },
    { value: record.case_number, weight: 8 },
    { value: record.category_name, weight: 5 },
    { value: record.end_user, weight: 6 },
    { value: record.part_number, weight: 7 },
    { value: record.description, weight: 4 },
    { value: record.resolution, weight: 3 },
    { value: record.category_id, weight: 2 },
  ];
  for (const field of fields) {
    if (!field.value) continue;
    const normalized = normalize(field.value);
    if (normalized.includes(queryNormalized)) score += field.weight * 5;
    for (const term of queryTerms) {
      if (term.length < 2) continue;
      if (normalized.includes(term)) {
        score += field.weight * 3;
        const regex = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
        if (regex.test(field.value)) score += field.weight * 1;
      } else {
        for (const word of normalized.split(' ')) {
          if (word.startsWith(term)) { score += field.weight * 2; break; }
          if (word.includes(term) && term.length >= 3) { score += field.weight * 1; break; }
        }
      }
    }
  }
  return score;
}

export function searchRecords(records, query) {
  if (!query || !query.trim()) return [];
  const queryNormalized = normalize(query);
  const queryTerms = queryNormalized.split(' ').filter(t => t.length >= 1);
  if (queryTerms.length === 0) return [];
  return records
    .map(record => ({ record, score: scoreRecord(record, queryTerms, queryNormalized) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(item => item.record);
}

export function countBySource(records) {
  const counts = { all: records.length, quickbase: 0, knowledge_base: 0, contact_info: 0, parts_number: 0, product_controllers: 0, support_records: 0 };
  records.forEach(r => { if (counts[r.source_tab] !== undefined) counts[r.source_tab]++; });
  return counts;
}

export function countTotalBySource(records) {
  const counts = {};
  records.forEach(r => { const src = r.source_tab || 'unknown'; counts[src] = (counts[src] || 0) + 1; });
  return counts;
}
