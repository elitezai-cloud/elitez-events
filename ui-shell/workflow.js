/* ── Core navigation ───────────────────────────────────────────── */
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

/* ── Auth state ────────────────────────────────────────────────── */
let _currentUser = null;  // { email: string }
let _currentProposalId = null;

/* ── API fetch wrapper with loading/error state support ─────────── */
async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    try { err.body = await res.json(); } catch (_) {}
    throw err;
  }
  return res.json();
}

function showFetchError(containerId, message, onRetry) {
  let el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<div class="fetch-error-banner visible">
    <span><strong>Error:</strong> ${escapeHtml(message)}</span>
    ${onRetry ? '<button class="fetch-error-retry">Retry</button>' : ''}
  </div>`;
  if (onRetry) {
    const btn = el.querySelector('.fetch-error-retry');
    if (btn) btn.onclick = onRetry;
  }
}

function showSkeleton(containerId, rows = 3) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<div class="fetch-skeleton">${Array(rows).fill('<div class="fetch-skel-row"></div>').join('')}</div>`;
}

/* ── Auth gate (D5 — AC gate on page load) ──────────────────────── */
const AuthGate = (function () {
  function show() {
    const overlay = document.getElementById('auth-overlay');
    if (overlay) overlay.hidden = false;
  }

  function hide() {
    const overlay = document.getElementById('auth-overlay');
    if (overlay) overlay.hidden = true;
  }

  function updateUserDisplay(email) {
    // Replace hard-coded 'Alex Morgan' / 'Good morning, Alex' with real identity
    const nameEls = document.querySelectorAll('.nav-user-name, [data-user-name]');
    nameEls.forEach(el => { el.textContent = email; });
    const greetingEl = document.querySelector('[data-greeting-name]');
    if (greetingEl) {
      const local = email.split('@')[0];
      greetingEl.textContent = `Good morning, ${local.charAt(0).toUpperCase() + local.slice(1)}`;
    }
    const avatarEls = document.querySelectorAll('.nav-avatar');
    avatarEls.forEach(el => {
      const initials = email.slice(0, 2).toUpperCase();
      el.textContent = initials;
    });
    const roleEl = document.querySelector('.nav-user-role');
    if (roleEl) roleEl.textContent = email;
  }

  async function init() {
    try {
      const data = await apiFetch('/api/auth/me');
      _currentUser = data;
      updateUserDisplay(data.email);
      hide();
    } catch (err) {
      if (err.status === 401) {
        show();
        _wireLoginForm();
      }
    }
  }

  function _wireLoginForm() {
    const form = document.getElementById('auth-form');
    const errorEl = document.getElementById('auth-error');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = (form.querySelector('#auth-email') || {}).value || '';
      const password = (form.querySelector('#auth-password') || {}).value || '';
      if (errorEl) errorEl.classList.remove('visible');
      try {
        const data = await apiFetch('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
        _currentUser = { email: data.email };
        updateUserDisplay(data.email);
        hide();
        // Re-initialise panels now that we're authed
        DashboardPanel.init();
        RequirementReviewPanel.init();
        ConceptSelectionPanel.init();
      } catch (err) {
        if (errorEl) {
          errorEl.textContent = 'Invalid email or password.';
          errorEl.classList.add('visible');
        }
      }
    });
  }

  return { init, show, hide, updateUserDisplay };
})();

