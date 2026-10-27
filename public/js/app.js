// Main Application Controller for Tenant Reserver

let state = {
  spaces: [],
  tenants: [],
  slots: {},
  history: [],
  filterTenant: 'all',
  searchQuery: '',
  selectedSlotId: null,
  claimSpaceId: 'stage_sekkat',
  claimSelectedTenants: new Set(['ali']),
  editingSpaceId: null
};

// SVG Icon Helpers
const ICONS = {
  gitBranch: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path></svg>`,
  clock: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
  user: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`,
  check: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
  copy: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`,
  arrowDown: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>`,
  arrowUp: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>`,
  calendar: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>`,
  trash: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`,
  edit: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`
};

document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  updateSoundButtonUI();

  window.apiClient.onConnectionChange(updateConnectionStatus);
  window.apiClient.onStateUpdate(handleStateUpdate);
  window.apiClient.connectWS();

  // Listen to reserve time changes for instant conflict validation
  const reserveTimeInput = document.getElementById('claim-reserve-time');
  if (reserveTimeInput) {
    reserveTimeInput.addEventListener('input', () => validateModalConflicts());
    reserveTimeInput.addEventListener('change', () => validateModalConflicts());
  }

  setInterval(renderCountdowns, 1000);

  // Close modals on backdrop click
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        closeClaimModal();
        closeDetailsModal();
        closeEditSpaceBranchesModal();
      }
    });
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeClaimModal();
      closeDetailsModal();
      closeEditSpaceBranchesModal();
      const drawer = document.getElementById('history-drawer');
      if (drawer && drawer.classList.contains('open')) {
        drawer.classList.remove('open');
      }
    } else if (e.key === 'Enter') {
      const claimModal = document.getElementById('claim-modal');
      const editModal = document.getElementById('edit-space-branches-modal');
      if (claimModal && claimModal.classList.contains('open')) {
        if (e.target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          submitClaimForm();
        }
      } else if (editModal && editModal.classList.contains('open')) {
        e.preventDefault();
        submitEditSpaceBranches();
      }
    }
  });

  document.addEventListener('click', () => {
    if (window.soundEngine) window.soundEngine.init();
  }, { once: true });
});

function updateConnectionStatus(isConnected, text) {
  const pill = document.getElementById('connection-status');
  if (!pill) return;
  if (isConnected) {
    pill.className = 'status-pill';
    pill.innerHTML = `<span class="pulse-dot"></span><span>LIVE SYNCED</span>`;
  } else {
    pill.className = 'status-pill offline';
    pill.innerHTML = `<span class="pulse-dot"></span><span>${text || 'OFFLINE'}</span>`;
  }
}

function handleStateUpdate(data) {
  if (data.spaces) state.spaces = data.spaces;
  if (data.tenants) state.tenants = data.tenants;
  if (data.slots) state.slots = data.slots;
  if (data.history) state.history = data.history;
  if (data.clientIp) {
    state.clientIp = data.clientIp;
    const ipText = document.getElementById('user-ip-text');
    if (ipText) ipText.textContent = `IP: ${data.clientIp}`;
  }

  renderStats();
  renderGrid();
  renderHistoryDrawer();

  // If claim modal is open, refresh space branches preview
  const claimModal = document.getElementById('claim-modal');
  if (claimModal && claimModal.classList.contains('open')) {
    updateClaimModalSpaceBranchesPreview();
    renderTenantSelectorCards();
  }

  // If details modal is open, refresh it
  if (state.selectedSlotId) {
    const slot = state.slots[state.selectedSlotId];
    if (slot) updateActiveModalDetails(slot);
  }
}

function renderStats() {
  const allSlots = Object.values(state.slots);
  const total = allSlots.length || 9;
  const occupied = allSlots.filter(s => s.status === 'occupied').length;
  const free = total - occupied;
  let totalReservations = 0;
  allSlots.forEach(s => {
    totalReservations += (s.reservations || []).length;
  });

  const freeEl = document.getElementById('stat-free');
  const occEl = document.getElementById('stat-occupied');
  const resEl = document.getElementById('stat-reserved');

  if (freeEl) freeEl.textContent = `${free}/${total}`;
  if (occEl) occEl.textContent = `${occupied}/${total}`;
  if (resEl) resEl.textContent = `${totalReservations}`;
}

// Render Space Cards with Space-Level Branches & Tenant Buttons
function renderGrid() {
  const container = document.getElementById('spaces-container');
  if (!container || !state.spaces.length) return;

  const filter = state.filterTenant;
  const query = state.searchQuery.trim().toLowerCase();

  let html = '';

  state.spaces.forEach(space => {
    const spaceSlots = Object.values(state.slots).filter(s => s.spaceId === space.id);

    const visibleSlots = spaceSlots.filter(slot => {
      if (filter !== 'all' && slot.tenantId !== filter) return false;
      if (query) {
        const tName = (slot.tenantName || '').toLowerCase();
        const sName = (slot.spaceName || '').toLowerCase();
        const uName = (slot.currentOccupant?.userName || '').toLowerCase();
        const branches = space.branches || {};
        const feName = (branches.frontend || '').toLowerCase();
        const beName = (branches.backend || '').toLowerCase();
        const crmName = (branches.crm || '').toLowerCase();
        return tName.includes(query) || sName.includes(query) || uName.includes(query) ||
               feName.includes(query) || beName.includes(query) || crmName.includes(query);
      }
      return true;
    });

    const activeCount = spaceSlots.filter(s => s.status === 'occupied').length;
    const branches = space.branches || {};

    html += `
      <section class="space-card" style="--space-accent: ${space.accentColor};" data-space-id="${space.id}">
        <!-- Space Header -->
        <div class="space-header">
          <div class="space-title-area">
            <span class="space-badge"></span>
            <div>
              <h2 class="space-name">${space.displayName}</h2>
              <span style="font-size: 0.6875rem; color: var(--text-dim); text-transform: uppercase;">
                ${activeCount === spaceSlots.length ? '🔴 Space Full' : activeCount > 0 ? `🟡 ${activeCount}/3 In Use` : '🟢 3 Free'}
              </span>
            </div>
          </div>

          <div class="space-actions">
            <button type="button" class="btn-space-action claim-space" onclick="openClaimModalForSpace('${space.id}')" title="Reserve or Occupy tenants in this space">
              ⚡ Reserve / Push In
            </button>
            ${activeCount > 0 ? `
              <button type="button" class="btn-space-action release-space" onclick="quickReleaseSpace('${space.id}', event)" title="Release all active tenants in this space">
                Free All
              </button>
            ` : ''}
          </div>
        </div>

        <!-- Space-Level Branches Banner (Shared by all tenants in this space) -->
        <div class="space-branches-banner">
          <div class="space-branches-header">
            <span class="space-branches-title">
              ${ICONS.gitBranch} Space Branches (Shared by all tenants)
            </span>
            <button type="button" class="btn-edit-branches" onclick="openEditSpaceBranchesModal('${space.id}', event)" title="Edit branches for ${space.displayName}">
              ${ICONS.edit} Edit Space Branches
            </button>
          </div>

          <div class="space-branches-list">
            ${renderSpaceBranchPills(branches)}
          </div>
        </div>

        <!-- The 3 Tenant Push Buttons -->
        <div class="buttons-column">
          ${visibleSlots.length > 0 
            ? visibleSlots.map(slot => renderTactileButton(slot, space)).join('')
            : `<div style="text-align:center; padding: 2rem; color: var(--text-dim); font-size: 0.8125rem;">No matching tenants in this space</div>`
          }
        </div>
      </section>
    `;
  });

  container.innerHTML = html;
}

