const test = require('node:test');
const assert = require('node:assert/strict');

const { setActiveStage, syncAdminEmptyStates } = require('../workflow');

function makeClassList() {
  const classes = new Set();
  return {
    has(name) {
      return classes.has(name);
    },
    toggle(name, enabled) {
      if (enabled) classes.add(name);
      else classes.delete(name);
    },
  };
}

test('setActiveStage toggles active state for tabs, contents, and rail items', () => {
  const tabs = [
    { dataset: { stage: 'dashboard' }, classList: makeClassList() },
    { dataset: { stage: 'intake' }, classList: makeClassList() },
  ];
  const contents = [
    { dataset: { content: 'dashboard' }, classList: makeClassList() },
    { dataset: { content: 'intake' }, classList: makeClassList() },
  ];
  const rail = [
    { dataset: { workflowStage: 'dashboard' }, classList: makeClassList() },
    { dataset: { workflowStage: 'intake' }, classList: makeClassList() },
  ];

  setActiveStage('intake', tabs, contents, rail);

  assert.equal(tabs[0].classList.has('active'), false);
  assert.equal(tabs[1].classList.has('active'), true);
  assert.equal(contents[0].classList.has('active'), false);
  assert.equal(contents[1].classList.has('active'), true);
  assert.equal(rail[0].classList.has('active'), false);
  assert.equal(rail[1].classList.has('active'), true);
});

test('syncAdminEmptyStates hides empty-state when rows are present', () => {
  const emptyState = { hidden: false };
  const surface = {
    dataset: { adminEmptyToggle: 'tbody tr' },
    querySelectorAll: (selector) => (selector === 'tbody tr' ? [{}, {}] : []),
    querySelector: (selector) => (selector === '.empty-state' ? emptyState : null),
  };
  const doc = {
    querySelectorAll: (selector) =>
      selector === '[data-admin-surface]' ? [surface] : [],
  };

  syncAdminEmptyStates(doc);
  assert.equal(emptyState.hidden, true);
});

test('syncAdminEmptyStates shows empty-state when rows are absent', () => {
  const emptyState = { hidden: true };
  const surface = {
    dataset: { adminEmptyToggle: 'li' },
    querySelectorAll: (selector) => (selector === 'li' ? [] : []),
    querySelector: (selector) => (selector === '.empty-state' ? emptyState : null),
  };
  const doc = {
    querySelectorAll: (selector) =>
      selector === '[data-admin-surface]' ? [surface] : [],
  };

  syncAdminEmptyStates(doc);
  assert.equal(emptyState.hidden, false);
});
