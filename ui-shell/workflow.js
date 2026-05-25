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

/* ── Success/info toast ─────────────────────────────────────────── */
function showToast(message, type = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  const bg = type === 'error' ? '#dc2626' : type === 'warn' ? '#d97706' : '#16a34a';
  toast.style.cssText = `background:${bg};color:#fff;padding:10px 16px;border-radius:8px;font-size:.88rem;box-shadow:0 2px 8px rgba(0,0,0,.2);max-width:320px`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

/* ── Stage-unlock state (tracks which stages are accessible) ──── */
const _unlockedStages = new Set(['dashboard', 'intake']);

function unlockStage(stageName) {
  _unlockedStages.add(stageName);
  // Update rail visuals
  document.querySelectorAll('[data-workflow-stage]').forEach(item => {
    const s = item.dataset.workflowStage;
    item.setAttribute('aria-disabled', _unlockedStages.has(s) ? 'false' : 'true');
    item.style.opacity = _unlockedStages.has(s) ? '' : '0.45';
    item.style.pointerEvents = _unlockedStages.has(s) ? '' : 'none';
  });
}

function unlockStageFromProposalState(proposalStage) {
  const order = ['intake', 'requirements', 'concepts', 'costing', 'studio', 'export'];
  const idx = order.indexOf(proposalStage);
  order.forEach((s, i) => { if (i <= idx) unlockStage(s); });
  unlockStage('dashboard');
  unlockStage('admin');
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
          <td data-label="Proposal"><div class="proposal-name">${escapeHtml(p.title)}</div></td>
          <td data-label="Status"><span class="status-pill ${_statusClass(p.status)}">${escapeHtml(p.status)}</span></td>
          <td data-label="Stage">${escapeHtml(_stageLabel(p.current_stage))}</td>
          <td data-label="Created" class="date-text">${new Date(p.created_at).toLocaleDateString()}</td>
          <td data-label="Updated" class="date-text">${new Date(p.updated_at).toLocaleDateString()}</td>
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

  async function openProposal(id) {
    _currentProposalId = id;
    // Navigate to intake stage
    const stages = document.querySelectorAll('[data-workflow-stage]');
    const contents = document.querySelectorAll('[data-content]');
    const tabs = document.querySelectorAll('[data-stage]');
    setActiveStage('intake', tabs, contents, stages);
    // Unlock stages based on backend proposal state
    try {
      const p = await apiFetch(`/api/proposals/${id}`);
      unlockStageFromProposalState(p.current_stage);
    } catch (_) { /* non-critical */ }
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

  async function loadKpis() {
    try {
      const stats = await apiFetch('/api/proposals/stats');
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('kpi-total', stats.total);
      set('kpi-review', stats.in_review);
      set('kpi-approved', stats.approved);
      set('kpi-exported', stats.exported);
    } catch (_) { /* non-critical; leave placeholders */ }
  }

  async function loadActivity() {
    const list = document.getElementById('activity-list');
    if (!list) return;
    try {
      const events = await apiFetch('/api/audit');
      const recent = events.slice(0, 8);
      if (!recent.length) {
        list.innerHTML = '<li class="activity-item"><div class="activity-body"><p class="activity-time">No activity yet.</p></div></li>';
        return;
      }
      const dotClass = (t) => {
        if (t.includes('approv')) return 'activity-dot--approved';
        if (t.includes('export')) return 'activity-dot--export';
        if (t.includes('review') || t.includes('concept')) return 'activity-dot--review';
        return 'activity-dot--default';
      };
      const label = (e) => {
        const t = e.event_type.replace(/_/g, ' ');
        return t.charAt(0).toUpperCase() + t.slice(1);
      };
      list.innerHTML = recent.map((e, i) => `
        <li class="activity-item">
          <div class="activity-dot-col">
            <div class="activity-dot ${dotClass(e.event_type)}"></div>
            ${i < recent.length - 1 ? '<div class="activity-connector"></div>' : ''}
          </div>
          <div class="activity-body">
            <p class="activity-text">${label(e)}</p>
          </div>
        </li>`).join('');
    } catch (_) { /* non-critical */ }
  }

  function init() {
    load();
    loadKpis();
    loadActivity();

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
    const backdrop = document.getElementById('source-drawer-backdrop');
    if (backdrop) { backdrop.hidden = false; backdrop.removeAttribute('aria-hidden'); }
    drawer.hidden = false;
    drawer.setAttribute('aria-modal', 'true');
    const closeBtn = document.getElementById('source-drawer-close');
    if (closeBtn) closeBtn.focus();
    trapFocus(drawer);
  }

  function close() {
    const drawer = document.getElementById('source-drawer');
    if (drawer) { drawer.hidden = true; drawer.removeAttribute('aria-modal'); }
    const backdrop = document.getElementById('source-drawer-backdrop');
    if (backdrop) { backdrop.hidden = true; backdrop.setAttribute('aria-hidden', 'true'); }
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
            unlockStage('concepts');
            showToast('Requirements approved — Concept stage unlocked');
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
          unlockStage('costing');
          showToast('Concept approved — Costing stage unlocked');
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

/* ══════════════════════════════════════════════════════════════
   Stage 5 — CostingPanel (D6 — AC-12/13/14/15)
══════════════════════════════════════════════════════════════ */
const CostingPanel = (function () {
  let _items = [];
  let _initialized = false;

  function _pid() { return _currentProposalId || 1; }

  function _fmt(val) {
    const n = parseFloat(val);
    return isNaN(n) ? '—' : '$' + n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function _statusPill(s) {
    return s === 'priced'
      ? '<span class="pill pill-ok">Priced</span>'
      : '<span class="pill pill-alert">Needs Price</span>';
  }

  function _renderRows() {
    const tbody = document.getElementById('costing-items-tbody');
    if (!tbody) return;
    if (!_items.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--ink-soft);padding:24px">No line items yet. Add one above.</td></tr>';
      return;
    }
    tbody.innerHTML = _items.map(item => `
      <tr data-item-id="${item.id}">
        <td>${escapeHtml(item.item_name)}</td>
        <td>
          <input class="costing-qty-input" data-item="${item.id}" data-field="quantity" type="number" min="0" step="0.01"
            value="${item.quantity}" style="width:60px" aria-label="Quantity for ${escapeHtml(item.item_name)}" />
        </td>
        <td>
          <input class="costing-cost-input" data-item="${item.id}" data-field="unit_cost" type="number" min="0" step="0.01"
            value="${item.unit_cost}" style="width:80px" aria-label="Unit cost for ${escapeHtml(item.item_name)}" />
        </td>
        <td>${_fmt(item.line_total)}</td>
        <td>${_statusPill(item.status)}</td>
        <td class="table-actions">
          <button class="secondary-btn" onclick="CostingPanel.duplicateItem(${item.id})" title="Duplicate">⧉</button>
          <button class="secondary-btn" onclick="CostingPanel.deleteItem(${item.id})">Remove</button>
        </td>
      </tr>`).join('');
    tbody.querySelectorAll('.costing-qty-input, .costing-cost-input').forEach(input => {
      input.addEventListener('change', () => _patchItem(input.dataset.item, input.dataset.field, input.value));
    });
  }

  async function _loadSummary() {
    try {
      const data = await apiFetch(`/api/proposals/${_pid()}/costing/summary`);
      const subtotalEl = document.getElementById('costing-subtotal');
      const countEl = document.getElementById('costing-item-count');
      const missingEl = document.getElementById('costing-missing-count');
      if (subtotalEl) subtotalEl.textContent = _fmt(data.subtotal);
      if (countEl) countEl.textContent = data.item_count;
      if (missingEl) missingEl.textContent = data.missing_count;
    } catch (_) {}
  }

  async function _loadVersionHistory() {
    try {
      const data = await apiFetch(`/api/proposals/${_pid()}/costing/version-history`);
      const list = document.getElementById('costing-version-history');
      if (!list) return;
      if (!data.length) { list.innerHTML = '<li style="color:var(--ink-soft)">No versions yet.</li>'; return; }
      list.innerHTML = data.map(v => `<li><span>${escapeHtml(v.version_label)}</span><span class="pill pill-ok">${new Date(v.created_at || v.snapped_at || '').toLocaleDateString()}</span></li>`).join('');
      const verLabel = document.getElementById('costing-version-label');
      if (verLabel && data.length) verLabel.textContent = data[data.length - 1].version_label;
    } catch (_) {}
  }

  async function _patchItem(itemId, field, value) {
    try {
      const body = { [field]: parseFloat(value) };
      const result = await apiFetch(`/api/costing/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(body) });
      const item = _items.find(i => i.id === parseInt(itemId));
      if (item) {
        item[field] = parseFloat(value);
        item.line_total = result.line_total;
        item.status = result.status;
      }
      _renderRows();
      _loadSummary();
    } catch (err) {
      const banner = document.getElementById('costing-result-banner');
      if (banner) { banner.hidden = false; banner.innerHTML = `<p style="color:var(--danger)">Save failed: ${escapeHtml(err.message)}</p>`; }
    }
  }

  async function duplicateItem(itemId) {
    try {
      const newItem = await apiFetch(`/api/costing/items/${itemId}/duplicate`, { method: 'POST' });
      _items.push(newItem);
      _renderRows();
      _loadSummary();
    } catch (_) {}
  }

  async function deleteItem(itemId) {
    if (!confirm('Remove this costing item?')) return;
    try {
      await apiFetch(`/api/costing/items/${itemId}`, { method: 'DELETE' });
      _items = _items.filter(i => i.id !== itemId);
      _renderRows();
      _loadSummary();
    } catch (err) {
      const banner = document.getElementById('costing-result-banner');
      if (banner) { banner.hidden = false; banner.innerHTML = `<p style="color:var(--danger)">Delete failed.</p>`; }
    }
  }

  async function load() {
    const tbody = document.getElementById('costing-items-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--ink-soft);padding:24px">Loading…</td></tr>';
    try {
      const data = await apiFetch(`/api/proposals/${_pid()}/costing/items`);
      _items = data.items || data;
      _renderRows();
      _loadSummary();
      _loadVersionHistory();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--danger);padding:16px">Failed to load: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function init() {
    if (_initialized) return;
    _initialized = true;
    load();

    const addBtn = document.querySelector('[data-costing-add]');
    if (addBtn) {
      addBtn.addEventListener('click', async () => {
        const name = prompt('Item name:');
        if (!name) return;
        try {
          await apiFetch('/api/costing/items', {
            method: 'POST',
            body: JSON.stringify({ proposal_id: _pid(), item_name: name, quantity: 1, unit_cost: 0 }),
          });
          load();
        } catch (err) {
          alert('Failed to add item: ' + err.message);
        }
      });
    }

    document.querySelectorAll('[data-costing-version]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          const result = await apiFetch(`/api/proposals/${_pid()}/costing/version`, { method: 'POST' });
          const banner = document.getElementById('costing-result-banner');
          if (banner) { banner.hidden = false; banner.innerHTML = `<p><strong>Version saved:</strong> ${escapeHtml(result.version_label)} — ${result.item_count} items, subtotal ${_fmt(result.subtotal)}</p>`; }
          _loadVersionHistory();
        } catch (err) {
          alert('Snapshot failed: ' + err.message);
        }
      });
    });
  }

  return { init, load, deleteItem, duplicateItem };
})();

/* ══════════════════════════════════════════════════════════════
   Stage 6 — StudioPanel (D3+D6 — AC-16/17/18)
══════════════════════════════════════════════════════════════ */
const StudioPanel = (function () {
  let _slides = [];
  let _selectedSlide = null;
  let _initialized = false;

  function _pid() { return _currentProposalId || 1; }

  function _renderSlides() {
    const list = document.getElementById('studio-slides-list');
    const actionsEl = document.getElementById('studio-slide-actions');
    if (!list) return;
    if (!_slides.length) {
      list.innerHTML = '<li style="color:var(--ink-soft)">No slides yet.</li>';
      if (actionsEl) actionsEl.hidden = false;
      return;
    }
    list.innerHTML = _slides.map(s => {
      const statusChip = s.status === 'ready'
        ? '<span class="chip ok">Ready</span>'
        : s.status === 'error'
          ? '<span class="chip blocked">Error</span>'
          : '<span class="chip review">Draft</span>';
      const isSelected = _selectedSlide && _selectedSlide.id === s.id;
      return `<li class="${isSelected ? 'selected-slide' : ''}" style="cursor:pointer;padding:6px 4px;border-radius:6px${isSelected ? ';background:var(--orange-tint)' : ''}"
          data-slide-id="${s.id}" tabindex="0" role="button" aria-pressed="${isSelected}">
        <span>${String(s.position).padStart(2,'0')} ${escapeHtml(s.title)}</span>${statusChip}
      </li>`;
    }).join('');
    list.querySelectorAll('[data-slide-id]').forEach(li => {
      li.addEventListener('click', () => _selectSlide(parseInt(li.dataset.slideId)));
      li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _selectSlide(parseInt(li.dataset.slideId)); } });
    });
    if (actionsEl) actionsEl.hidden = false;
  }

  function _selectSlide(slideId) {
    _selectedSlide = _slides.find(s => s.id === slideId) || null;
    const preview = document.getElementById('studio-preview-content');
    const regenActions = document.getElementById('studio-regen-actions');
    if (preview && _selectedSlide) {
      preview.innerHTML = `<p><strong>${escapeHtml(_selectedSlide.title)}</strong></p><p>${escapeHtml(_selectedSlide.content || 'No content yet.')}</p>`;
      if (regenActions) regenActions.hidden = false;
    }
    _renderSlides();
  }

  async function load() {
    const list = document.getElementById('studio-slides-list');
    if (!list) return;
    list.innerHTML = '<li style="color:var(--ink-soft)">Loading slides…</li>';
    try {
      const data = await apiFetch(`/api/proposals/${_pid()}/studio/slides`);
      _slides = data.slides || data;
      _renderSlides();
    } catch (err) {
      list.innerHTML = `<li style="color:var(--danger)">Failed to load slides: ${escapeHtml(err.message)}</li>`;
    }
  }

  async function _regenerate(slide) {
    const guidance = prompt(`Guidance for regenerating "${slide.title}" (leave blank for auto):`);
    if (guidance === null) return;
    const preview = document.getElementById('studio-preview-content');
    if (preview) preview.innerHTML = '<p style="color:var(--ink-soft)">Regenerating with AI…</p>';
    try {
      const result = await apiFetch(`/api/studio/slides/${slide.id}/regenerate`, {
        method: 'POST',
        body: JSON.stringify({ guidance }),
      });
      slide.content = result.content;
      slide.status = result.status;
      if (preview) preview.innerHTML = `<p><strong>${escapeHtml(slide.title)}</strong></p><p>${escapeHtml(result.content || 'Regeneration failed.')}</p>`;
      _renderSlides();
    } catch (err) {
      if (preview) preview.innerHTML = `<p style="color:var(--danger)">Regeneration failed: ${escapeHtml(err.message)}</p>`;
    }
  }

  function init() {
    if (_initialized) return;
    _initialized = true;
    load();

    const regenBtn = document.getElementById('studio-regen-btn');
    if (regenBtn) {
      regenBtn.addEventListener('click', () => {
        if (_selectedSlide) _regenerate(_selectedSlide);
      });
    }

    // Add Slide button
    const addSlideBtn = document.getElementById('studio-add-slide-btn');
    if (addSlideBtn) {
      addSlideBtn.addEventListener('click', async () => {
        const title = prompt('Slide title:', 'New Slide');
        if (!title) return;
        try {
          const slide = await apiFetch(`/api/proposals/${_pid()}/studio/slides`, {
            method: 'POST',
            body: JSON.stringify({ title }),
          });
          _slides.push(slide);
          _renderSlides();
        } catch (_) {}
      });
    }

    // Reorder: move selected slide up/down
    const moveUpBtn = document.getElementById('studio-move-up-btn');
    const moveDownBtn = document.getElementById('studio-move-down-btn');
    if (moveUpBtn) {
      moveUpBtn.addEventListener('click', async () => {
        if (!_selectedSlide) return;
        const idx = _slides.findIndex(s => s.id === _selectedSlide.id);
        if (idx <= 0) return;
        const target = _slides[idx - 1];
        try {
          await apiFetch(`/api/studio/slides/${_selectedSlide.id}/reorder`, {
            method: 'PATCH',
            body: JSON.stringify({ new_position: target.position }),
          });
          await load();
        } catch (_) {}
      });
    }
    if (moveDownBtn) {
      moveDownBtn.addEventListener('click', async () => {
        if (!_selectedSlide) return;
        const idx = _slides.findIndex(s => s.id === _selectedSlide.id);
        if (idx < 0 || idx >= _slides.length - 1) return;
        const target = _slides[idx + 1];
        try {
          await apiFetch(`/api/studio/slides/${_selectedSlide.id}/reorder`, {
            method: 'PATCH',
            body: JSON.stringify({ new_position: target.position }),
          });
          await load();
        } catch (_) {}
      });
    }
  }

  return { init, load };
})();

/* ══════════════════════════════════════════════════════════════
   Stage 7 — ExportPanel (D6 — AC-19/20/21)
══════════════════════════════════════════════════════════════ */
const ExportPanel = (function () {
  let _initialized = false;

  function _pid() { return _currentProposalId || 1; }

  const GATE_ICONS = {
    pass: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="readiness-icon" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    fail: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="readiness-icon" style="color:var(--danger)" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  };

  async function _loadGate() {
    const gateList = document.getElementById('export-gate-list');
    const createBtn = document.getElementById('export-create-draft-btn');
    if (!gateList) return;
    try {
      const data = await apiFetch(`/api/proposals/${_pid()}/exports/drafts`);
      const gates = data.gate_checks || [];
      gateList.innerHTML = gates.length
        ? gates.map(g => `<li class="readiness-item ${g.pass ? 'readiness--pass' : 'readiness--blocked'}">
            ${GATE_ICONS[g.pass ? 'pass' : 'fail']}
            <span class="readiness-label">${escapeHtml(g.label)}</span>
            <span class="readiness-value">${g.pass ? 'Yes' : 'No'}</span>
          </li>`).join('')
        : '<li style="color:var(--ink-soft)">No gate checks available.</li>';
      const allPass = gates.every(g => g.pass);
      if (createBtn) createBtn.disabled = !allPass;
      _renderDrafts(data.drafts || []);
    } catch (err) {
      if (gateList) gateList.innerHTML = `<li style="color:var(--danger)">Gate check failed: ${escapeHtml(err.message)}</li>`;
    }
  }

  function _renderDrafts(drafts) {
    const list = document.getElementById('export-drafts-list');
    if (!list) return;
    if (!drafts.length) { list.innerHTML = '<li style="color:var(--ink-soft)">No drafts yet.</li>'; return; }
    list.innerHTML = drafts.map(d => `<li>
      <span>${escapeHtml(d.parent_version || 'Draft')} — ${escapeHtml(d.artifact_type || 'Package')} — <span class="pill ${d.state === 'staged' ? 'pill-review' : 'pill-ok'}">${escapeHtml(d.state)}</span></span>
      ${d.state === 'staged' ? `<button class="secondary-btn" style="margin-left:8px" onclick="ExportPanel.promoteDraft(${d.id})">Promote</button>` : ''}
      ${d.package_id ? `<a class="secondary-btn" style="margin-left:8px;text-decoration:none" href="/api/exports/packages/${d.package_id}/download">Download</a>` : ''}
    </li>`).join('');
  }

  async function _createDraft() {
    const btn = document.getElementById('export-create-draft-btn');
    if (btn) btn.disabled = true;
    try {
      await apiFetch(`/api/proposals/${_pid()}/exports/drafts`, { method: 'POST' });
      _loadGate();
    } catch (err) {
      const errEl = document.getElementById('export-gate-error');
      if (errEl) { errEl.hidden = false; errEl.textContent = 'Draft creation failed: ' + err.message; }
      if (btn) btn.disabled = false;
    }
  }

  async function promoteDraft(draftId) {
    try {
      await apiFetch(`/api/exports/drafts/${draftId}/promote`, { method: 'POST' });
      _loadGate();
    } catch (err) {
      alert('Promote failed: ' + err.message);
    }
  }

  async function _loadApprovals() {
    const list = document.getElementById('export-approvals-list');
    if (!list) return;
    try {
      const data = await apiFetch(`/api/proposals/${_pid()}/exports/drafts`);
      const approvals = data.approvals || [];
      if (!approvals.length) { list.innerHTML = '<li style="color:var(--ink-soft)">No approvals yet.</li>'; return; }
      list.innerHTML = approvals.map(a => `<li>${escapeHtml(a.approver)} <span class="chip ${a.decision === 'approved' ? 'ok' : a.decision === 'rejected' ? 'blocked' : 'review'}">${escapeHtml(a.decision)}</span></li>`).join('');
    } catch (_) {}
  }

  function init() {
    if (_initialized) return;
    _initialized = true;
    _loadGate();
    _loadApprovals();

    const createBtn = document.getElementById('export-create-draft-btn');
    if (createBtn) createBtn.addEventListener('click', _createDraft);

    const approvalBtn = document.getElementById('export-request-approval-btn');
    if (approvalBtn) {
      approvalBtn.addEventListener('click', async () => {
        try {
          await apiFetch('/api/approvals', {
            method: 'POST',
            body: JSON.stringify({ proposal_id: _pid() }),
          });
          _loadApprovals();
        } catch (err) {
          alert('Approval request failed: ' + err.message);
        }
      });
    }
  }

  return { init, promoteDraft };
})();

/* ══════════════════════════════════════════════════════════════
   Stage 8 — AdminPanel (D6 — AC-22/23/24)
══════════════════════════════════════════════════════════════ */
const AdminPanel = (function () {
  let _initialized = false;

  async function _loadGovernanceSummary() {
    try {
      const data = await apiFetch('/api/admin/governance/summary');
      const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
      set('gov-kpi-pricing-count', data.pricing_sku_count ?? '—');
      set('gov-kpi-assets-count', data.asset_count ?? '—');
      set('gov-kpi-templates-count', data.template_count ?? '—');
      set('gov-kpi-variance-count', data.variance_flag_count ?? '—');

      const priceStaleEl = document.getElementById('gov-kpi-pricing-stale');
      if (priceStaleEl) priceStaleEl.innerHTML = data.stale_pricing_count ? `<span class="pill pill-stale">${data.stale_pricing_count} stale</span>` : '';
      const assetDupEl = document.getElementById('gov-kpi-assets-dup');
      if (assetDupEl) assetDupEl.innerHTML = data.duplicate_asset_count ? `<span class="pill pill-alert">${data.duplicate_asset_count} duplicates</span>` : '';
      const tmplInactiveEl = document.getElementById('gov-kpi-templates-inactive');
      if (tmplInactiveEl) tmplInactiveEl.innerHTML = data.inactive_template_count ? `<span class="pill pill-alert">${data.inactive_template_count} inactive</span>` : '';
      const varStatusEl = document.getElementById('gov-kpi-variance-status');
      if (varStatusEl) varStatusEl.innerHTML = data.variance_flag_count > 0 ? '<span class="pill pill-alert">active</span>' : '<span class="pill pill-ok">clear</span>';

      const guardrailEl = document.getElementById('gov-guardrail-summary');
      if (guardrailEl) guardrailEl.textContent = `pricing variance ${data.variance_flag_count ?? 0} · stale ${data.stale_pricing_count ?? 0} · inactive templates ${data.inactive_template_count ?? 0}`;
    } catch (_) {}
  }

  async function _loadPricing() {
    const tbody = document.getElementById('admin-pricing-tbody');
    if (!tbody) return;
    try {
      const data = await apiFetch('/api/admin/pricing');
      const items = data.items || data;
      if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--ink-soft);padding:20px">No pricing items.</td></tr>';
        return;
      }
      tbody.innerHTML = items.map(item => `
        <tr data-pricing-id="${item.id}">
          <td>${escapeHtml(item.item_name)}</td>
          <td>${escapeHtml(item.unit || '—')}</td>
          <td class="price-cell">
            <span class="price-display" id="price-display-${item.id}">$${parseFloat(item.current_price || 0).toLocaleString()}</span>
            <input class="price-input" id="price-input-${item.id}" type="text" value="${item.current_price || 0}"
              style="display:none;width:80px" aria-label="Edit price for ${escapeHtml(item.item_name)}" />
          </td>
          <td>${item.updated_at ? new Date(item.updated_at).toLocaleDateString() : '—'}</td>
          <td>
            ${item.is_stale ? '<span class="pill pill-stale">Stale</span>' : ''}
            ${item.has_variance_warning ? '<span class="pill pill-alert">Variance</span>' : ''}
            <div class="action-row" style="margin-top:6px">
              <button class="secondary-btn" onclick="AdminPanel.editPrice(${item.id})">Edit</button>
              <button class="secondary-btn" id="price-save-${item.id}" style="display:none" onclick="AdminPanel.savePrice(${item.id})">Save</button>
              <button class="secondary-btn" id="price-cancel-${item.id}" style="display:none" onclick="AdminPanel.cancelEdit(${item.id})">Cancel</button>
            </div>
          </td>
        </tr>`).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--danger);padding:16px">Failed to load pricing: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function editPrice(itemId) {
    const display = document.getElementById(`price-display-${itemId}`);
    const input = document.getElementById(`price-input-${itemId}`);
    const saveBtn = document.getElementById(`price-save-${itemId}`);
    const cancelBtn = document.getElementById(`price-cancel-${itemId}`);
    if (display) display.style.display = 'none';
    if (input) { input.style.display = ''; input.focus(); }
    if (saveBtn) saveBtn.style.display = '';
    if (cancelBtn) cancelBtn.style.display = '';
  }

  function cancelEdit(itemId) {
    const display = document.getElementById(`price-display-${itemId}`);
    const input = document.getElementById(`price-input-${itemId}`);
    const saveBtn = document.getElementById(`price-save-${itemId}`);
    const cancelBtn = document.getElementById(`price-cancel-${itemId}`);
    if (display) display.style.display = '';
    if (input) input.style.display = 'none';
    if (saveBtn) saveBtn.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = 'none';
  }

  async function savePrice(itemId) {
    const input = document.getElementById(`price-input-${itemId}`);
    const display = document.getElementById(`price-display-${itemId}`);
    const newPrice = parseFloat((input || {}).value);
    if (isNaN(newPrice)) { alert('Enter a valid price.'); return; }
    try {
      const result = await apiFetch(`/api/admin/pricing/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ current_price: newPrice }),
      });
      if (display) display.textContent = '$' + parseFloat(result.current_price).toLocaleString();
      cancelEdit(itemId);
      _loadGovernanceSummary();
    } catch (err) {
      alert('Save failed: ' + err.message);
    }
  }

  async function _loadAssets() {
    const tbody = document.getElementById('admin-assets-tbody');
    if (!tbody) return;
    try {
      const assets = await apiFetch('/api/admin/assets');
      if (!assets.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--ink-soft);padding:20px">No template assets.</td></tr>';
        return;
      }
      tbody.innerHTML = assets.map(a => `
        <tr>
          <td>${escapeHtml(a.asset_type)}</td>
          <td>${escapeHtml(a.title)}</td>
          <td>
            ${a.is_stale ? '<span class="pill pill-stale">Stale</span>' : ''}
            ${a.is_duplicate_candidate ? '<span class="pill pill-alert">Duplicate?</span>' : ''}
            ${!a.is_active ? '<span class="pill pill-review">Inactive</span>' : ''}
          </td>
          <td class="table-actions">
            ${a.is_duplicate_candidate ? `<button class="secondary-btn" onclick="AdminPanel.clearDuplicate(${a.id})">Clear Duplicate</button>` : ''}
            <button class="secondary-btn" onclick="AdminPanel.toggleAssetActive(${a.id}, ${a.is_active})">${a.is_active ? 'Deactivate' : 'Activate'}</button>
          </td>
        </tr>`).join('');
    } catch (_) {}
  }

  async function clearDuplicate(assetId) {
    try {
      await apiFetch(`/api/admin/assets/${assetId}/duplicate-check`, { method: 'POST' });
      _loadAssets();
      _loadGovernanceSummary();
    } catch (_) {}
  }

  async function toggleAssetActive(assetId, currentlyActive) {
    try {
      await apiFetch(`/api/admin/assets/${assetId}/toggle-active`, { method: 'POST' });
      _loadAssets();
      _loadGovernanceSummary();
    } catch (_) {}
  }

  function init() {
    if (_initialized) return;
    _initialized = true;
    _loadGovernanceSummary();
    _loadPricing();
    _loadAssets();
  }

  return { init, editPrice, cancelEdit, savePrice, clearDuplicate, toggleAssetActive };
})();

