/**
 * Minimal in-browser test framework for MyDraw.
 * Provides describe/it BDD interface with assertion helpers and visual DOM reporting.
 */
(function (global) {
  'use strict';

  const suites = [];
  let currentSuite = null;

  function describe(name, fn) {
    const suite = { name, tests: [] };
    suites.push(suite);
    const prevSuite = currentSuite;
    currentSuite = suite;
    try {
      fn();
    } finally {
      currentSuite = prevSuite;
    }
  }

  function it(name, fn) {
    if (!currentSuite) {
      describe('Default Suite', () => it(name, fn));
      return;
    }
    currentSuite.tests.push({ name, fn });
  }

  function assertEqual(actual, expected, message = '') {
    if (typeof actual === 'object' && actual !== null && typeof expected === 'object' && expected !== null) {
      const actualStr = JSON.stringify(actual);
      const expectedStr = JSON.stringify(expected);
      if (actualStr !== expectedStr) {
        throw new Error(
          `${message ? message + ': ' : ''}Expected ${expectedStr}, but got ${actualStr}`
        );
      }
      return;
    }
    if (actual !== expected) {
      throw new Error(
        `${message ? message + ': ' : ''}Expected ${JSON.stringify(expected)}, but got ${JSON.stringify(actual)}`
      );
    }
  }

  function assertDeepEqual(actual, expected, message = '') {
    assertEqual(actual, expected, message);
  }

  function assertApprox(actual, expected, epsilon = 0.001, message = '') {
    if (typeof actual !== 'number' || typeof expected !== 'number') {
      throw new Error(
        `${message ? message + ': ' : ''}Expected numbers for assertApprox, got ${typeof actual} and ${typeof expected}`
      );
    }
    if (Math.abs(actual - expected) > epsilon) {
      throw new Error(
        `${message ? message + ': ' : ''}Expected ~${expected} (±${epsilon}), but got ${actual} (diff: ${Math.abs(actual - expected)})`
      );
    }
  }

  function assertTrue(value, message = 'Expected value to be truthy') {
    if (!value) {
      throw new Error(message);
    }
  }

  function runTests() {
    let total = 0;
    let passed = 0;
    let failed = 0;
    const results = [];

    for (const suite of suites) {
      const suiteResult = { name: suite.name, tests: [] };
      for (const test of suite.tests) {
        total++;
        const testResult = { name: test.name, passed: false, error: null };
        try {
          test.fn();
          testResult.passed = true;
          passed++;
        } catch (err) {
          testResult.passed = false;
          testResult.error = err.message || String(err);
          failed++;
        }
        suiteResult.tests.push(testResult);
      }
      results.push(suiteResult);
    }

    const summary = { total, passed, failed, results };
    global.__TEST_RESULTS__ = summary;

    renderResults(summary);
    return summary;
  }

  function renderResults(summary) {
    const container = document.getElementById('test-results') || document.body;
    
    // Clear previous if any
    const existing = document.getElementById('runner-output');
    if (existing) existing.remove();

    const wrapper = document.createElement('div');
    wrapper.id = 'runner-output';
    wrapper.className = 'test-report';

    const header = document.createElement('div');
    header.className = `test-header ${summary.failed === 0 ? 'all-passed' : 'has-failures'}`;
    header.innerHTML = `
      <h1>Test Suite Results</h1>
      <div class="summary-stats">
        <span class="stat-badge total">Total: ${summary.total}</span>
        <span class="stat-badge passed">Passed: ${summary.passed}</span>
        <span class="stat-badge ${summary.failed > 0 ? 'failed' : 'clean'}">Failed: ${summary.failed}</span>
      </div>
    `;
    wrapper.appendChild(header);

    for (const suite of summary.results) {
      const suiteEl = document.createElement('div');
      suiteEl.className = 'test-suite';

      const suiteTitle = document.createElement('h2');
      suiteTitle.className = 'suite-title';
      suiteTitle.textContent = suite.name;
      suiteEl.appendChild(suiteTitle);

      const testList = document.createElement('ul');
      testList.className = 'test-list';

      for (const test of suite.tests) {
        const item = document.createElement('li');
        item.className = `test-item ${test.passed ? 'pass' : 'fail'}`;

        const icon = document.createElement('span');
        icon.className = 'test-icon';
        icon.textContent = test.passed ? '✔' : '✘';

        const name = document.createElement('span');
        name.className = 'test-name';
        name.textContent = test.name;

        item.appendChild(icon);
        item.appendChild(name);

        if (!test.passed && test.error) {
          const errEl = document.createElement('pre');
          errEl.className = 'test-error';
          errEl.textContent = test.error;
          item.appendChild(errEl);
        }

        testList.appendChild(item);
      }

      suiteEl.appendChild(testList);
      wrapper.appendChild(suiteEl);
    }

    container.appendChild(wrapper);

    // Also console log summary
    if (summary.failed === 0) {
      console.log(`%c✔ All ${summary.total} tests passed!`, 'color: #22c55e; font-weight: bold;');
    } else {
      console.error(`%c✘ ${summary.failed} of ${summary.total} tests failed.`, 'color: #ef4444; font-weight: bold;');
    }
  }

  // Auto-run when window loads
  if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
      // Small timeout to allow all test scripts to register
      setTimeout(runTests, 0);
    });
  }

  // Export to global scope
  global.describe = describe;
  global.it = it;
  global.assertEqual = assertEqual;
  global.assertDeepEqual = assertDeepEqual;
  global.assertApprox = assertApprox;
  global.assertTrue = assertTrue;
  global.runTests = runTests;

})(typeof window !== 'undefined' ? window : globalThis);