// Render Space Branch Badges
function renderSpaceBranchPills(branches) {
  const fe = branches?.frontend;
  const be = branches?.backend;
  const crm = branches?.crm;

  if (!fe && !be && !crm) {
    return `<span style="font-size: 0.75rem; color: var(--text-dim); font-style: italic;">No branches set for this space. Click "Edit Space Branches" to configure.</span>`;
  }

  let html = '';
  if (fe) {
    html += `
      <span class="branch-tag branch-tag-fe" onclick="copyGitCommand(event, '${escapeHtml(fe)}')" title="Frontend: click to copy git checkout ${escapeHtml(fe)}">
        <span class="branch-prefix">FE</span> <span>${escapeHtml(fe)}</span> ${ICONS.copy}
      </span>
    `;
  }
  if (be) {
    html += `
      <span class="branch-tag branch-tag-be" onclick="copyGitCommand(event, '${escapeHtml(be)}')" title="Backend: click to copy git checkout ${escapeHtml(be)}">
        <span class="branch-prefix">BE</span> <span>${escapeHtml(be)}</span> ${ICONS.copy}
      </span>
    `;
  }
  if (crm) {
    html += `
      <span class="branch-tag branch-tag-crm" onclick="copyGitCommand(event, '${escapeHtml(crm)}')" title="CRM: click to copy git checkout ${escapeHtml(crm)}">
        <span class="branch-prefix">CRM</span> <span>${escapeHtml(crm)}</span> ${ICONS.copy}
      </span>
    `;
  }
  return html;
}

// Render Individual Tactile Button
function renderTactileButton(slot, space) {
  const isOccupied = slot.status === 'occupied' && slot.currentOccupant;
  const occupant = slot.currentOccupant;
  const reservations = slot.reservations || [];
  const nextReservation = reservations.length > 0 ? reservations[0] : null;

  if (!isOccupied) {
    // Popped Out (Available / Free)
    return `
      <div class="tactile-socket" data-slot-id="${slot.id}">
        <button type="button" 
                class="tactile-button popped-out" 
                onclick="handleTenantButtonClick('${slot.spaceId}', '${slot.tenantId}')"
                aria-label="${slot.tenantName} on ${slot.spaceName}: Free. Click to push in and occupy.">
          
          <div class="btn-top-row">
            <div class="tenant-id-group">
              <span class="led-indicator"></span>
              <span class="tenant-name">${slot.tenantName}</span>
            </div>
            <span class="tenant-state-badge">
              ${ICONS.check} FREE
            </span>
          </div>

          <div class="free-prompt-box">
            <span class="push-cta-text">
              ${ICONS.arrowDown} PUSH IN TO OCCUPY
            </span>
            <span class="push-hint-chip">
              READY
            </span>
          </div>

          ${nextReservation ? `
            <div class="reservation-mini-strip">
              <span>${ICONS.calendar} Next: ${escapeHtml(nextReservation.userName)} at ${formatTimeHM(nextReservation.startTime)}</span>
              <div style="display: flex; align-items: center; gap: 0.35rem;">
                ${window.apiClient.isMyIp(nextReservation.creatorIp) ? `<span class="res-owner-badge mine" style="font-size: 0.5625rem; padding: 1px 4px;">✨ You</span>` : ''}
                <span>${nextReservation.durationMinutes}m</span>
              </div>
            </div>
          ` : ''}
        </button>
      </div>
    `;
  } else {
    // Pushed In (Occupied / In-Use)
    const now = window.apiClient.now();
    const endsAt = occupant.endsAt;
    const remainingMs = Math.max(0, endsAt - now);
    const totalMs = occupant.totalDurationMs || (endsAt - occupant.startedAt);
    const progressPercent = Math.min(100, Math.max(0, 100 - (remainingMs / totalMs * 100)));

    const initial = occupant.userName ? occupant.userName.charAt(0).toUpperCase() : '?';
    const isOccupantMine = window.apiClient.isMyIp(occupant.creatorIp);

    return `
      <div class="tactile-socket" data-slot-id="${slot.id}">
        <div class="tactile-button pushed-in" data-slot-id="${slot.id}">
          
          <div class="btn-top-row">
            <div class="tenant-id-group">
              <span class="led-indicator"></span>
              <span class="tenant-name">${slot.tenantName}</span>
            </div>
            <span class="tenant-state-badge">
              IN USE
            </span>
          </div>

          <div class="occupied-details-box">
            <div class="occupant-branch-row">
              <div class="occupant-info" title="Occupied by ${escapeHtml(occupant.userName)} ${occupant.creatorIp ? `(IP: ${escapeHtml(occupant.creatorIp)})` : ''}">
                <div class="user-avatar-circle">${initial}</div>
                <span class="user-name-text">${escapeHtml(occupant.userName)}</span>
                ${isOccupantMine ? `<span class="res-owner-badge mine" style="font-size: 0.5625rem; padding: 1px 4px;">✨ You</span>` : ''}
              </div>
            </div>

            <!-- Live Countdown Box -->
            <div class="timer-container" onclick="openDetailsModal('${slot.id}')" style="cursor: pointer;" title="Click for details & actions">
              <div class="timer-digits-box">
                <span class="timer-digits" id="timer-${slot.id}">${formatDuration(remainingMs)}</span>
                <span class="timer-label">LEFT</span>
              </div>
              <div class="time-progress-track">
                <div class="time-progress-fill" id="fill-${slot.id}" style="width: ${progressPercent}%;"></div>
              </div>
            </div>

            <!-- Action buttons: Push Out (Release) or Extend -->
            <div class="pushed-action-row">
              <button type="button" class="btn-pop-out" onclick="quickRelease('${slot.id}', event)">
                ${ICONS.arrowUp} PUSH OUT (RELEASE)
              </button>
              <button type="button" class="btn-extend-small" onclick="quickExtend('${slot.id}', 15, event)" title="Add +15 minutes">
                +15m
              </button>
              <button type="button" class="btn-extend-small" onclick="quickExtend('${slot.id}', 30, event)" title="Add +30 minutes">
                +30m
              </button>
              <button type="button" class="btn-extend-small" onclick="openDetailsModal('${slot.id}')" title="More options">
                ⋯
              </button>
            </div>

            ${nextReservation ? `
              <div class="reservation-mini-strip" onclick="openDetailsModal('${slot.id}')" style="cursor: pointer;">
                <span>${ICONS.calendar} Next: ${escapeHtml(nextReservation.userName)} at ${formatTimeHM(nextReservation.startTime)}</span>
                <div style="display: flex; align-items: center; gap: 0.35rem;">
                  ${window.apiClient.isMyIp(nextReservation.creatorIp) ? `<span class="res-owner-badge mine" style="font-size: 0.5625rem; padding: 1px 4px;">✨ You</span>` : ''}
                  <span>${nextReservation.durationMinutes}m</span>
                </div>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }
}