/* ── Dashboard panel (D4 — AC-01, AC-02) ────────────────────────── */
const DashboardPanel = (function () {
  let _page = 1;
  let _total = 0;
  let _perPage = 20;

  function _statusClass(s) {
    const map = { approved: 'status--approved', in_progress: 'status--review', draft: 'status--draft', exported: 'status--exported', archived: 'status--draft' };
    return map[s] || 'status--draft';
  }

  function _stageLabel(s) {
    const map = { tender_intake: 'Intake', requirement_review: 'Requirements', concept_selection: 'Concepts', costing_builder: 'Costing', proposal_studio: 'Studio', review_export: 'Export', complete: 'Complete' };
    return map[s] || s;
  }

  async function load() {
    const tbody = document.getElementById('proposals-tbody');
    const countEl = document.getElementById('proposals-count');
    if (!tbody) return;

    showSkeleton('proposals-tbody', 5);

    try {
      const q = (document.getElementById('proposals-search') || {}).value || '';
      const data = await apiFetch(`/api/proposals?page=${_page}&per_page=${_perPage}&q=${encodeURIComponent(q)}`);
      _total = data.pagination.total;

      if (countEl) countEl.textContent = _total;
      _updatePagination(data.pagination);

      if (!data.proposals.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--ink-soft);padding:32px">No proposals yet. Create your first one.</td></tr>';
        return;
      }

      tbody.innerHTML = data.proposals.map(p => `
        <tr>
          <td><div class="proposal-name">${escapeHtml(p.title)}</div></td>
          <td><span class="status-pill ${_statusClass(p.status)}">${escapeHtml(p.status)}</span></td>
          <td>${escapeHtml(_stageLabel(p.current_stage))}</td>
          <td class="date-text">${new Date(p.created_at).toLocaleDateString()}</td>
          <td class="date-text">${new Date(p.updated_at).toLocaleDateString()}</td>
          <td class="row-actions">
            <button class="action-btn" onclick="DashboardPanel.openProposal(${p.id})">Open</button>
          </td>
        </tr>`).join('');
    } catch (err) {
      tbody.innerHTML = '';
      showFetchError('proposals-tbody', `Failed to load proposals: ${err.message}`, load);
    }
  }

  function _updatePagination(pg) {
    const info = document.getElementById('page-info');
    const prevBtn = document.getElementById('page-prev');
    const nextBtn = document.getElementById('page-next');
    if (info) info.textContent = `Page ${pg.page} of ${pg.pages || 1} (${pg.total} total)`;
    if (prevBtn) prevBtn.disabled = pg.page <= 1;
    if (nextBtn) nextBtn.disabled = pg.page >= pg.pages;
  }

  function openProposal(id) {
    _currentProposalId = id;
    // Navigate to intake stage
    const stages = document.querySelectorAll('[data-workflow-stage]');
    const contents = document.querySelectorAll('[data-content]');
    const tabs = document.querySelectorAll('[data-stage]');
    setActiveStage('intake', tabs, contents, stages);
  }

  async function createProposal(title) {
    try {
      const data = await apiFetch('/api/proposals', {
        method: 'POST',
        body: JSON.stringify({ title: title || 'New Proposal' }),
      });
      _currentProposalId = data.id;
      await load();
      return data;
    } catch (err) {
      throw err;
    }
  }

  function init() {
    load();

    // Search
    const searchEl = document.getElementById('proposals-search');
    if (searchEl) {
      let _t;
      searchEl.addEventListener('input', () => {
        clearTimeout(_t);
        _t = setTimeout(() => { _page = 1; load(); }, 350);
      });
    }

    // Pagination
    const prevBtn = document.getElementById('page-prev');
    const nextBtn = document.getElementById('page-next');
    if (prevBtn) prevBtn.addEventListener('click', () => { if (_page > 1) { _page--; load(); } });
    if (nextBtn) nextBtn.addEventListener('click', () => { _page++; load(); });

    // New proposal button
    const newBtn = document.querySelector('.new-proposal-btn, [data-new-proposal]');
    if (newBtn) {
      newBtn.addEventListener('click', () => {
        const title = prompt('Proposal title:', 'New Proposal');
        if (title) createProposal(title);
      });
    }
  }

  return { init, load, openProposal, createProposal };
})();

/* ── Confidence badge helper ───────────────────────────────────── */
function confidenceBadge(score) {
  if (score >= 0.85) return { label: 'High', cls: 'conf-high' };
  if (score >= 0.60) return { label: 'Medium', cls: 'conf-mid' };
  return { label: 'Low', cls: 'conf-low' };
}

/* ── Undo Snackbar ─────────────────────────────────────────────── */
const UndoSnackbar = (function () {
  let _timer = null;
  const el = () => document.getElementById('undo-snackbar');
  const msgEl = () => document.getElementById('undo-snackbar-msg');

  function show(message, onUndo) {
    if (_timer) { clearTimeout(_timer); _timer = null; }
    const snackbar = el();
    if (!snackbar) return;
    msgEl().textContent = message;
    snackbar.hidden = false;
    snackbar.style.opacity = '1';
    const undoBtn = document.getElementById('undo-snackbar-btn');
    if (undoBtn) {
      undoBtn.onclick = () => { hide(); onUndo(); };
    }
    _timer = setTimeout(hide, 5000);
    return () => { if (_timer) { clearTimeout(_timer); _timer = null; } };
  }

  function hide() {
    const snackbar = el();
    if (!snackbar) return;
    snackbar.style.opacity = '0';
    setTimeout(() => { snackbar.hidden = true; }, 200);
  }

  return { show, hide };
})();

/* ── Source Drawer ─────────────────────────────────────────────── */
const SourceDrawer = (function () {
  let _returnFocus = null;

  function open(sourceRefs, triggerEl) {
    _returnFocus = triggerEl || document.activeElement;
    const drawer = document.getElementById('source-drawer');
    const content = document.getElementById('source-drawer-content');
    if (!drawer || !content) return;
    content.innerHTML = sourceRefs.length === 0
      ? '<p class="note">No source citations available for this field.</p>'
      : sourceRefs.map((ref, i) => {
          const conf = confidenceBadge(ref.confidence);
          return `<div class="drawer-source-item${i > 0 ? ' mt-12' : ''}">
            <div class="drawer-source-meta">
              <span class="conf-badge ${conf.cls}" aria-label="Confidence: ${conf.label}">${conf.label}</span>
              <span class="note">${escapeHtml(ref.document)}${ref.page ? `, p.${ref.page}` : ''}</span>
            </div>
            <blockquote class="source">"${escapeHtml(ref.excerpt)}"</blockquote>
          </div>`;
        }).join('');
    drawer.hidden = false;
    drawer.setAttribute('aria-modal', 'true');
    const closeBtn = document.getElementById('source-drawer-close');
    if (closeBtn) closeBtn.focus();
    trapFocus(drawer);
  }

  function close() {
    const drawer = document.getElementById('source-drawer');
    if (drawer) { drawer.hidden = true; drawer.removeAttribute('aria-modal'); }
    releaseFocusTrap();
    if (_returnFocus) { _returnFocus.focus(); _returnFocus = null; }
  }

  return { open, close };
})();

