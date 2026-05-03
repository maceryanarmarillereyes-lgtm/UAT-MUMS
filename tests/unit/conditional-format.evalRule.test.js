/**
 * @file conditional-format.evalRule.test.js
 * @description Conditional Format.Evalrule.Test module
 * @module MUMS/MUMS
 * @version UAT
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadEvalRule() {
  const source = fs.readFileSync('public/js/services-conditional-format.js', 'utf8');
  const sandbox = {
    window: {
      servicesGrid: { _cfHooked: true },
      svcConditionalFormat: null,
    },
    document: {
      getElementById: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      body: { appendChild: () => {} }
    },
    setTimeout: () => 0,
    clearTimeout: () => {},
    requestAnimationFrame: (fn) => fn(),
    console
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = sandbox.document;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.window.__svcCfTest.evalRule;
}

const evalRule = loadEvalRule();

test('evalRule supports text operators case-insensitive', () => {
  assert.equal(evalRule({ operator: 'contains', param1: 'wait' }, 'Waiting'), true);
  assert.equal(evalRule({ operator: 'not_contains', param1: 'done' }, 'Waiting'), true);
  assert.equal(evalRule({ operator: 'starts_with', param1: 'ma' }, 'Mace'), true);
  assert.equal(evalRule({ operator: 'ends_with', param1: 'yes' }, 'Reyes'), true);
  assert.equal(evalRule({ operator: 'eq', param1: 'abc' }, 'ABC'), true);
  assert.equal(evalRule({ operator: 'neq', param1: 'xyz' }, 'ABC'), true);
  assert.equal(evalRule({ operator: 'empty' }, ''), true);
  assert.equal(evalRule({ operator: 'not_empty' }, 'x'), true);
});

test('evalRule supports numeric operators and between boundaries', () => {
  assert.equal(evalRule({ operator: 'num_gt', param1: '10' }, '11'), true);
  assert.equal(evalRule({ operator: 'num_gte', param1: '10' }, '10'), true);
  assert.equal(evalRule({ operator: 'num_lt', param1: '10' }, '9'), true);
  assert.equal(evalRule({ operator: 'num_lte', param1: '10' }, '10'), true);
  assert.equal(evalRule({ operator: 'between', param1: '10', param2: '20' }, '10'), true);
  assert.equal(evalRule({ operator: 'between', param1: '10', param2: '20' }, '20'), true);
  assert.equal(evalRule({ operator: 'not_between', param1: '10', param2: '20' }, '30'), true);
  assert.equal(evalRule({ operator: 'num_gt', param1: '10' }, 'NaN'), false);
});
