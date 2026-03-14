/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking MACE for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
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