/* ── Regenerate Modal ──────────────────────────────────────────── */
const RegenerateModal = (function () {
  let _returnFocus = null;
  let _onConfirm = null;

  function open(hasApproval, onConfirm) {
    _returnFocus = document.activeElement;
    _onConfirm = onConfirm;
    const modal = document.getElementById('regen-modal');
    const warning = document.getElementById('regen-modal-warning');
    const input = document.getElementById('regen-modal-input');
    const confirmBtn = document.getElementById('regen-modal-confirm');
    if (!modal) return;
    if (input) input.value = '';
    if (warning) warning.hidden = !hasApproval;
    if (confirmBtn) confirmBtn.disabled = true;
    modal.hidden = false;
    modal.setAttribute('aria-modal', 'true');
    if (input) input.focus();
    trapFocus(modal);
    if (input) {
      input.oninput = () => {
        if (confirmBtn) confirmBtn.disabled = input.value.trim().length === 0;
      };
    }
  }

  function close() {
    const modal = document.getElementById('regen-modal');
    if (modal) { modal.hidden = true; modal.removeAttribute('aria-modal'); }
    releaseFocusTrap();
    if (_returnFocus) { _returnFocus.focus(); _returnFocus = null; }
  }

  function confirm() {
    const input = document.getElementById('regen-modal-input');
    const guidance = input ? input.value.trim() : '';
    close();
    if (_onConfirm) _onConfirm(guidance);
  }

  return { open, close, confirm };
})();

/* ── Focus trap helpers ────────────────────────────────────────── */
let _focusTrapEl = null;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function trapFocus(container) {
  _focusTrapEl = container;
  container.addEventListener('keydown', _handleTrapKeydown);
}

function releaseFocusTrap() {
  if (_focusTrapEl) {
    _focusTrapEl.removeEventListener('keydown', _handleTrapKeydown);
    _focusTrapEl = null;
  }
}