// Countdown Ticker (runs every 1 second)
function renderCountdowns() {
  const now = window.apiClient.now();

  for (const slotId of Object.keys(state.slots)) {
    const slot = state.slots[slotId];
    if (slot.status === 'occupied' && slot.currentOccupant) {
      const remainingMs = Math.max(0, slot.currentOccupant.endsAt - now);
      const totalMs = slot.currentOccupant.totalDurationMs || (slot.currentOccupant.endsAt - slot.currentOccupant.startedAt);
      const progressPercent = Math.min(100, Math.max(0, 100 - (remainingMs / totalMs * 100)));

      const timerEl = document.getElementById(`timer-${slotId}`);
      if (timerEl) timerEl.textContent = formatDuration(remainingMs);

      const fillEl = document.getElementById(`fill-${slotId}`);
      if (fillEl) fillEl.style.width = `${progressPercent}%`;

      const modalTimerEl = document.getElementById('modal-details-timer');
      if (modalTimerEl && state.selectedSlotId === slotId) {
        modalTimerEl.textContent = formatDuration(remainingMs);
      }
    }
  }
}

// Click on a free tenant button
function handleTenantButtonClick(spaceId, tenantId) {
  window.soundEngine.playPushIn();
  openClaimModalForSpace(spaceId, tenantId);
}

// =========================================================
// CLAIM / RESERVE MODAL: CHOOSE TENANTS IN SPACE
// =========================================================

function openClaimModalForSpace(spaceId, defaultTenantId = null) {
  state.claimSpaceId = spaceId;
  const spaceSlots = Object.values(state.slots).filter(s => s.spaceId === spaceId);

  // If a specific tenant button was clicked, select just that one; otherwise default to all free tenants
  if (defaultTenantId) {
    state.claimSelectedTenants = new Set([defaultTenantId]);
  } else {
    const freeTenants = spaceSlots.filter(s => s.status === 'free').map(s => s.tenantId);
    state.claimSelectedTenants = new Set(freeTenants.length > 0 ? freeTenants : ['ali', 'demo', 'demo1']);
  }

  // Populate space select dropdown
  const spaceSelect = document.getElementById('claim-space-select');
  if (spaceSelect) {
    spaceSelect.innerHTML = state.spaces.map(s => `
      <option value="${s.id}" ${s.id === spaceId ? 'selected' : ''}>${s.displayName}</option>
    `).join('');
  }

  updateClaimModalSpaceBranchesPreview();
  renderTenantSelectorCards();

  // Restore cached user name
  const cachedUser = localStorage.getItem('tenant_user_name') || '';
  const userNameInput = document.getElementById('claim-user-name');
  userNameInput.value = cachedUser;

  // Set default mode
  setModalTab('now');
  selectDurationPreset(30);

  const reserveTimeInput = document.getElementById('claim-reserve-time');
  const futureDate = new Date(Date.now() + 15 * 60 * 1000);
  reserveTimeInput.value = formatDateTimeLocal(futureDate);

  const modal = document.getElementById('claim-modal');
  modal.classList.add('open');
  if (!userNameInput.value) {
    userNameInput.focus();
  }
}

function onClaimSpaceChanged(newSpaceId) {
  state.claimSpaceId = newSpaceId;
  const spaceSlots = Object.values(state.slots).filter(s => s.spaceId === newSpaceId);
  const freeTenants = spaceSlots.filter(s => s.status === 'free').map(s => s.tenantId);
  state.claimSelectedTenants = new Set(freeTenants.length > 0 ? freeTenants : ['ali', 'demo', 'demo1']);

  updateClaimModalSpaceBranchesPreview();
  renderTenantSelectorCards();
}

function updateClaimModalSpaceBranchesPreview() {
  const space = state.spaces.find(s => s.id === state.claimSpaceId);
  const container = document.getElementById('claim-modal-space-branches-preview');
  if (!container || !space) return;

  const branches = space.branches || {};
  container.innerHTML = renderSpaceBranchPills(branches);

  const modalSpaceBadge = document.getElementById('claim-modal-space');
  if (modalSpaceBadge) modalSpaceBadge.textContent = space.displayName;
  const modalTitle = document.getElementById('claim-modal-title');
  if (modalTitle) modalTitle.textContent = `Push In / Reserve: ${space.displayName}`;
}

function hasIntervalOverlap(startA, endA, startB, endB) {
  return Math.max(startA, startB) < Math.min(endA, endB);
}

