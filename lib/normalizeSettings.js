/**
 * @file normalizeSettings.js
 * @description Settings normalizer — coerces raw settings objects to validated typed schema
 * @module MUMS/Lib
 * @version UAT
 */
function normalizeSettings(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return {};

    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return JSON.parse(trimmed);
      } catch (error) {
        return {};
      }
    }

    if (trimmed.includes(',')) {
      const out = {};
      trimmed
        .split(',')
        .map((entry) => entry.trim())
        .forEach((entry) => {
          if (entry) out[entry] = true;
        });
      return out;
    }
  }

  return {};
}

module.exports = { normalizeSettings };