function _handleTrapKeydown(e) {
  if (e.key !== 'Tab') {
    if (e.key === 'Escape') {
      const drawer = document.getElementById('source-drawer');
      const regenModal = document.getElementById('regen-modal');
      const rejectModal = document.getElementById('reject-reason-modal');
      if (drawer && !drawer.hidden) SourceDrawer.close();
      if (regenModal && !regenModal.hidden) RegenerateModal.close();
      if (rejectModal && !rejectModal.hidden) {
        rejectModal.hidden = true;
        rejectModal.removeAttribute('aria-modal');
        releaseFocusTrap();
      }
    }
    return;
  }
  const focusable = Array.from(_focusTrapEl.querySelectorAll(FOCUSABLE)).filter(el => !el.hidden && el.offsetParent !== null);
  if (focusable.length === 0) { e.preventDefault(); return; }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey) {
    if (document.activeElement === first) { e.preventDefault(); last.focus(); }
  } else {
    if (document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ══════════════════════════════════════════════════════════════
   Stage 3 — RequirementReviewPanel (D2 + D6 — AC-06/07/08)
══════════════════════════════════════════════════════════════ */
const RequirementReviewPanel = (function () {
  let _state = 'loading';
  let _data = null;
  let _deletePending = {};

  function _proposalId() {
    return _currentProposalId || 1;
  }

  function _showState(name) {
    _state = name;
    ['empty', 'loading', 'active', 'error', 'locked'].forEach(s => {
      const el = document.getElementById(`req-state-${s}`);
      if (el) el.style.display = s === name ? '' : 'none';
    });
  }

  function _allFields() {
    if (!_data) return [];
    return _data.sections.flatMap(s => s.fields);
  }

  // Normalise API field shape to the UI field shape
  function _normalise(apiField) {
    return {
      fieldId: String(apiField.id),
      label: apiField.field_label || apiField.category || '',
      value: apiField.content || null,
      confidence: apiField.confidence || 0,
      missingFieldSeverity: apiField.missing_field_severity || 'optional',
      sourceRefs: apiField.source_refs || [],
      isEdited: apiField.is_edited || false,
      deletedAt: null,
      deletedPendingUndo: false,
    };
  }

  function _requiredMissingCount() {
    return _allFields().filter(f =>
      f.missingFieldSeverity === 'required' && (f.value === null || f.value === '') && !f.deletedAt && !f.deletedPendingUndo
    ).length;
  }

  function _renderFields(container, locked) {
    if (!container || !_data) return;
    let html = '';
    _data.sections.forEach(section => {
      html += `<article class="panel req-section">
        <h3 class="req-section-title">${escapeHtml(section.name)}</h3>
        <div class="req-field-list">`;
      section.fields.forEach(field => {
        if (field.deletedAt) return;
        const isPendingUndo = !!field.deletedPendingUndo;
        const conf = field.confidence > 0 ? confidenceBadge(field.confidence) : null;
        const hasSource = field.sourceRefs && field.sourceRefs.length > 0;
        const isEmpty = field.value === null || field.value === '';
        const isRequired = field.missingFieldSeverity === 'required';
        const rowClass = ['req-field-row', isPendingUndo ? 'req-field-row--deleted' : '', locked ? 'req-field-row--locked' : ''].filter(Boolean).join(' ');

        html += `<div class="${rowClass}" data-field-id="${field.fieldId}" aria-label="${escapeHtml(field.label)} requirement field">
          <div class="req-field-header">
            <span class="req-field-label">${escapeHtml(field.label)}</span>
            <div class="req-field-badges">
              ${conf ? `<span class="conf-badge ${conf.cls}" title="Confidence: ${conf.label}">${conf.label}</span>` : ''}
              ${isRequired && isEmpty ? '<span class="req-required-flag">Required</span>' : ''}
              ${field.isEdited ? '<span class="req-edited-chip">Edited</span>' : ''}
              ${isPendingUndo ? '<span class="req-deleted-chip">Deleted</span>' : ''}
              ${locked ? '<svg class="req-lock-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-label="Locked"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' : ''}
            </div>
          </div>
          ${isPendingUndo ? '' : `<div class="req-field-value-row">
            <span class="req-field-value${isEmpty ? ' req-field-value--empty' : ''}" data-value-display="${field.fieldId}">${isEmpty ? 'No value extracted' : escapeHtml(field.value)}</span>
            ${!locked ? `<input class="req-field-input" data-field-input="${field.fieldId}" value="${escapeHtml(field.value || '')}" style="display:none" aria-label="Edit ${escapeHtml(field.label)}" />` : ''}
          </div>`}
          <div class="req-field-actions">
            ${hasSource && !isPendingUndo ? `<button class="req-source-chip" data-source-btn="${field.fieldId}" aria-label="View source evidence for ${escapeHtml(field.label)}">Source</button>` : ''}
            ${!locked && !isPendingUndo ? `
              <button class="req-icon-btn req-edit-btn" data-edit-btn="${field.fieldId}" aria-label="Edit ${escapeHtml(field.label)}" title="Edit">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="req-icon-btn req-delete-btn" data-delete-btn="${field.fieldId}" aria-label="Delete ${escapeHtml(field.label)}" title="Delete">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              </button>
              <button class="req-icon-btn req-save-btn" data-save-btn="${field.fieldId}" style="display:none" aria-label="Save ${escapeHtml(field.label)}">Save</button>
              <button class="req-icon-btn req-cancel-btn" data-cancel-btn="${field.fieldId}" style="display:none" aria-label="Cancel edit">Cancel</button>
            ` : ''}
          </div>
        </div>`;
      });
      html += `</div></article>`;
    });
    container.innerHTML = html;
    if (!locked) _wireFieldInteractions(container);
  }

  function _wireFieldInteractions(container) {
    container.querySelectorAll('[data-edit-btn]').forEach(btn => {
      btn.addEventListener('click', () => _enterEdit(btn.dataset.editBtn));
    });
    container.querySelectorAll('[data-delete-btn]').forEach(btn => {
      btn.addEventListener('click', () => _softDelete(btn.dataset.deleteBtn));
    });
    container.querySelectorAll('[data-source-btn]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const field = _allFields().find(f => f.fieldId === btn.dataset.sourceBtn);
        if (field) SourceDrawer.open(field.sourceRefs || [], e.currentTarget);
      });
    });
  }

  function _enterEdit(fieldId) {
    const valueEl = document.querySelector(`[data-value-display="${fieldId}"]`);
    const inputEl = document.querySelector(`[data-field-input="${fieldId}"]`);
    const editBtn = document.querySelector(`[data-edit-btn="${fieldId}"]`);
    const deleteBtn = document.querySelector(`[data-delete-btn="${fieldId}"]`);
    const saveBtn = document.querySelector(`[data-save-btn="${fieldId}"]`);
    const cancelBtn = document.querySelector(`[data-cancel-btn="${fieldId}"]`);
    if (!valueEl || !inputEl) return;
    valueEl.style.display = 'none';
    inputEl.style.display = '';
    if (editBtn) editBtn.style.display = 'none';
    if (deleteBtn) deleteBtn.style.display = 'none';
    if (saveBtn) saveBtn.style.display = '';
    if (cancelBtn) cancelBtn.style.display = '';
    inputEl.focus();

    const save = () => _saveField(fieldId, inputEl.value.trim());
    const cancel = () => {
      const field = _allFields().find(f => f.fieldId === fieldId);
      if (field && valueEl) { valueEl.textContent = field.value || 'No value extracted'; valueEl.style.display = ''; }
      if (inputEl) inputEl.style.display = 'none';
      if (editBtn) editBtn.style.display = '';
      if (deleteBtn) deleteBtn.style.display = '';
      if (saveBtn) saveBtn.style.display = 'none';
      if (cancelBtn) cancelBtn.style.display = 'none';
    };

    if (saveBtn) saveBtn.onclick = save;
    if (cancelBtn) cancelBtn.onclick = cancel;
    inputEl.onblur = (e) => {
      if (e.relatedTarget === saveBtn || e.relatedTarget === cancelBtn) return;
      save();
    };
    inputEl.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    };
  }

  function _saveField(fieldId, newVal) {
    const field = _allFields().find(f => f.fieldId === fieldId);
    if (!field) return;
    const oldVal = field.value;
    field.value = newVal || null;
    field.isEdited = true;
    const valueEl = document.querySelector(`[data-value-display="${fieldId}"]`);
    const inputEl = document.querySelector(`[data-field-input="${fieldId}"]`);
    const editBtn = document.querySelector(`[data-edit-btn="${fieldId}"]`);
    const deleteBtn = document.querySelector(`[data-delete-btn="${fieldId}"]`);
    const saveBtn = document.querySelector(`[data-save-btn="${fieldId}"]`);
    const cancelBtn = document.querySelector(`[data-cancel-btn="${fieldId}"]`);
    if (valueEl) { valueEl.textContent = newVal || 'No value extracted'; valueEl.style.display = ''; }
    if (inputEl) inputEl.style.display = 'none';
    if (editBtn) editBtn.style.display = '';
    if (deleteBtn) deleteBtn.style.display = '';
    if (saveBtn) saveBtn.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = 'none';
    const row = document.querySelector(`[data-field-id="${fieldId}"]`);
    if (row && !row.querySelector('.req-edited-chip')) {
      const badges = row.querySelector('.req-field-badges');
      if (badges) {
        const chip = document.createElement('span');
        chip.className = 'req-edited-chip';
        chip.textContent = 'Edited';
        badges.appendChild(chip);
      }
    }
    _updateApprovalFooter();
    // Real API call (AC-07)
    apiFetch(`/api/requirements/${fieldId}`, {
      method: 'PATCH',
      body: JSON.stringify({ content: newVal || null }),
    }).catch(() => {
      field.value = oldVal;
      if (valueEl) valueEl.textContent = oldVal || 'No value extracted';
      _showToast('Save failed — reverted to previous value.');
    });
  }

  function _softDelete(fieldId) {
    const field = _allFields().find(f => f.fieldId === fieldId);
    if (!field) return;
    field.deletedPendingUndo = true;
    _renderFields(document.getElementById('req-fields-container'), false);
    _updateApprovalFooter();
    const cancelFn = UndoSnackbar.show(`Deleted "${field.label}"`, () => {
      field.deletedPendingUndo = false;
      if (_deletePending[fieldId]) { clearTimeout(_deletePending[fieldId].timer); delete _deletePending[fieldId]; }
      _renderFields(document.getElementById('req-fields-container'), false);
      _updateApprovalFooter();
      // Restore via real API (AC-07)
      apiFetch(`/api/requirements/${fieldId}/restore`, { method: 'POST' }).catch(() => {});
    });
    const timer = setTimeout(() => {
      field.deletedAt = new Date().toISOString();
      field.deletedPendingUndo = false;
      _renderFields(document.getElementById('req-fields-container'), false);
      _updateApprovalFooter();
      // Delete via real API (AC-07)
      apiFetch(`/api/requirements/${fieldId}`, { method: 'DELETE' }).catch(() => {
        field.deletedAt = null;
        _renderFields(document.getElementById('req-fields-container'), false);
        _updateApprovalFooter();
        _showToast('Delete failed — field restored.');
      });
      delete _deletePending[fieldId];
    }, 5000);
    _deletePending[fieldId] = { timer, cancelFn };
  }

  function _updateApprovalFooter() {
    const approveBtn = document.getElementById('req-approve-btn');
    const missingNote = document.getElementById('req-missing-note');
    const missing = _requiredMissingCount();
    if (approveBtn) approveBtn.disabled = missing > 0;
    if (missingNote) {
      if (missing > 0) {
        missingNote.style.display = '';
        missingNote.textContent = `${missing} required field${missing > 1 ? 's' : ''} need values before approving.`;
      } else {
        missingNote.style.display = 'none';
      }
    }
  }

  function _showToast(msg) { UndoSnackbar.show(msg, () => {}); }

  function _adaptApiData(apiData) {
    // Transform API response into the UI's expected shape
    return {
      proposalId: apiData.proposal_id,
      sections: (apiData.sections || []).map(s => ({
        sectionId: s.section_id,
        name: s.name,
        fields: (s.fields || []).filter(f => !f.is_deleted).map(_normalise),
      })),
      approval: apiData.approved_by ? { approvedBy: apiData.approved_by, approvedAt: apiData.approved_at } : null,
    };
  }

  function init() {
    _showState('loading');
    const pid = _proposalId();
    apiFetch(`/api/proposals/${pid}/requirements`)
      .then(apiData => {
        _data = _adaptApiData(apiData);
        if (_data.approval) {
          _showState('locked');
          _renderFields(document.getElementById('req-locked-fields-container'), true);
          const lockedLabel = document.getElementById('req-locked-label');
          if (lockedLabel) lockedLabel.textContent = `Requirements approved by ${_data.approval.approvedBy} on ${new Date(_data.approval.approvedAt).toLocaleDateString()}. Return for changes to unlock.`;
        } else if (!_data.sections.length) {
          _showState('empty');
        } else {
          _showState('active');
          _renderFields(document.getElementById('req-fields-container'), false);
          _updateApprovalFooter();
        }
      })
      .catch(() => {
        _showState('empty');  // treat as no data yet
      });

    // Run extraction CTA (AC-05)
    document.querySelectorAll('.req-extract-cta').forEach(btn => {
      btn.addEventListener('click', () => {
        _showState('loading');
        apiFetch(`/api/proposals/${_proposalId()}/tender/extract`, { method: 'POST' })
          .then(apiData => {
            _data = _adaptApiData(apiData);
            _showState('active');
            _renderFields(document.getElementById('req-fields-container'), false);
            _updateApprovalFooter();
          }).catch(() => {
            _showState('error');
            const errMsg = document.getElementById('req-error-msg');
            if (errMsg) errMsg.textContent = 'Extraction service returned an error. Check uploaded documents and retry.';
          });
      });
    });

    // Approve button (AC-08)
    const approveBtn = document.getElementById('req-approve-btn');
    if (approveBtn) {
      approveBtn.addEventListener('click', () => {
        approveBtn.disabled = true;
        apiFetch(`/api/proposals/${_proposalId()}/requirements/approve`, { method: 'POST' })
          .then(result => {
            if (_data) _data.approval = { approvedBy: result.approved_by, approvedAt: result.approved_at };
            _showState('locked');
            _renderFields(document.getElementById('req-locked-fields-container'), true);
            const lockedLabel = document.getElementById('req-locked-label');
            if (lockedLabel) lockedLabel.textContent = `Requirements approved by ${result.approved_by} on ${new Date(result.approved_at).toLocaleDateString()}. Return for changes to unlock.`;
          }).catch((err) => {
            approveBtn.disabled = false;
            if (err.body && err.body.error === 'missing_required_fields') {
              _showToast(`${err.body.count} required field(s) must be filled before approving.`);
            } else {
              _showToast('Approval failed — please try again.');
            }
          });
      });
    }

    // Return for changes button
    const returnBtn = document.getElementById('req-return-btn');
    if (returnBtn) {
      returnBtn.addEventListener('click', () => {
        if (_data) _data.approval = null;
        _showState('active');
        _renderFields(document.getElementById('req-fields-container'), false);
        _updateApprovalFooter();
      });
    }
  }

  return { init };
})();