/* ── TenderIntakePanel ─────────────────────────────────────────── */
const TenderIntakePanel = (function () {
  let _proposalId = null;
  let _pollTimers = {};

  const _statusChip = (s) => {
    if (s === 'complete') return '<span class="chip ok">Parsed</span>';
    if (s === 'failed')   return '<span class="chip error">Failed</span>';
    if (s === 'parsing')  return '<span class="chip review">Parsing…</span>';
    return '<span class="chip review">Queued</span>';
  };

  async function _loadDocs() {
    if (!_proposalId) return;
    const list = document.getElementById('intake-queue-list');
    if (!list) return;
    try {
      const docs = await apiFetch(`/api/proposals/${_proposalId}/documents`);
      if (!docs.length) {
        list.innerHTML = '<li class="note">No documents uploaded yet.</li>';
        _setParseStatus(null);
        return;
      }
      list.innerHTML = docs.map(d =>
        `<li data-doc-id="${d.id}"><strong>${d.filename}</strong>${_statusChip(d.parse_status)}</li>`
      ).join('');
      _setParseStatus(docs);
    } catch (_) { /* non-critical */ }
  }

  function _setParseStatus(docs) {
    const msg = document.getElementById('intake-parse-status-msg');
    const bar = document.getElementById('intake-progress-bar');
    const fill = document.getElementById('intake-progress-fill');
    if (!docs || !docs.length) {
      if (msg) msg.textContent = 'Upload documents to begin.';
      if (bar) bar.style.display = 'none';
      return;
    }
    const total = docs.length;
    const done = docs.filter(d => d.parse_status === 'complete' || d.parse_status === 'failed').length;
    const pct = Math.round((done / total) * 100);
    if (msg) msg.textContent = `${done}/${total} parsed (${pct}%)`;
    if (bar) bar.style.display = '';
    if (fill) fill.style.width = `${pct}%`;
  }

  function _pollDoc(docId) {
    if (_pollTimers[docId]) return;
    _pollTimers[docId] = setInterval(async () => {
      try {
        const data = await apiFetch(`/api/parse-status/${docId}`);
        if (data.parse_status === 'complete' || data.parse_status === 'failed') {
          clearInterval(_pollTimers[docId]);
          delete _pollTimers[docId];
          await _loadDocs();
        }
      } catch (_) { /* keep polling */ }
    }, 2500);
  }

  async function _uploadFile(file) {
    if (!_proposalId) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('proposal_id', String(_proposalId));
    try {
      const resp = await fetch('/api/uploads', { method: 'POST', credentials: 'include', body: fd });
      if (!resp.ok) throw new Error(`upload ${resp.status}`);
      const data = await resp.json();
      await _loadDocs();
      // Start polling if not immediately complete
      if (data.parse_status !== 'complete' && data.parse_status !== 'failed') {
        _pollDoc(data.document_id);
      }
    } catch (err) {
      console.error('Upload failed:', err);
    }
  }

  function setProposal(id) {
    _proposalId = id;
    _loadDocs();
  }

  function init() {
    const dropzone = document.getElementById('intake-dropzone');
    const fileInput = document.getElementById('intake-file-input');

    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        Array.from(e.target.files).forEach(_uploadFile);
        e.target.value = '';
      });
    }

    if (dropzone) {
      dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
      dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        Array.from(e.dataTransfer.files).forEach(_uploadFile);
      });
    }

    const saveDraft = document.getElementById('intake-save-draft');
    const saveStart = document.getElementById('intake-save-start');
    if (saveDraft) {
      saveDraft.addEventListener('click', async () => {
        if (!_proposalId) {
          const title = prompt('Proposal title:', 'New Proposal');
          if (!title) return;
          const p = await DashboardPanel.createProposal(title);
          setProposal(p.id);
        }
        saveDraft.textContent = 'Saved';
        setTimeout(() => { saveDraft.textContent = 'Save Draft'; }, 2000);
      });
    }
    if (saveStart) {
      saveStart.addEventListener('click', async () => {
        if (!_proposalId) {
          const title = prompt('Proposal title:', 'New Proposal');
          if (!title) return;
          const p = await DashboardPanel.createProposal(title);
          setProposal(p.id);
        }
        if (_proposalId) {
          try {
            await apiFetch(`/api/proposals/${_proposalId}/tender/extract`, { method: 'POST' });
            await _loadDocs();
          } catch (err) {
            console.error('Extract failed:', err);
          }
        }
      });
    }
  }

  return { init, setProposal, loadDocs: _loadDocs };
})();

/* ── Bootstrap on DOMContentLoaded ────────────────────────────── */
if (typeof window !== 'undefined') {
  window.ElitezWorkflow = {
    setActiveStage,
    syncAdminEmptyStates,
    RequirementReviewPanel,
    ConceptSelectionPanel,
    TenderIntakePanel,
    DashboardPanel,
    SourceDrawer,
    RegenerateModal,
    AuthGate,
    CostingPanel,
    StudioPanel,
    ExportPanel,
    AdminPanel,
  };

  document.addEventListener('DOMContentLoaded', function () {
    // Auth gate first — check session, show login overlay if needed
    AuthGate.init().then(() => {
      // These init after auth succeeds
      DashboardPanel.init();
      TenderIntakePanel.init();
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