function validateModalConflicts() {
  const isNowTab = document.getElementById('tab-btn-now')?.classList.contains('active');
  const now = window.apiClient.now();
  const durMins = selectedDurationMins || 30;
  const durMs = durMins * 60 * 1000;

  let start = now;
  let end = now + durMs;

  if (!isNowTab) {
    const timeVal = document.getElementById('claim-reserve-time')?.value;
    if (timeVal) {
      start = new Date(timeVal).getTime();
      end = start + durMs;
    }
  }

  const space = state.spaces.find(s => s.id === state.claimSpaceId);
  if (!space) return true;

  const conflicts = [];
  const conflictingTenantIds = new Set();
  const scheduleRows = [];

  const selectedTenants = Array.from(state.claimSelectedTenants);

  // Check each selected tenant
  selectedTenants.forEach(tId => {
    const slot = state.slots[`${space.id}:${tId}`];
    if (!slot) return;

    let hasSlotBooking = false;

    // Check active occupant
    if (slot.status === 'occupied' && slot.currentOccupant) {
      const occ = slot.currentOccupant;
      const occEnd = occ.endsAt;
      const occStart = occ.startedAt;

      hasSlotBooking = true;
      scheduleRows.push({
        tenantName: slot.tenantName,
        userName: occ.userName,
        type: 'Active Occupant',
        range: `Until ${formatTimeHM(occEnd)}`,
        startTime: occStart,
        endTime: occEnd
      });

      if (isNowTab) {
        conflicts.push(`Tenant '${slot.tenantName}' is currently occupied by ${occ.userName} until ${formatTimeHM(occEnd)}`);
        conflictingTenantIds.add(tId);
      } else {
        if (occEnd > start && hasIntervalOverlap(start, end, occStart, occEnd)) {
          conflicts.push(`Tenant '${slot.tenantName}' is currently occupied by ${occ.userName} until ${formatTimeHM(occEnd)}`);
          conflictingTenantIds.add(tId);
        }
      }
    }

    // Check existing reservations
    (slot.reservations || []).forEach(r => {
      hasSlotBooking = true;
      scheduleRows.push({
        tenantName: slot.tenantName,
        userName: r.userName,
        type: 'Reservation',
        range: `${formatDateMD(r.startTime)} ${formatTimeHM(r.startTime)} - ${formatTimeHM(r.endTime)}`,
        startTime: r.startTime,
        endTime: r.endTime
      });

      if (hasIntervalOverlap(start, end, r.startTime, r.endTime)) {
        const startStr = `${formatDateMD(r.startTime)} ${formatTimeHM(r.startTime)}`;
        const endStr = formatTimeHM(r.endTime);
        conflicts.push(`Tenant '${slot.tenantName}' conflicts with existing reservation by ${r.userName} (${startStr} - ${endStr})`);
        conflictingTenantIds.add(tId);
      }
    });

    if (!hasSlotBooking) {
      scheduleRows.push({
        tenantName: slot.tenantName,
        userName: '',
        type: 'Free',
        range: 'No reservations (all clear)'
      });
    }
  });

  // Render Schedule Preview Box
  const scheduleListEl = document.getElementById('claim-existing-schedule-list');
  const scheduleSummaryEl = document.getElementById('claim-schedule-summary');
  if (scheduleListEl) {
    if (scheduleRows.length === 0) {
      scheduleListEl.innerHTML = `<span style="color: var(--text-dim);">No tenants selected</span>`;
    } else {
      scheduleListEl.innerHTML = scheduleRows.map(row => `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.3rem 0.5rem; background: rgba(255,255,255,0.03); border-radius: 6px; font-family: var(--font-mono); font-size: 0.75rem;">
          <span style="font-weight: 700; color: #fff;">${row.tenantName}</span>
          <span style="color: ${row.type === 'Free' ? '#34d399' : row.type === 'Active Occupant' ? '#fb7185' : '#c084fc'};">
            ${row.type}: ${row.range} ${row.userName ? `(${escapeHtml(row.userName)})` : ''}
          </span>
        </div>
      `).join('');
    }
  }

  // Update conflict banner and submit button state
  const banner = document.getElementById('claim-conflict-banner');
  const msgEl = document.getElementById('claim-conflict-message');
  const submitBtn = document.getElementById('claim-submit-btn');
  const submitText = document.getElementById('claim-submit-text');

  if (conflicts.length > 0) {
    if (banner) {
      banner.style.display = 'block';
      msgEl.innerHTML = conflicts.map(c => `<div>• ${escapeHtml(c)}</div>`).join('');
    }
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.style.opacity = '0.5';
      submitBtn.style.cursor = 'not-allowed';
      submitBtn.style.background = '#334155';
      submitBtn.style.boxShadow = 'none';
    }
    if (submitText) {
      submitText.textContent = '⛔ TIME CONFLICT — CANNOT RESERVE';
    }
  } else {
    if (banner) {
      banner.style.display = 'none';
      msgEl.innerHTML = '';
    }
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.style.opacity = '1';
      submitBtn.style.cursor = 'pointer';
      submitBtn.style.background = 'linear-gradient(180deg, #0284c7 0%, #0369a1 100%)';
      submitBtn.style.boxShadow = '0 4px 0 #075985, 0 8px 15px rgba(2, 132, 199, 0.4)';
    }
    if (submitText) {
      submitText.textContent = isNowTab 
        ? 'PUSH IN SELECTED TENANTS NOW' 
        : 'CONFIRM SCHEDULED RESERVATION';
    }
  }

  // Highlight conflicting tenant cards
  document.querySelectorAll('.tenant-select-card').forEach(card => {
    const tId = card.getAttribute('data-tenant-id');
    if (conflictingTenantIds.has(tId)) {
      card.style.borderColor = '#ef4444';
      card.style.background = 'rgba(239, 68, 68, 0.15)';
    } else {
      card.style.borderColor = '';
      card.style.background = '';
    }
  });

  return conflicts.length === 0;
}

function renderTenantSelectorCards() {
  const container = document.getElementById('claim-tenants-selector');
  if (!container) return;

  const space = state.spaces.find(s => s.id === state.claimSpaceId);
  if (!space) return;

  const spaceSlots = Object.values(state.slots).filter(s => s.spaceId === space.id);

  let html = '';
  spaceSlots.forEach(slot => {
    const isSelected = state.claimSelectedTenants.has(slot.tenantId);
    const isOccupied = slot.status === 'occupied';
    const statusText = isOccupied ? `In Use (${escapeHtml(slot.currentOccupant?.userName || 'Busy')})` : 'Available';

    html += `
      <div class="tenant-select-card ${isSelected ? 'selected' : ''} ${isOccupied ? 'busy' : ''}" 
           data-tenant-id="${slot.tenantId}"
           onclick="toggleTenantSelection('${slot.tenantId}')">
        <div class="tenant-card-checkbox">
          ${isSelected ? ICONS.check : ''}
        </div>
        <span class="tenant-card-name">${slot.tenantName}</span>
        <span class="tenant-card-status">${statusText}</span>
      </div>
    `;
  });

  container.innerHTML = html;

  const countBadge = document.getElementById('claim-selected-tenants-count');
  if (countBadge) {
    const count = state.claimSelectedTenants.size;
    countBadge.textContent = `${count} of 3 Selected`;
  }

  // Re-run conflict detection whenever cards render
  validateModalConflicts();
}

function toggleTenantSelection(tenantId) {
  if (state.claimSelectedTenants.has(tenantId)) {
    state.claimSelectedTenants.delete(tenantId);
  } else {
    state.claimSelectedTenants.add(tenantId);
  }
  renderTenantSelectorCards();
}

function selectAllTenantsInClaim(selectAll) {
  if (selectAll) {
    state.claimSelectedTenants = new Set(['ali', 'demo', 'demo1']);
  } else {
    state.claimSelectedTenants.clear();
  }
  renderTenantSelectorCards();
}

function selectFreeTenantsInClaim() {
  const spaceSlots = Object.values(state.slots).filter(s => s.spaceId === state.claimSpaceId);
  const freeTenants = spaceSlots.filter(s => s.status === 'free').map(s => s.tenantId);
  state.claimSelectedTenants = new Set(freeTenants);
  renderTenantSelectorCards();
}

function closeClaimModal() {
  const modal = document.getElementById('claim-modal');
  modal.classList.remove('open');
}

function setModalTab(tab) {
  const tabNow = document.getElementById('tab-btn-now');
  const tabReserve = document.getElementById('tab-btn-reserve');
  const sectionNow = document.getElementById('section-claim-now');
  const sectionReserve = document.getElementById('section-claim-reserve');
  const submitBtnText = document.getElementById('claim-submit-text');

  if (tab === 'now') {
    tabNow.classList.add('active');
    tabReserve.classList.remove('active');
    sectionNow.style.display = 'block';
    sectionReserve.style.display = 'none';
    submitBtnText.textContent = 'PUSH IN SELECTED TENANTS NOW';
  } else {
    tabNow.classList.remove('active');
    tabReserve.classList.add('active');
    sectionNow.style.display = 'none';
    sectionReserve.style.display = 'block';
    submitBtnText.textContent = 'CONFIRM SCHEDULED RESERVATION';
  }

  validateModalConflicts();
}

let selectedDurationMins = 30;