/* ══════════════════════════════════════════════════════════════
   Stage 4 — ConceptSelectionPanel (D2+D3+D6 — AC-09/10/11)
══════════════════════════════════════════════════════════════ */
const ConceptSelectionPanel = (function () {
  let _state = 'loading';
  let _data = null;

  function _proposalId() { return _currentProposalId || 1; }

  function _showState(name) {
    _state = name;
    ['empty', 'loading', 'active', 'approved', 'error'].forEach(s => {
      const el = document.getElementById(`concept-state-${s}`);
      if (el) el.style.display = s === name ? '' : 'none';
    });
    const regenBtn = document.getElementById('concept-regen-btn');
    if (regenBtn) regenBtn.style.display = (name === 'active') ? '' : 'none';
  }

  function _fitBadge(score) {
    if (score >= 0.85) return { label: 'High Fit', cls: 'fit--high' };
    if (score >= 0.65) return { label: 'Good Fit', cls: 'fit--mid' };
    return { label: 'Low Fit', cls: 'fit--low' };
  }

  const THUMB_CLASSES = ['concept-thumb--a', 'concept-thumb--b', 'concept-thumb--c'];
  const THUMB_ICONS = [
    '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.8)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.8)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.8)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  ];

  function _normaliseConceptData(apiData) {
    return {
      proposalId: apiData.proposal_id,
      concepts: (apiData.concepts || []).map(c => ({
        conceptId: String(c.concept_id),
        name: c.name,
        fitScore: c.fit_score,
        tags: c.tags || [],
        rationale: c.rationale,
        kbReferences: c.kb_references || [],
        status: c.status || 'available',
        rejectedReason: c.rejected_reason || null,
      })),
      approval: null,
    };
  }

  function _renderCards(container, locked) {
    if (!container || !_data) return;
    const concepts = _data.concepts;
    container.innerHTML = concepts.map((c, i) => {
      const fit = _fitBadge(c.fitScore);
      const isSelected = c.status === 'selected';
      const isRejected = c.status === 'rejected';
      const isApproved = locked && isSelected;
      const kbRefs = (c.kbReferences || []).join(', ');
      return `<article class="panel concept-card${isSelected ? ' selected' : ''}${isRejected ? ' rejected' : ''}"
          data-concept-id="${c.conceptId}"
          role="radio"
          aria-pressed="${isSelected}"
          aria-label="${escapeHtml(c.name)}, ${fit.label}, ${Math.round(c.fitScore * 100)}% fit"
          ${!locked && !isRejected ? 'tabindex="0"' : ''}>
        <div class="concept-thumb ${THUMB_CLASSES[i % 3]}">${THUMB_ICONS[i % 3]}</div>
        <div class="concept-body">
          <div class="concept-fit-badge ${fit.cls}">${fit.label}</div>
          ${isApproved ? '<span class="req-edited-chip" style="margin-left:6px">Approved</span>' : ''}
          ${isSelected && !locked ? '<span class="req-edited-chip" style="margin-left:6px">Selected</span>' : ''}
          ${isRejected ? '<span class="req-deleted-chip" style="margin-left:6px">Rejected</span>' : ''}
          <h3>${escapeHtml(c.name)}</h3>
          <p style="font-size:.875rem;color:var(--text-body);margin:0 0 8px">${escapeHtml(c.rationale)}</p>
          <div class="tags">${(c.tags || []).map(t => `<span>${escapeHtml(t)}</span>`).join('')}</div>
          ${kbRefs ? `<p class="note" style="margin-top:6px">KB refs: ${escapeHtml(kbRefs)}</p>` : ''}
          ${isRejected && c.rejectedReason ? `<p class="note" style="color:#dc2626;margin-top:6px">Rejected: ${escapeHtml(c.rejectedReason)}</p>` : ''}
          ${!locked && !isRejected && !isSelected ? `
            <div class="action-row">
              <button class="secondary-btn concept-select-btn" data-select="${c.conceptId}" aria-label="Select ${escapeHtml(c.name)}">Select concept</button>
              <button class="secondary-btn concept-reject-btn" data-reject="${c.conceptId}" aria-label="Reject ${escapeHtml(c.name)}">Reject</button>
            </div>` : ''}
          ${!locked && isSelected ? `
            <div class="action-row">
              <button class="secondary-btn concept-reject-btn" data-reject="${c.conceptId}" aria-label="Reject ${escapeHtml(c.name)}">Reject</button>
            </div>` : ''}
          ${isRejected && !locked ? `
            <div class="action-row">
              <button class="secondary-btn concept-select-btn" data-select="${c.conceptId}" aria-label="Re-select ${escapeHtml(c.name)}">Select instead</button>
            </div>` : ''}
        </div>
      </article>`;
    }).join('');
    if (!locked) _wireCardInteractions(container);
  }

  function _wireCardInteractions(container) {
    container.querySelectorAll('[data-select]').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); _selectConcept(btn.dataset.select); });
    });
    container.querySelectorAll('[data-reject]').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); _promptReject(btn.dataset.reject); });
    });
    container.querySelectorAll('[role="radio"]').forEach(card => {
      card.addEventListener('keydown', e => {
        if ((e.key === 'Enter' || e.key === ' ') && card.getAttribute('tabindex') !== null) {
          e.preventDefault();
          _selectConcept(card.dataset.conceptId);
        }
      });
    });
  }

  function _selectConcept(conceptId) {
    if (!_data) return;
    _data.concepts.forEach(c => { if (c.status === 'selected') c.status = 'available'; });
    const concept = _data.concepts.find(c => c.conceptId === conceptId);
    if (!concept || concept.status === 'rejected') return;
    concept.status = 'selected';
    _renderCards(document.getElementById('concept-cards-container'), false);
    _showApprovalPanel(concept);
    // Real API (AC-10)
    apiFetch(`/api/concepts/${conceptId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'selected' }),
    }).catch(() => {
      concept.status = 'available';
      _renderCards(document.getElementById('concept-cards-container'), false);
      _hideApprovalPanel();
    });
  }

  function _promptReject(conceptId) {
    const concept = _data && _data.concepts.find(c => c.conceptId === conceptId);
    if (!concept) return;
    const modal = document.getElementById('reject-reason-modal');
    const input = document.getElementById('reject-reason-input');
    const confirmBtn = document.getElementById('reject-reason-confirm');
    const closeBtn = document.getElementById('reject-reason-cancel');
    const cancelBtn = document.getElementById('reject-reason-cancel-btn');
    const _returnFocus = document.activeElement;
    if (!modal || !input) return;
    input.value = '';
    if (confirmBtn) confirmBtn.disabled = true;
    modal.hidden = false;
    modal.setAttribute('aria-modal', 'true');
    input.focus();
    trapFocus(modal);
    const _closeModal = () => {
      modal.hidden = true;
      modal.removeAttribute('aria-modal');
      releaseFocusTrap();
      if (_returnFocus) _returnFocus.focus();
    };
    input.oninput = () => { if (confirmBtn) confirmBtn.disabled = input.value.trim().length === 0; };
    if (confirmBtn) confirmBtn.onclick = () => {
      const reason = input.value.trim();
      _closeModal();
      _rejectConcept(conceptId, reason);
    };
    if (closeBtn) closeBtn.onclick = _closeModal;
    if (cancelBtn) cancelBtn.onclick = _closeModal;
  }

  function _rejectConcept(conceptId, reason) {
    if (!_data) return;
    const concept = _data.concepts.find(c => c.conceptId === conceptId);
    if (!concept) return;
    const oldStatus = concept.status;
    concept.status = 'rejected';
    concept.rejectedReason = reason;
    if (oldStatus === 'selected') _hideApprovalPanel();
    _renderCards(document.getElementById('concept-cards-container'), false);
    // Real API (AC-10/11)
    apiFetch(`/api/concepts/${conceptId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'rejected', rejected_reason: reason }),
    }).catch(() => {
      concept.status = oldStatus;
      concept.rejectedReason = null;
      _renderCards(document.getElementById('concept-cards-container'), false);
    });
  }

  function _showApprovalPanel(concept) {
    const panel = document.getElementById('concept-approval-panel');
    const inner = document.getElementById('concept-approval-inner');
    if (!panel || !inner) return;
    inner.innerHTML = `
      <p style="margin:0 0 12px;color:var(--text-body)">Selected: <strong>${escapeHtml(concept.name)}</strong></p>
      <div class="form-grid" style="margin-bottom:12px">
        <label style="grid-column:1/-1">Notes (optional)<textarea id="concept-approval-notes" rows="2" style="width:100%;margin-top:4px" placeholder="Add reviewer notes…"></textarea></label>
      </div>
      <button class="primary-btn" id="concept-approve-btn">Approve concept for costing</button>`;
    panel.style.display = '';
    const approveBtn = document.getElementById('concept-approve-btn');
    if (approveBtn) {
      approveBtn.addEventListener('click', () => {
        approveBtn.disabled = true;
        // Real API (AC-10)
        apiFetch(`/api/proposals/${_proposalId()}/concepts/approve`, {
          method: 'POST',
          body: JSON.stringify({ concept_id: parseInt(concept.conceptId) }),
        }).then(result => {
          if (_data) _data.approval = { approvedBy: result.approved_by, approvedAt: result.approved_at };
          _showState('approved');
          _renderCards(document.getElementById('concept-approved-cards'), true);
          const lockedLabel = document.getElementById('concept-locked-label');
          if (lockedLabel) lockedLabel.textContent = `Concept approved by ${result.approved_by} on ${new Date(result.approved_at).toLocaleDateString()}. Create a revision to replace.`;
        }).catch(() => {
          approveBtn.disabled = false;
        });
      });
    }
  }

  function _hideApprovalPanel() {
    const panel = document.getElementById('concept-approval-panel');
    if (panel) panel.style.display = 'none';
  }

  function _doRegenerate(guidance) {
    _showState('loading');
    // Real API with LLM (AC-09)
    apiFetch('/api/concepts/generate', {
      method: 'POST',
      body: JSON.stringify({ proposal_id: _proposalId(), guidance, regenerate: true }),
    }).then(apiData => {
      _data = _normaliseConceptData({ proposal_id: _proposalId(), concepts: apiData.concepts });
      _showState('active');
      _hideApprovalPanel();
      _renderCards(document.getElementById('concept-cards-container'), false);
    }).catch(() => {
      _showState('error');
      const errMsg = document.getElementById('concept-error-msg');
      if (errMsg) errMsg.textContent = 'Concept generation service returned an error. Try again or provide different guidance.';
    });
  }

  function init() {
    _showState('loading');
    // Load existing concepts from DB (AC-09)
    apiFetch(`/api/proposals/${_proposalId()}/concepts`)
      .then(apiData => {
        _data = _normaliseConceptData(apiData);
        if (!_data.concepts.length) {
          _showState('empty');
        } else {
          _showState('active');
          _renderCards(document.getElementById('concept-cards-container'), false);
        }
      })
      .catch(() => _showState('empty'));

    // Generate CTA (empty state — calls LLM)
    const generateCta = document.getElementById('concept-generate-cta');
    if (generateCta) {
      generateCta.addEventListener('click', () => {
        _showState('loading');
        apiFetch('/api/concepts/generate', {
          method: 'POST',
          body: JSON.stringify({ proposal_id: _proposalId() }),
        }).then(apiData => {
          _data = _normaliseConceptData({ proposal_id: _proposalId(), concepts: apiData.concepts });
          _showState('active');
          _renderCards(document.getElementById('concept-cards-container'), false);
        }).catch(() => _showState('error'));
      });
    }

    // Regenerate button (active state)
    const regenBtn = document.getElementById('concept-regen-btn');
    if (regenBtn) {
      regenBtn.addEventListener('click', () => {
        const hasApproval = !!(_data && _data.approval);
        RegenerateModal.open(hasApproval, _doRegenerate);
      });
    }

    // Retry button (error state)
    const retryBtn = document.getElementById('concept-retry-btn');
    if (retryBtn) retryBtn.addEventListener('click', () => _doRegenerate(''));

    // Guidance button (error state)
    const guidanceBtn = document.getElementById('concept-guidance-btn');
    if (guidanceBtn) guidanceBtn.addEventListener('click', () => RegenerateModal.open(false, _doRegenerate));

    // Create revision button (approved state)
    const revisionBtn = document.getElementById('concept-revision-btn');
    if (revisionBtn) {
      revisionBtn.addEventListener('click', () => {
        if (_data) _data.approval = null;
        if (_data) _data.concepts.forEach(c => { c.status = 'available'; c.rejectedReason = null; });
        _showState('active');
        _hideApprovalPanel();
        _renderCards(document.getElementById('concept-cards-container'), false);
      });
    }
  }

  return { init };
})();

