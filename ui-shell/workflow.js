function setActiveStage(stage, tabs, contents, railStages) {
  tabs.forEach((t) => t.classList.toggle('active', t.dataset.stage === stage));
  contents.forEach((section) => {
    section.classList.toggle('active', section.dataset.content === stage);
  });
  railStages.forEach((item) => {
    item.classList.toggle('active', item.dataset.workflowStage === stage);
  });
}

function syncAdminEmptyStates(documentRef) {
  documentRef.querySelectorAll('[data-admin-surface]').forEach((surface) => {
    const selector = surface.dataset.adminEmptyToggle;
    const rows = selector ? surface.querySelectorAll(selector) : [];
    const emptyState = surface.querySelector('.empty-state');
    if (!emptyState) return;
    const hasItems = rows.length > 0;
    emptyState.hidden = hasItems;
  });
}

if (typeof window !== 'undefined') {
  window.ElitezWorkflow = {
    setActiveStage,
    syncAdminEmptyStates,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    setActiveStage,
    syncAdminEmptyStates,
  };
}