function selectDurationPreset(mins) {
  selectedDurationMins = mins;
  const chips = document.querySelectorAll('#duration-chips .chip-btn');
  chips.forEach(chip => {
    if (parseInt(chip.getAttribute('data-mins'), 10) === mins) {
      chip.classList.add('selected');
    } else {
      chip.classList.remove('selected');
    }
  });
  const customInput = document.getElementById('custom-duration-input');
  customInput.value = mins;
  validateModalConflicts();
}

function handleCustomDurationChange(val) {
  const mins = Math.max(1, parseInt(val, 10) || 30);
  selectedDurationMins = mins;
  const chips = document.querySelectorAll('#duration-chips .chip-btn');
  chips.forEach(chip => {
    if (parseInt(chip.getAttribute('data-mins'), 10) === mins) {
      chip.classList.add('selected');
    } else {
      chip.classList.remove('selected');
    }
  });
  validateModalConflicts();
}

// Submit Claim
async function submitClaimForm() {
  const userNameInput = document.getElementById('claim-user-name');
  const userName = userNameInput.value.trim();

  if (!userName) {
    showToast('Please enter your name', 'warning');
    userNameInput.focus();
    return;
  }

  const selectedList = Array.from(state.claimSelectedTenants);
  if (selectedList.length === 0) {
    showToast('Please select at least one tenant to use in this space', 'warning');
    return;
  }

  // Double check conflicts before network request
  if (!validateModalConflicts()) {
    showToast('Cannot proceed: Selected time conflicts with an existing reservation or active occupant', 'error');
    return;
  }

  const notesInput = document.getElementById('claim-notes');
  const notes = notesInput ? notesInput.value.trim() : '';

  localStorage.setItem('tenant_user_name', userName);

  const isNowTab = document.getElementById('tab-btn-now').classList.contains('active');
  const space = state.spaces.find(s => s.id === state.claimSpaceId);

  try {
    if (isNowTab) {
      window.soundEngine.playPushIn();
      await window.apiClient.occupy({
        spaceId: state.claimSpaceId,
        tenantIds: selectedList,
        userName,
        durationMinutes: selectedDurationMins,
        notes
      });
      showToast(`Pushed in [${selectedList.join(', ')}] on ${space ? space.displayName : state.claimSpaceId}!`, 'success');
    } else {
      const timeVal = document.getElementById('claim-reserve-time').value;
      if (!timeVal) {
        showToast('Please pick a start time for reservation', 'warning');
        return;
      }
      const startTime = new Date(timeVal).toISOString();
      window.soundEngine.playChime();
      await window.apiClient.reserve({
        spaceId: state.claimSpaceId,
        tenantIds: selectedList,
        userName,
        startTime,
        durationMinutes: selectedDurationMins,
        notes
      });
      showToast(`Reserved [${selectedList.join(', ')}] on ${space ? space.displayName : state.claimSpaceId}!`, 'success');
    }

    closeClaimModal();
  } catch (err) {
    showToast(err.message || 'Operation failed', 'error');
  }
}

// Release all in space
async function quickReleaseSpace(spaceId, evt) {
  if (evt) evt.stopPropagation();
  const space = state.spaces.find(s => s.id === spaceId);
  if (!confirm(`Release and pop out all active tenants in ${space ? space.displayName : spaceId}?`)) return;

  window.soundEngine.playPopOut();
  try {
    const cachedUser = localStorage.getItem('tenant_user_name') || '';
    await window.apiClient.release({ spaceId, releaseAll: true, userName: cachedUser });
    showToast(`Released all tenants in ${space ? space.displayName : spaceId}!`, 'success');
  } catch (err) {
    showToast(err.message || 'Release failed', 'error');
  }
}

// =========================================================
// EDIT WHOLE SPACE BRANCHES MODAL
// =========================================================

function openEditSpaceBranchesModal(spaceId, evt) {
  if (evt) evt.stopPropagation();
  state.editingSpaceId = spaceId;
  const space = state.spaces.find(s => s.id === spaceId);
  if (!space) return;

  const branches = space.branches || {};

  document.getElementById('edit-space-branches-title').textContent = `Edit Branches: ${space.displayName}`;
  document.getElementById('edit-space-branches-subtitle').textContent = `All tenants in ${space.displayName} will use these branches`;

  document.getElementById('edit-branch-frontend').value = branches.frontend || '';
  document.getElementById('edit-branch-backend').value = branches.backend || '';
  document.getElementById('edit-branch-crm').value = branches.crm || '';

  const modal = document.getElementById('edit-space-branches-modal');
  modal.classList.add('open');
  document.getElementById('edit-branch-frontend').focus();
}

function openEditSpaceBranchesFromClaimModal() {
  openEditSpaceBranchesModal(state.claimSpaceId);
}

function closeEditSpaceBranchesModal() {
  const modal = document.getElementById('edit-space-branches-modal');
  modal.classList.remove('open');
  state.editingSpaceId = null;
}

function appendEditBranchField(fieldId, prefix) {
  const input = document.getElementById(fieldId);
  if (!input) return;
  if (!input.value.startsWith(prefix)) {
    input.value = prefix + input.value.replace(/^(feature\/|fix\/|bugfix\/|release\/|hotfix\/|crm\/)/, '');
  }
  input.focus();
}

async function submitEditSpaceBranches() {
  const spaceId = state.editingSpaceId;
  const space = state.spaces.find(s => s.id === spaceId);
  if (!space) return;

  const fe = document.getElementById('edit-branch-frontend').value.trim();
  const be = document.getElementById('edit-branch-backend').value.trim();
  const crm = document.getElementById('edit-branch-crm').value.trim();
  const branches = { frontend: fe, backend: be, crm: crm };

  const cachedUser = localStorage.getItem('tenant_user_name') || '';

  window.soundEngine.playChime();
  try {
    await window.apiClient.updateSpaceBranches(spaceId, branches, cachedUser);
    showToast(`Saved branches for ${space.displayName}!`, 'success');
    closeEditSpaceBranchesModal();
  } catch (err) {
    showToast(err.message || 'Save failed', 'error');
  }
}

// =========================================================
// DETAILS & ACTIONS MODAL
// =========================================================

function openDetailsModal(slotId) {
  state.selectedSlotId = slotId;
  const slot = state.slots[slotId];
  if (!slot) return;

  const modal = document.getElementById('details-modal');
  updateActiveModalDetails(slot);
  modal.classList.add('open');
}

function closeDetailsModal() {
  const modal = document.getElementById('details-modal');
  modal.classList.remove('open');
  state.selectedSlotId = null;
}

