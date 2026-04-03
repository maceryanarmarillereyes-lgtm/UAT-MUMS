/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

const OPERATOR_ALIASES = {
  'Is Not': 'XEX',
  'Not Equal To': 'XEX',
  'Is Equal To': 'EX',
  Is: 'EX',
  Contains: 'CT',
  'Does Not Contain': 'XCT',
  'Is Not Empty': 'XNE'
};

function normalizeFilters(filters) {
  if (!filters) return [];
  if (!Array.isArray(filters)) throw new Error('invalid_filter_shape');
  if (filters.length > 200) throw new Error('too_many_filters');

  return filters.map((filter) => {
    if (!filter || typeof filter !== 'object') throw new Error('invalid_filter_shape');
    if (!Object.prototype.hasOwnProperty.call(filter, 'fid') ||
        !Object.prototype.hasOwnProperty.call(filter, 'operator') ||
        !Object.prototype.hasOwnProperty.call(filter, 'value')) {
      throw new Error('invalid_filter_shape');
    }

    return {
      ...filter,
      operator: Object.prototype.hasOwnProperty.call(OPERATOR_ALIASES, filter.operator)
        ? OPERATOR_ALIASES[filter.operator]
        : filter.operator
    };
  });
}

module.exports = {
  normalizeFilters
};
