/**
 * @file conditional-format.color-swatch.test.js
 * @description Conditional Format.Color Swatch.Test module
 * @module MUMS/MUMS
 * @version UAT
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('swatch render uses active class for selected color', () => {
  const src = fs.readFileSync('public/js/services-conditional-format.js', 'utf8');
  assert.match(src, /cf-color-btn/);
  assert.match(src, /cf-swatch-active active/);
});