function updateActiveModalDetails(slot) {
  const occupant = slot.currentOccupant;
  const title = document.getElementById('details-modal-title');
  const spaceBadge = document.getElementById('details-modal-space');
  const detailsBody = document.getElementById('details-modal-content');

  title.textContent = `${slot.tenantName.toUpperCase()} Details`;
  spaceBadge.textContent = slot.spaceName;

  if (slot.status === 'occupied' && occupant) {
    const now = window.apiClient.now();
    const remainingMs = Math.max(0, occupant.endsAt - now);
    const space = state.spaces.find(s => s.id === slot.spaceId);
    const branches = occupant.branches || space?.branches || {};

    detailsBody.innerHTML = `
      <div style="background: rgba(244, 63, 94, 0.08); border: 1px solid rgba(244, 63, 94, 0.25); border-radius: 12px; padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <div class="user-avatar-circle" style="width: 36px; height: 36px; font-size: 1rem;">
              ${occupant.userName.charAt(0).toUpperCase()}
            </div>
            <div>
              <div style="font-weight: 700; font-size: 1rem; color: #fff;">${escapeHtml(occupant.userName)}</div>
              <div style="font-size: 0.75rem; color: var(--text-muted);">Occupying since ${formatTimeHM(occupant.startedAt)}</div>
            </div>
          </div>
          <span class="tenant-state-badge" style="background: rgba(244, 63, 94, 0.2); color: #fb7185;">IN USE</span>
        </div>

        <!-- Space Branches Applied to This Tenant -->
        <div style="display: flex; flex-direction: column; gap: 0.5rem; background: #0b0f19; border: 1px solid #1e283d; border-radius: 10px; padding: 0.85rem;">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span style="font-size: 0.75rem; color: var(--text-dim); font-weight: 700; text-transform: uppercase;">
              Space Branches Inherited (${slot.spaceName})
            </span>
            <button type="button" class="btn-edit-branches" onclick="closeDetailsModal(); openEditSpaceBranchesModal('${slot.spaceId}')">
              ${ICONS.edit} Edit Space Branches
            </button>
          </div>

          <div style="display: flex; flex-direction: column; gap: 0.35rem; font-family: var(--font-mono); font-size: 0.8125rem;">
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.25rem 0.5rem; background: rgba(6, 182, 212, 0.08); border-radius: 6px;">
              <span style="color: #38bdf8; font-weight: 700;">🌐 Frontend:</span>
              <span style="color: #fff;">${escapeHtml(branches.frontend || '—')}</span>
              ${branches.frontend ? `<button type="button" class="btn-icon" style="width: 24px; height: 24px;" onclick="copyGitCommand(event, '${escapeHtml(branches.frontend)}')" title="Copy checkout">${ICONS.copy}</button>` : ''}
            </div>

            <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.25rem 0.5rem; background: rgba(168, 85, 247, 0.08); border-radius: 6px;">
              <span style="color: #c084fc; font-weight: 700;">⚙️ Backend:</span>
              <span style="color: #fff;">${escapeHtml(branches.backend || '—')}</span>
              ${branches.backend ? `<button type="button" class="btn-icon" style="width: 24px; height: 24px;" onclick="copyGitCommand(event, '${escapeHtml(branches.backend)}')" title="Copy checkout">${ICONS.copy}</button>` : ''}
            </div>

            <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.25rem 0.5rem; background: rgba(245, 158, 11, 0.08); border-radius: 6px;">
              <span style="color: #fbbf24; font-weight: 700;">💼 CRM:</span>
              <span style="color: #fff;">${escapeHtml(branches.crm || '—')}</span>
              ${branches.crm ? `<button type="button" class="btn-icon" style="width: 24px; height: 24px;" onclick="copyGitCommand(event, '${escapeHtml(branches.crm)}')" title="Copy checkout">${ICONS.copy}</button>` : ''}
            </div>
          </div>
        </div>

        <div style="display: flex; align-items: center; justify-content: space-between; background: #0b0f19; border: 1px solid #1e283d; border-radius: 8px; padding: 0.75rem 1rem;">
          <div>
            <div style="font-size: 0.6875rem; color: var(--text-dim); text-transform: uppercase; font-weight: 700;">Remaining Time</div>
            <div id="modal-details-timer" style="font-family: var(--font-mono); font-size: 1.5rem; font-weight: 800; color: #f43f5e;">
              ${formatDuration(remainingMs)}
            </div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 0.6875rem; color: var(--text-dim); text-transform: uppercase; font-weight: 700;">Ends At</div>
            <div style="font-family: var(--font-mono); font-size: 0.9375rem; color: var(--text-main);">
              ${formatTimeHM(occupant.endsAt)}
            </div>
          </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 0.75rem;">
          <button type="button" class="btn-pop-out" style="padding: 0.75rem; font-size: 0.875rem;" onclick="releaseFromModal('${slot.id}')">
            ${ICONS.arrowUp} PUSH OUT (RELEASE TENANT NOW)
          </button>
          <div style="display: flex; gap: 0.5rem;">
            <button type="button" class="btn-header" style="flex: 1; justify-content: center;" onclick="extendFromModal('${slot.id}', 15)">+15 min</button>
            <button type="button" class="btn-header" style="flex: 1; justify-content: center;" onclick="extendFromModal('${slot.id}', 30)">+30 min</button>
            <button type="button" class="btn-header" style="flex: 1; justify-content: center;" onclick="extendFromModal('${slot.id}', 60)">+1 hour</button>
          </div>
        </div>
      </div>

      ${renderUpcomingReservationsSection(slot)}
    `;
  } else {
    detailsBody.innerHTML = `
      <div style="text-align: center; padding: 1.5rem 0;">
        <div style="font-size: 1rem; color: #34d399; font-weight: 700; margin-bottom: 0.5rem;">Tenant is Currently Free</div>
        <p style="font-size: 0.8125rem; color: var(--text-muted); margin-bottom: 1.25rem;">You can push this button in to occupy immediately, or reserve a scheduled slot below.</p>
        <button type="button" class="btn-primary btn-header" style="width: 100%; justify-content: center; padding: 0.75rem;" onclick="closeDetailsModal(); openClaimModalForSpace('${slot.spaceId}', '${slot.tenantId}');">
          PUSH IN & OCCUPY
        </button>
      </div>

      ${renderUpcomingReservationsSection(slot)}
    `;
  }
}