/* ── Bootstrap on DOMContentLoaded ────────────────────────────── */
if (typeof window !== 'undefined') {
  window.ElitezWorkflow = {
    setActiveStage,
    syncAdminEmptyStates,
    RequirementReviewPanel,
    ConceptSelectionPanel,
    DashboardPanel,
    SourceDrawer,
    RegenerateModal,
    AuthGate,
  };

  document.addEventListener('DOMContentLoaded', function () {
    // Auth gate first — check session, show login overlay if needed
    AuthGate.init().then(() => {
      // These init after auth succeeds
      DashboardPanel.init();
      RequirementReviewPanel.init();
      ConceptSelectionPanel.init();
    }).catch(() => {
      // Auth gate handles its own UI — error is already shown
    });

    // Source drawer close
    const drawerClose = document.getElementById('source-drawer-close');
    if (drawerClose) drawerClose.addEventListener('click', SourceDrawer.close);
    const drawerBackdrop = document.getElementById('source-drawer-backdrop');
    if (drawerBackdrop) drawerBackdrop.addEventListener('click', SourceDrawer.close);

    // Regenerate modal buttons
    const regenClose = document.getElementById('regen-modal-close');
    if (regenClose) regenClose.addEventListener('click', RegenerateModal.close);
    const regenCancel = document.getElementById('regen-modal-cancel');
    if (regenCancel) regenCancel.addEventListener('click', RegenerateModal.close);
    const regenConfirm = document.getElementById('regen-modal-confirm');
    if (regenConfirm) regenConfirm.addEventListener('click', RegenerateModal.confirm);
    const regenBackdrop = document.getElementById('regen-modal-backdrop');
    if (regenBackdrop) regenBackdrop.addEventListener('click', RegenerateModal.close);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    setActiveStage,
    syncAdminEmptyStates,
  };
}