function renderUpcomingReservationsSection(slot) {
  const reservations = slot.reservations || [];
  return `
    <div style="display: flex; flex-direction: column; gap: 0.75rem; margin-top: 0.5rem;">
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <span style="font-size: 0.8125rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em;">
          Upcoming Reservations (${reservations.length})
        </span>
        <button type="button" class="btn-header" style="font-size: 0.75rem; padding: 0.3rem 0.6rem;" onclick="closeDetailsModal(); openClaimModalForSpace('${slot.spaceId}', '${slot.tenantId}'); setModalTab('reserve');">
          + Reserve Slot
        </button>
      </div>

      ${reservations.length === 0 
        ? `<div style="font-size: 0.75rem; color: var(--text-dim); text-align: center; padding: 0.75rem; background: #0b0f19; border-radius: 8px;">No scheduled reservations. Available to reserve anytime.</div>`
        : reservations.map(r => {
            const isMine = window.apiClient.isMyIp(r.creatorIp);
            const branchText = r.branches ? [r.branches.frontend && `FE: ${r.branches.frontend}`, r.branches.backend && `BE: ${r.branches.backend}`, r.branches.crm && `CRM: ${r.branches.crm}`].filter(Boolean).join(' • ') : '';

            return `
            <div style="background: #0b0f19; border: 1px solid var(--border-subtle); border-radius: 8px; padding: 0.65rem 0.85rem; display: flex; align-items: center; justify-content: space-between; font-size: 0.8125rem; gap: 0.5rem;">
              <div style="flex: 1; min-width: 0;">
                <div style="display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.2rem; flex-wrap: wrap;">
                  <span style="font-weight: 600; color: #fff;">${escapeHtml(r.userName)}</span>
                  ${isMine 
                    ? `<span class="res-owner-badge mine">✨ Yours</span>` 
                    : `<span class="res-owner-badge other" title="Created by IP ${escapeHtml(r.creatorIp || 'other')}">🔒 ${escapeHtml(r.creatorIp || 'Other User')}</span>`
                  }
                </div>
                <div style="font-size: 0.6875rem; color: var(--text-muted);">${formatDateMD(r.startTime)} at ${formatTimeHM(r.startTime)} - ${formatTimeHM(r.endTime)} (${r.durationMinutes}m)</div>
                ${branchText ? `<div style="font-size: 0.6875rem; color: #38bdf8; margin-top: 0.15rem; font-family: var(--font-mono);">${escapeHtml(branchText)}</div>` : ''}
              </div>

              <div style="display: flex; align-items: center; gap: 0.35rem; flex-shrink: 0;">
                ${isMine ? `
                  <button type="button" class="btn-icon" style="width: 28px; height: 28px; color: #38bdf8;" onclick="openEditReservationModal('${slot.id}', '${r.id}')" title="Edit your reservation">
                    ${ICONS.pencil}
                  </button>
                  <button type="button" class="btn-icon" style="width: 28px; height: 28px; color: #f87171;" onclick="cancelReservation('${slot.id}', '${r.id}')" title="Cancel your reservation">
                    ${ICONS.trash}
                  </button>
                ` : `
                  <button type="button" class="btn-icon disabled" style="width: 28px; height: 28px;" title="Reserved by IP ${escapeHtml(r.creatorIp || 'other')}. Only the creator can change this reservation.">
                    🔒
                  </button>
                `}
              </div>
            </div>
          `;
        }).join('')
      }
    </div>
  `;
}

async function quickRelease(slotId, evt) {
  if (evt) evt.stopPropagation();
  window.soundEngine.playPopOut();
  try {
    const cachedUser = localStorage.getItem('tenant_user_name') || '';
    await window.apiClient.release({ slotId, userName: cachedUser });
    showToast('Tenant released and popped out!', 'success');
  } catch (err) {
    showToast(err.message || 'Release failed', 'error');
  }
}

async function releaseFromModal(slotId) {
  window.soundEngine.playPopOut();
  try {
    const cachedUser = localStorage.getItem('tenant_user_name') || '';
    await window.apiClient.release({ slotId, userName: cachedUser });
    showToast('Tenant released and popped out!', 'success');
    closeDetailsModal();
  } catch (err) {
    showToast(err.message || 'Release failed', 'error');
  }
}

async function quickExtend(slotId, mins, evt) {
  if (evt) evt.stopPropagation();
  window.soundEngine.playChime();
  try {
    await window.apiClient.extend(slotId, mins);
    showToast(`Extended by +${mins} minutes!`, 'success');
  } catch (err) {
    showToast(err.message || 'Extend failed', 'error');
  }
}

async function extendFromModal(slotId, mins) {
  window.soundEngine.playChime();
  try {
    await window.apiClient.extend(slotId, mins);
    showToast(`Extended by +${mins} minutes!`, 'success');
  } catch (err) {
    showToast(err.message || 'Extend failed', 'error');
  }
}

async function cancelReservation(slotId, reservationId) {
  const slot = state.slots[slotId];
  const res = (slot?.reservations || []).find(r => r.id === reservationId);
  if (res && res.creatorIp && !window.apiClient.isMyIp(res.creatorIp)) {
    showToast(`You can only cancel your own reservation (Created by IP: ${res.creatorIp})`, 'error');
    return;
  }

  if (!confirm('Are you sure you want to cancel this reservation?')) return;
  try {
    await window.apiClient.cancelReservation(slotId, reservationId);
    showToast('Reservation cancelled', 'info');
  } catch (err) {
    showToast(err.message || 'Cancel failed', 'error');
  }
}

// --- EDIT RESERVATION MODAL (USER'S OWN RESERVATION VIA IP) ---
function openEditReservationModal(slotId, reservationId) {
  const slot = state.slots[slotId];
  if (!slot) return;
  const res = (slot.reservations || []).find(r => r.id === reservationId);
  if (!res) return;

  // Check IP permission
  if (res.creatorIp && !window.apiClient.isMyIp(res.creatorIp)) {
    showToast(`You can only edit your own reservations (Created by IP: ${res.creatorIp})`, 'error');
    return;
  }

  const slotIdInput = document.getElementById('edit-res-slot-id');
  const resIdInput = document.getElementById('edit-res-id');
  const ownerIpEl = document.getElementById('edit-res-owner-ip');
  const titleEl = document.getElementById('edit-res-modal-title');
  const subtitleEl = document.getElementById('edit-res-modal-subtitle');

  if (slotIdInput) slotIdInput.value = slotId;
  if (resIdInput) resIdInput.value = reservationId;
  if (ownerIpEl) ownerIpEl.textContent = res.creatorIp || window.apiClient.getClientIp();
  if (titleEl) titleEl.textContent = `Edit Reservation: ${slot.tenantName}`;
  if (subtitleEl) subtitleEl.textContent = `Space: ${slot.spaceName} • Verified Owner IP: ${res.creatorIp || window.apiClient.getClientIp()}`;

  const userEl = document.getElementById('edit-res-user');
  if (userEl) userEl.value = res.userName || '';

  const timeEl = document.getElementById('edit-res-time');
  if (timeEl) {
    const d = new Date(res.startTime);
    timeEl.value = formatDateTimeLocal(d);
  }

  const durEl = document.getElementById('edit-res-duration');
  if (durEl) {
    durEl.value = String(res.durationMinutes || 30);
  }

  const branches = res.branches || {};
  const feEl = document.getElementById('edit-res-branch-fe');
  const beEl = document.getElementById('edit-res-branch-be');
  const crmEl = document.getElementById('edit-res-branch-crm');
  const notesEl = document.getElementById('edit-res-notes');

  if (feEl) feEl.value = branches.frontend || '';
  if (beEl) beEl.value = branches.backend || '';
  if (crmEl) crmEl.value = branches.crm || '';
  if (notesEl) notesEl.value = res.notes || '';

  const banner = document.getElementById('edit-res-conflict-banner');
  if (banner) banner.style.display = 'none';

  const modal = document.getElementById('edit-reservation-modal');
  if (modal) modal.classList.add('open');
}

function closeEditReservationModal() {
  const modal = document.getElementById('edit-reservation-modal');
  if (modal) modal.classList.remove('open');
}

async function handleEditReservationConflictCheck() {
  const slotId = document.getElementById('edit-res-slot-id')?.value;
  const resId = document.getElementById('edit-res-id')?.value;
  const slot = state.slots[slotId];
  if (!slot) return;

  const timeVal = document.getElementById('edit-res-time')?.value;
  const durVal = parseInt(document.getElementById('edit-res-duration')?.value, 10) || 30;
  const submitBtn = document.getElementById('edit-res-submit-btn');
  const banner = document.getElementById('edit-res-conflict-banner');
  const msgEl = document.getElementById('edit-res-conflict-message');

  if (!timeVal) return;
  const startTimeMs = new Date(timeVal).getTime();
  if (isNaN(startTimeMs) || startTimeMs < Date.now() - 60000) {
    if (banner && msgEl) {
      banner.style.display = 'block';
      msgEl.textContent = 'Start time must be in the future';
    }
    if (submitBtn) submitBtn.disabled = true;
    return;
  }

  try {
    const check = await window.apiClient.checkConflicts(slot.spaceId, [slot.tenantId], new Date(startTimeMs).toISOString(), durVal, resId);
    if (check.hasConflict) {
      if (banner && msgEl) {
        banner.style.display = 'block';
        msgEl.textContent = check.conflicts.map(c => c.message).join(' | ');
      }
      if (submitBtn) submitBtn.disabled = true;
    } else {
      if (banner) banner.style.display = 'none';
      if (submitBtn) submitBtn.disabled = false;
    }
  } catch (err) {
    console.error('Conflict check error:', err);
  }
}

async function submitEditReservationForm() {
  const slotId = document.getElementById('edit-res-slot-id')?.value;
  const reservationId = document.getElementById('edit-res-id')?.value;
  const userName = document.getElementById('edit-res-user')?.value?.trim();
  const timeVal = document.getElementById('edit-res-time')?.value;
  const durationMinutes = parseInt(document.getElementById('edit-res-duration')?.value, 10) || 30;
  const frontend = document.getElementById('edit-res-branch-fe')?.value?.trim() || '';
  const backend = document.getElementById('edit-res-branch-be')?.value?.trim() || '';
  const crm = document.getElementById('edit-res-branch-crm')?.value?.trim() || '';
  const notes = document.getElementById('edit-res-notes')?.value?.trim() || '';

  if (!userName) {
    showToast('Please enter your name', 'error');
    return;
  }
  if (!timeVal) {
    showToast('Please pick a start date and time', 'error');
    return;
  }

  const startTime = new Date(timeVal).toISOString();

  try {
    await window.apiClient.updateReservation({
      slotId,
      reservationId,
      userName,
      startTime,
      durationMinutes,
      branches: { frontend, backend, crm },
      notes
    });

    window.soundEngine.playSuccess();
    showToast('Reservation updated successfully!', 'success');
    closeEditReservationModal();
  } catch (err) {
    window.soundEngine.playError();
    showToast(err.message || 'Failed to update reservation', 'error');
  }
}

function copyGitCommand(evt, branchName) {
  if (evt) evt.stopPropagation();
  if (!branchName) return;
  const cmd = `git checkout ${branchName}`;
  navigator.clipboard.writeText(cmd).then(() => {
    showToast(`Copied: ${cmd}`, 'info');
  }).catch(() => {
    prompt('Copy branch command:', cmd);
  });
}

function toggleHistoryDrawer() {
  const drawer = document.getElementById('history-drawer');
  drawer.classList.toggle('open');
}

function renderHistoryDrawer() {
  const list = document.getElementById('history-list');
  if (!list) return;

  if (!state.history || state.history.length === 0) {
    list.innerHTML = `<div style="text-align: center; color: var(--text-dim); padding: 2rem;">No activity recorded yet</div>`;
    return;
  }

  list.innerHTML = state.history.map(item => {
    let badgeClass = 'badge-occupy';
    if (item.action === 'RELEASE') badgeClass = 'badge-release';
    else if (item.action === 'RESERVE') badgeClass = 'badge-reserve';
    else if (item.action === 'EXPIRE') badgeClass = 'badge-expire';
    else if (item.action === 'EXTEND') badgeClass = 'badge-extend';
    else if (item.action === 'UPDATE_BRANCHES') badgeClass = 'badge-extend';

    return `
      <div class="history-item">
        <div class="history-top">
          <span class="history-action-badge ${badgeClass}">${item.action}</span>
          <span class="history-time">${formatTimeAgo(item.timestamp)}</span>
        </div>
        <div class="history-msg">${escapeHtml(item.message || `${item.userName} performed ${item.action}`)}</div>
      </div>
    `;
  }).join('');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  let icon = ICONS.check;
  if (type === 'error') icon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
  else if (type === 'warning') icon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;

  toast.innerHTML = `<span class="toast-icon">${icon}</span><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-out');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 200);
  }, 3500);
}

function setupEventListeners() {
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      renderGrid();
    });
  }

  const filterBtns = document.querySelectorAll('.filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.filterTenant = btn.getAttribute('data-filter') || 'all';
      renderGrid();
    });
  });

  const soundBtn = document.getElementById('sound-toggle-btn');
  if (soundBtn) {
    soundBtn.addEventListener('click', () => {
      const enabled = window.soundEngine.toggle();
      updateSoundButtonUI();
      showToast(enabled ? 'Sound effects enabled' : 'Sound effects muted', 'info');
    });
  }

  const seedBtn = document.getElementById('seed-demo-btn');
  if (seedBtn) {
    seedBtn.addEventListener('click', async () => {
      try {
        await window.apiClient.seedDemo();
        showToast('Demo data seeded with space branches!', 'success');
      } catch (e) {
        showToast('Could not seed demo data', 'error');
      }
    });
  }

  const resetBtn = document.getElementById('reset-all-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      if (confirm('Reset all tenants back to available?')) {
        try {
          await window.apiClient.resetAll();
          showToast('All slots reset to free', 'info');
        } catch (e) {
          showToast('Reset failed', 'error');
        }
      }
    });
  }
}

function updateSoundButtonUI() {
  const btn = document.getElementById('sound-toggle-btn');
  if (!btn) return;
  const isEnabled = window.soundEngine.enabled;
  btn.innerHTML = isEnabled 
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`;
  btn.title = isEnabled ? 'Mute sound effects' : 'Enable sound effects';
}

function promptReserveAnySlot() {
  const currentSpace = state.spaces[0] || { id: 'stage_sekkat' };
  openClaimModalForSpace(currentSpace.id);
}

function formatDuration(ms) {
  if (ms <= 0) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const pad = (n) => String(n).padStart(2, '0');

  if (hours > 0) return `${hours}h ${pad(mins)}m ${pad(secs)}s`;
  return `${pad(mins)}m ${pad(secs)}s`;
}

function formatTimeHM(timestamp) {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateMD(timestamp) {
  const d = new Date(timestamp);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatDateTimeLocal(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${y}-${m}-${d}T${h}:${min}`;
}

function formatTimeAgo(timestamp) {
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 45) return 'just now';
  if (diffSec < 90) return '1 min ago';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} mins ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} hours ago`;
  return `${Math.floor(diffSec / 86400)} days ago`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
