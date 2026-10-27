import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const IS_VERCEL = !!process.env.VERCEL;
const DATA_DIR = IS_VERCEL ? '/tmp' : path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'tenants.json');
const SEED_DATA_FILE = path.join(__dirname, 'data', 'tenants.json');
const ONE_DAY_MS = 24 * 60 * 60 * 1000; // 24-hour retention window (prune logs older than 1 day)

// IP Normalization & Extraction Helpers
export function normalizeIp(ip) {
  if (!ip) return '127.0.0.1';
  let clean = String(ip).trim();
  if (clean.startsWith('::ffff:')) {
    clean = clean.substring(7);
  }
  if (clean === '::1' || clean === 'localhost') {
    clean = '127.0.0.1';
  }
  return clean;
}

export function getClientIp(req) {
  if (!req) return '127.0.0.1';
  let ip = '';
  const forwarded = req.headers ? (req.headers['x-forwarded-for'] || req.headers['x-vercel-forwarded-for']) : null;
  if (forwarded) {
    ip = String(forwarded).split(',')[0].trim();
  }
  if (!ip && req.headers && req.headers['x-real-ip']) {
    ip = String(req.headers['x-real-ip']).trim();
  }
  if (!ip) {
    ip = req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || '127.0.0.1';
  }
  return normalizeIp(ip);
}

export function canModifyItem(creatorIp, requesterIp) {
  if (!creatorIp) return true; // Legacy/demo entries without IP can be modified
  return normalizeIp(creatorIp) === normalizeIp(requesterIp);
}

// Helper to check interval overlap between [startA, endA] and [startB, endB]
export function hasIntervalOverlap(startA, endA, startB, endB) {
  return Math.max(startA, startB) < Math.min(endA, endB);
}

// Find any conflict for a proposed slot window [start, end]
export function checkSlotConflict(slot, start, end, ignoreReservationId = null) {
  const now = Date.now();

  // 1. Conflict with active occupant
  if (slot.status === 'occupied' && slot.currentOccupant) {
    const occEnd = slot.currentOccupant.endsAt;
    const occStart = slot.currentOccupant.startedAt;
    if (occEnd > start && occEnd > now && hasIntervalOverlap(start, end, occStart, occEnd)) {
      const endStr = new Date(occEnd).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return {
        type: 'CURRENT_OCCUPANT',
        tenantName: slot.tenantName,
        userName: slot.currentOccupant.userName,
        endsAt: occEnd,
        message: `Tenant '${slot.tenantName}' is currently occupied by ${slot.currentOccupant.userName} until ${endStr}`
      };
    }
  }

  // 2. Conflict with existing scheduled reservations
  const reservations = slot.reservations || [];
  for (const r of reservations) {
    if (ignoreReservationId && r.id === ignoreReservationId) continue;
    if (hasIntervalOverlap(start, end, r.startTime, r.endTime)) {
      const startStr = new Date(r.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const endStr = new Date(r.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return {
        type: 'RESERVATION',
        tenantName: slot.tenantName,
        userName: r.userName,
        startTime: r.startTime,
        endTime: r.endTime,
        message: `Tenant '${slot.tenantName}' conflicts with existing reservation by ${r.userName} (${startStr} - ${endStr})`
      };
    }
  }

  return null;
}

// Definition of 3 Spaces with Space-Level Branches
export const DEFAULT_SPACES = [
  {
    id: 'stage_sekkat',
    name: 'stage sekkat',
    displayName: 'Stage Sekkat',
    badge: 'Stage',
    accentColor: '#06b6d4',
    description: 'Sekkat staging environment for pre-flight testing',
    branches: {
      frontend: 'feature/checkout-v2',
      backend: 'feature/order-api-v2',
      crm: 'feature/crm-sync-webhook'
    }
  },
  {
    id: 'preprod_talarey',
    name: 'pre-prod talarey',
    displayName: 'Pre-prod Talarey',
    badge: 'Pre-prod',
    accentColor: '#a855f7',
    description: 'Talarey environment for final release candidates',
    branches: {
      frontend: 'release/v3.4.0-rc',
      backend: 'release/v3.4.0-backend',
      crm: ''
    }
  },
  {
    id: 'beta',
    name: 'beta',
    displayName: 'Beta',
    badge: 'Beta',
    accentColor: '#f59e0b',
    description: 'Beta environment for bleeding-edge experiments',
    branches: {
      frontend: '',
      backend: 'bugfix/auth-token-refresh',
      crm: 'bugfix/salesforce-lead-dup'
    }
  }
];

export const TENANTS = [
  { id: 'ali', name: 'ali', displayName: 'ali' },
  { id: 'demo', name: 'demo', displayName: 'demo' },
  { id: 'demo1', name: 'demo1', displayName: 'demo1' }
];

export function normalizeBranches(branchesInput) {
  let fe = '';
  let be = '';
  let crm = '';

  if (branchesInput && typeof branchesInput === 'object') {
    fe = (branchesInput.frontend || '').trim();
    be = (branchesInput.backend || '').trim();
    crm = (branchesInput.crm || '').trim();
  }

  const parts = [];
  if (fe) parts.push(`FE: ${fe}`);
  if (be) parts.push(`BE: ${be}`);
  if (crm) parts.push(`CRM: ${crm}`);
  const summary = parts.length > 0 ? parts.join(' • ') : 'main';

  return {
    branches: { frontend: fe, backend: be, crm: crm },
    branchName: summary
  };
}

// Generate fresh default state
function createInitialState() {
  const spaces = JSON.parse(JSON.stringify(DEFAULT_SPACES));
  const slots = {};

  for (const space of spaces) {
    for (const tenant of TENANTS) {
      const slotId = `${space.id}:${tenant.id}`;
      slots[slotId] = {
        id: slotId,
        spaceId: space.id,
        spaceName: space.displayName,
        tenantId: tenant.id,
        tenantName: tenant.displayName,
        status: 'free',
        currentOccupant: null,
        reservations: []
      };
    }
  }

  return {
    spaces,
    tenants: TENANTS,
    slots,
    history: []
  };
}

// In-memory state
let appState = createInitialState();

// Save state to disk atomically
function saveState() {
  try {
    const dataDir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const tempFile = `${DATA_FILE}.tmp.${Date.now()}`;
    fs.writeFileSync(tempFile, JSON.stringify(appState, null, 2), 'utf-8');
    fs.renameSync(tempFile, DATA_FILE);
  } catch (err) {
    console.error('Error saving state to disk:', err);
  }
}

// Load state from disk
function loadState() {
  try {
    // If running in Vercel environment and /tmp/tenants.json does not exist yet,
    // seed from committed data/tenants.json if available
    if (IS_VERCEL && !fs.existsSync(DATA_FILE) && fs.existsSync(SEED_DATA_FILE)) {
      try {
        if (!fs.existsSync(DATA_DIR)) {
          fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        fs.copyFileSync(SEED_DATA_FILE, DATA_FILE);
        console.log('Seeded state to /tmp from data/tenants.json');
      } catch (copyErr) {
        console.warn('Could not copy seed data to /tmp:', copyErr.message);
      }
    }

    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      const defaultState = createInitialState();

      // Ensure each space has valid branches object
      const loadedSpaces = (parsed.spaces || defaultState.spaces).map(sp => {
        const def = defaultState.spaces.find(d => d.id === sp.id) || {};
        return {
          ...def,
          ...sp,
          branches: normalizeBranches(sp.branches || def.branches).branches
        };
      });

      // Prune logs older than 24 hours (1 day)
      const cutoff = Date.now() - ONE_DAY_MS;
      const filteredHistory = (parsed.history || []).filter(item => item.timestamp && item.timestamp >= cutoff);

      appState = {
        spaces: loadedSpaces,
        tenants: TENANTS,
        slots: { ...defaultState.slots, ...(parsed.slots || {}) },
        history: filteredHistory
      };

      // Ensure slots structure
      for (const key of Object.keys(defaultState.slots)) {
        if (!appState.slots[key]) {
          appState.slots[key] = defaultState.slots[key];
        } else {
          const slot = appState.slots[key];
          if (!Array.isArray(slot.reservations)) {
            slot.reservations = [];
          }
        }
      }
      console.log('State loaded successfully from', DATA_FILE);
    } else {
      console.log('No existing state file found. Initializing fresh state.');
      saveState();
    }
  } catch (err) {
    console.error('Error loading state from disk, using default:', err);
    appState = createInitialState();
  }
}

loadState();

// Express app setup
const app = express();
app.set('trust proxy', true);
app.use(express.json());

// Normalization middleware for Vercel / serverless rewrites
app.use((req, res, next) => {
  // Always evaluate expired timers on incoming requests (essential for serverless lifecycle)
  try { processSlotTimers(); } catch (e) {}

  if (!req.url.startsWith('/api') && !req.url.startsWith('/css') && !req.url.startsWith('/js') && !req.url.startsWith('/sound') && !req.url.startsWith('/favicon') && req.url !== '/' && req.url !== '/index.html') {
    const apiEndpoints = ['/state', '/space-branches', '/occupy', '/release', '/extend', '/reserve', '/check-conflicts', '/history', '/reset', '/seed-demo', '/health', '/me'];
    const matched = apiEndpoints.find(p => req.url === p || req.url.startsWith(p + '/') || req.url.startsWith(p + '?'));
    if (matched) {
      req.url = '/api' + req.url;
    }
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// HTTP and WebSocket server
const server = createServer(app);
const wss = new WebSocketServer({ server });

function broadcast(type, payload) {
  const message = JSON.stringify({
    type,
    payload,
    timestamp: Date.now()
  });

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
      } catch (err) {
        console.error('WebSocket send error:', err);
      }
    }
  });
}

function broadcastStateUpdate() {
  broadcast('STATE_UPDATE', {
    spaces: appState.spaces,
    slots: appState.slots,
    history: appState.history.slice(0, 50),
    serverTime: Date.now()
  });
}

// Filter out any history logs older than 24 hours (1 day)
function pruneOldHistory() {
  const cutoff = Date.now() - ONE_DAY_MS;
  const initialLength = (appState.history || []).length;
  appState.history = (appState.history || []).filter(item => item.timestamp && item.timestamp >= cutoff);
  return appState.history.length !== initialLength;
}

function addHistoryEntry(action, spaceName, tenantName, details) {
  const entry = {
    id: crypto.randomUUID(),
    action,
    slotId: details.slotId || '',
    spaceName,
    tenantName,
    userName: details.userName || 'Anonymous',
    branchName: details.branchName || '',
    branches: details.branches || null,
    durationMinutes: details.durationMinutes || 0,
    timestamp: Date.now(),
    message: details.message || ''
  };

  appState.history.unshift(entry);
  pruneOldHistory();
}

// Process expired occupants and promote scheduled reservations
function processSlotTimers() {
  const now = Date.now();
  let stateChanged = false;

  // Continuously prune logs older than 1 day
  if (pruneOldHistory()) {
    stateChanged = true;
  }

  for (const slotId of Object.keys(appState.slots)) {
    const slot = appState.slots[slotId];

    if (slot.status === 'occupied' && slot.currentOccupant) {
      if (now >= slot.currentOccupant.endsAt) {
        const exp = slot.currentOccupant;
        addHistoryEntry('EXPIRE', slot.spaceName, slot.tenantName, {
          userName: exp.userName,
          message: `Time expired for ${exp.userName} on ${slot.tenantName} (${slot.spaceName})`
        });
        slot.status = 'free';
        slot.currentOccupant = null;
        stateChanged = true;
      }
    }

    if (slot.status === 'free' && slot.reservations && slot.reservations.length > 0) {
      const dueIndex = slot.reservations.findIndex(r => now >= r.startTime && now < r.endTime);
      if (dueIndex !== -1) {
        const [due] = slot.reservations.splice(dueIndex, 1);
        slot.status = 'occupied';
        slot.currentOccupant = {
          id: due.id,
          userName: due.userName,
          branches: due.branches,
          startedAt: due.startTime,
          endsAt: due.endTime,
          totalDurationMs: due.endTime - due.startTime,
          notes: due.notes || ''
        };
        addHistoryEntry('OCCUPY', slot.spaceName, slot.tenantName, {
          userName: due.userName,
          branches: due.branches,
          message: `Scheduled reservation auto-activated for ${due.userName} on ${slot.tenantName} (${slot.spaceName})`
        });
        stateChanged = true;
      } else {
        const countBefore = slot.reservations.length;
        slot.reservations = slot.reservations.filter(r => r.endTime > now);
        if (slot.reservations.length !== countBefore) {
          stateChanged = true;
        }
      }
    }
  }

  if (stateChanged) {
    saveState();
    broadcastStateUpdate();
  }
}

const slotTimer = setInterval(processSlotTimers, 1000);
if (slotTimer && typeof slotTimer.unref === 'function') {
  slotTimer.unref();
}

wss.on('connection', (ws, req) => {
  ws.clientIp = getClientIp(req);
  ws.send(JSON.stringify({
    type: 'INIT',
    payload: {
      spaces: appState.spaces,
      tenants: appState.tenants,
      slots: appState.slots,
      history: appState.history.slice(0, 50),
      serverTime: Date.now(),
      clientIp: ws.clientIp
    }
  }));

  ws.on('message', (messageText) => {
    try {
      const data = JSON.parse(messageText);
      handleClientAction(data.action, { ...data.payload, clientIp: ws.clientIp });
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
      ws.send(JSON.stringify({ type: 'ERROR', message: err.message || 'Invalid payload' }));
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});

// Central action dispatcher
function handleClientAction(action, payload) {
  const now = Date.now();

  switch (action) {
    // --- 1. EDIT WHOLE SPACE BRANCHES ---
    case 'UPDATE_SPACE_BRANCHES': {
      const { spaceId, branches, userName } = payload;
      const space = appState.spaces.find(s => s.id === spaceId);
      if (!space) throw new Error('Space not found');

      const norm = normalizeBranches(branches);
      space.branches = norm.branches;

      // Update any active occupants in this space to inherit the new branches
      const spaceSlots = Object.values(appState.slots).filter(s => s.spaceId === spaceId);
      for (const slot of spaceSlots) {
        if (slot.currentOccupant) {
          slot.currentOccupant.branches = norm.branches;
        }
      }

      addHistoryEntry('UPDATE_BRANCHES', space.displayName, 'Whole Space', {
        userName: userName || 'User',
        branches: norm.branches,
        message: `${userName || 'User'} updated branches for ${space.displayName} [${norm.branchName}]`
      });

      saveState();
      broadcastStateUpdate();
      return { success: true, space };
    }

    // --- 2. OCCUPY CHOSEN TENANTS IN A SPACE ---
    case 'OCCUPY': {
      const { spaceId, tenantIds, slotId, userName, durationMinutes, notes } = payload;
      const clientIp = payload.clientIp || '127.0.0.1';

      let targetSpaceId = spaceId;
      let targetTenants = tenantIds || [];

      if (!targetSpaceId && slotId) {
        const slot = appState.slots[slotId];
        if (slot) {
          targetSpaceId = slot.spaceId;
          targetTenants = [slot.tenantId];
        }
      }

      const space = appState.spaces.find(s => s.id === targetSpaceId);
      if (!space) throw new Error('Target space not found');

      if (!Array.isArray(targetTenants) || targetTenants.length === 0) {
        throw new Error('Please select at least one tenant to occupy');
      }

      const durMins = Math.max(1, parseInt(durationMinutes, 10) || 30);
      const totalDurationMs = durMins * 60 * 1000;
      const endsAt = now + totalDurationMs;
      const user = (userName || 'Anonymous').trim();

      // PASS 1: ATOMIC VALIDATION — Verify ALL selected tenants for any conflicts
      for (const tId of targetTenants) {
        const sId = `${space.id}:${tId}`;
        const slot = appState.slots[sId];
        if (!slot) continue;

        if (slot.status === 'occupied') {
          throw new Error(`Tenant '${slot.tenantName}' is already occupied by ${slot.currentOccupant?.userName || 'another user'}!`);
        }

        const conflict = checkSlotConflict(slot, now, endsAt);
        if (conflict) {
          throw new Error(conflict.message);
        }
      }

      // PASS 2: Apply occupancy atomically
      const occupiedSlots = [];
      for (const tId of targetTenants) {
        const sId = `${space.id}:${tId}`;
        const slot = appState.slots[sId];
        if (!slot) continue;

        slot.status = 'occupied';
        slot.currentOccupant = {
          id: crypto.randomUUID(),
          userName: user,
          creatorIp: clientIp,
          branches: { ...space.branches },
          startedAt: now,
          endsAt,
          totalDurationMs,
          notes: (notes || '').trim()
        };
        occupiedSlots.push(slot);
      }

      addHistoryEntry('OCCUPY', space.displayName, occupiedSlots.map(s => s.tenantName).join(', '), {
        userName: user,
        creatorIp: clientIp,
        durationMinutes: durMins,
        branches: space.branches,
        message: `${user} (${clientIp}) pushed in [${occupiedSlots.map(s => s.tenantName).join(', ')}] on ${space.displayName} for ${durMins}m`
      });

      saveState();
      broadcastStateUpdate();
      return { success: true, count: occupiedSlots.length };
    }

    // --- 3. RESERVE CHOSEN TENANTS IN A SPACE FOR FUTURE TIME ---
    case 'RESERVE': {
      const { spaceId, tenantIds, slotId, userName, startTime, durationMinutes, notes } = payload;
      const clientIp = payload.clientIp || '127.0.0.1';

      let targetSpaceId = spaceId;
      let targetTenants = tenantIds || [];

      if (!targetSpaceId && slotId) {
        const slot = appState.slots[slotId];
        if (slot) {
          targetSpaceId = slot.spaceId;
          targetTenants = [slot.tenantId];
        }
      }

      const space = appState.spaces.find(s => s.id === targetSpaceId);
      if (!space) throw new Error('Target space not found');

      if (!Array.isArray(targetTenants) || targetTenants.length === 0) {
        throw new Error('Please select at least one tenant to reserve');
      }

      const start = new Date(startTime).getTime();
      if (isNaN(start) || start < now - 60000) {
        throw new Error('Start time must be in the future');
      }

      const durMins = Math.max(5, parseInt(durationMinutes, 10) || 30);
      const end = start + (durMins * 60 * 1000);
      const user = (userName || 'Anonymous').trim();

      // PASS 1: ATOMIC CONFLICT VALIDATION — Check ALL chosen slots first!
      for (const tId of targetTenants) {
        const sId = `${space.id}:${tId}`;
        const slot = appState.slots[sId];
        if (!slot) continue;

        const conflict = checkSlotConflict(slot, start, end);
        if (conflict) {
          throw new Error(conflict.message);
        }
      }

      // PASS 2: All slots validated. Apply reservations atomically.
      const reservedSlots = [];
      for (const tId of targetTenants) {
        const sId = `${space.id}:${tId}`;
        const slot = appState.slots[sId];
        if (!slot) continue;

        if (!slot.reservations) slot.reservations = [];
        slot.reservations.push({
          id: crypto.randomUUID(),
          userName: user,
          creatorIp: clientIp,
          branches: { ...space.branches },
          startTime: start,
          endTime: end,
          durationMinutes: durMins,
          notes: (notes || '').trim(),
          createdAt: now
        });
        slot.reservations.sort((a, b) => a.startTime - b.startTime);
        reservedSlots.push(slot);
      }

      addHistoryEntry('RESERVE', space.displayName, reservedSlots.map(s => s.tenantName).join(', '), {
        userName: user,
        creatorIp: clientIp,
        durationMinutes: durMins,
        branches: space.branches,
        message: `${user} (${clientIp}) reserved [${reservedSlots.map(s => s.tenantName).join(', ')}] on ${space.displayName} for ${new Date(start).toLocaleTimeString()} (${durMins}m)`
      });

      saveState();
      broadcastStateUpdate();
      return { success: true, count: reservedSlots.length };
    }

    // --- 4. UPDATE EXISTING RESERVATION (OWNER BY IP ONLY) ---
    case 'UPDATE_RESERVATION': {
      const { slotId, reservationId, userName, startTime, durationMinutes, branches, notes } = payload;
      const clientIp = payload.clientIp || '127.0.0.1';

      const slot = appState.slots[slotId];
      if (!slot) throw new Error('Slot not found');

      const reservation = (slot.reservations || []).find(r => r.id === reservationId);
      if (!reservation) throw new Error('Reservation not found');

      // IP verification: only creator can edit
      if (reservation.creatorIp && !canModifyItem(reservation.creatorIp, clientIp)) {
        throw new Error(`Permission denied: Only the creator (IP: ${reservation.creatorIp}) can edit this reservation. Your IP: ${clientIp}`);
      }

      const start = new Date(startTime).getTime();
      if (isNaN(start) || start < now - 60000) {
        throw new Error('Start time must be in the future');
      }

      const durMins = Math.max(5, parseInt(durationMinutes, 10) || 30);
      const end = start + (durMins * 60 * 1000);

      // Conflict validation excluding the reservation itself
      const conflict = checkSlotConflict(slot, start, end, reservation.id);
      if (conflict) {
        throw new Error(conflict.message);
      }

      if (userName && userName.trim()) reservation.userName = userName.trim();
      reservation.startTime = start;
      reservation.endTime = end;
      reservation.durationMinutes = durMins;
      if (branches) {
        reservation.branches = normalizeBranches(branches).branches;
      }
      if (notes !== undefined) {
        reservation.notes = (notes || '').trim();
      }
      reservation.updatedAt = now;
      slot.reservations.sort((a, b) => a.startTime - b.startTime);

      addHistoryEntry('UPDATE_RESERVE', slot.spaceName, slot.tenantName, {
        userName: reservation.userName,
        creatorIp: clientIp,
        durationMinutes: durMins,
        branches: reservation.branches,
        message: `${reservation.userName} (${clientIp}) updated reservation for ${slot.tenantName} on ${slot.spaceName} to ${new Date(start).toLocaleTimeString()} (${durMins}m)`
      });

      saveState();
      broadcastStateUpdate();
      return { success: true, slot, reservation };
    }

    // --- 5. RELEASE (SINGLE SLOT OR ALL IN SPACE) ---
    case 'RELEASE': {
      const { slotId, spaceId, releaseAll, userName } = payload;
      const clientIp = payload.clientIp || '127.0.0.1';

      if (releaseAll && spaceId) {
        const space = appState.spaces.find(s => s.id === spaceId);
        const spaceSlots = Object.values(appState.slots).filter(s => s.spaceId === spaceId && s.status === 'occupied');

        // Only release slots that belong to this IP (or unassigned)
        const slotsToRelease = spaceSlots.filter(s => canModifyItem(s.currentOccupant?.creatorIp, clientIp));
        if (slotsToRelease.length === 0 && spaceSlots.length > 0) {
          throw new Error(`Permission denied: Active tenants in this space were occupied by other IP addresses. Your IP: ${clientIp}`);
        }

        for (const slot of slotsToRelease) {
          slot.status = 'free';
          slot.currentOccupant = null;
        }

        processSlotTimers();

        addHistoryEntry('RELEASE', space ? space.displayName : spaceId, slotsToRelease.map(s => s.tenantName).join(', '), {
          userName: userName || 'User',
          creatorIp: clientIp,
          message: `${userName || 'User'} (${clientIp}) released ${slotsToRelease.length} tenants in ${space ? space.displayName : spaceId}`
        });

        saveState();
        broadcastStateUpdate();
        return { success: true, releasedCount: slotsToRelease.length };
      } else {
        const slot = appState.slots[slotId];
        if (!slot) throw new Error('Slot not found');

        if (slot.status !== 'occupied' || !slot.currentOccupant) {
          return { success: true, message: 'Slot was already free' };
        }

        if (slot.currentOccupant.creatorIp && !canModifyItem(slot.currentOccupant.creatorIp, clientIp)) {
          throw new Error(`Permission denied: Only the occupant (IP: ${slot.currentOccupant.creatorIp}) can release this tenant. Your IP: ${clientIp}`);
        }

        const releasedOccupant = slot.currentOccupant;
        const releasedBy = userName || releasedOccupant.userName;

        addHistoryEntry('RELEASE', slot.spaceName, slot.tenantName, {
          userName: releasedBy,
          creatorIp: clientIp,
          message: `${releasedBy} (${clientIp}) pushed out / freed ${slot.tenantName} on ${slot.spaceName}`
        });

        slot.status = 'free';
        slot.currentOccupant = null;

        processSlotTimers();

        saveState();
        broadcastStateUpdate();
        return { success: true, slot: appState.slots[slotId] };
      }
    }

    // --- 6. EXTEND TIME ---
    case 'EXTEND': {
      const { slotId, spaceId, extendAll, additionalMinutes } = payload;
      const clientIp = payload.clientIp || '127.0.0.1';
      const addMins = Math.max(1, parseInt(additionalMinutes, 10) || 15);
      const addMs = addMins * 60 * 1000;

      if (extendAll && spaceId) {
        const spaceSlots = Object.values(appState.slots).filter(s => s.spaceId === spaceId && s.status === 'occupied');
        const slotsToExtend = spaceSlots.filter(s => canModifyItem(s.currentOccupant?.creatorIp, clientIp));
        if (slotsToExtend.length === 0 && spaceSlots.length > 0) {
          throw new Error(`Permission denied: Active tenants in this space were occupied by other IP addresses. Your IP: ${clientIp}`);
        }
        for (const slot of slotsToExtend) {
          if (slot.currentOccupant) {
            slot.currentOccupant.endsAt += addMs;
            slot.currentOccupant.totalDurationMs += addMs;
          }
        }
        const space = appState.spaces.find(s => s.id === spaceId);
        addHistoryEntry('EXTEND', space ? space.displayName : spaceId, slotsToExtend.map(s => s.tenantName).join(', '), {
          durationMinutes: addMins,
          creatorIp: clientIp,
          message: `Extended time by +${addMins}m for active tenants in ${space ? space.displayName : spaceId}`
        });
        saveState();
        broadcastStateUpdate();
        return { success: true, count: slotsToExtend.length };
      } else {
        const slot = appState.slots[slotId];
        if (!slot) throw new Error('Slot not found');
        if (slot.status !== 'occupied' || !slot.currentOccupant) {
          throw new Error('Tenant is not occupied');
        }

        if (slot.currentOccupant.creatorIp && !canModifyItem(slot.currentOccupant.creatorIp, clientIp)) {
          throw new Error(`Permission denied: Only the occupant (IP: ${slot.currentOccupant.creatorIp}) can extend time. Your IP: ${clientIp}`);
        }

        const newEndsAt = slot.currentOccupant.endsAt + addMs;
        const conflict = (slot.reservations || []).find(r => r.startTime < newEndsAt && r.startTime > slot.currentOccupant.endsAt);
        if (conflict) {
          const availableMins = Math.max(0, Math.floor((conflict.startTime - slot.currentOccupant.endsAt) / 60000));
          throw new Error(`Cannot extend: Reserved by ${conflict.userName} in ${availableMins}m`);
        }

        slot.currentOccupant.endsAt = newEndsAt;
        slot.currentOccupant.totalDurationMs += addMs;

        addHistoryEntry('EXTEND', slot.spaceName, slot.tenantName, {
          userName: slot.currentOccupant.userName,
          creatorIp: clientIp,
          durationMinutes: addMins,
          message: `${slot.currentOccupant.userName} (${clientIp}) extended time by +${addMins}m on ${slot.tenantName} (${slot.spaceName})`
        });

        saveState();
        broadcastStateUpdate();
        return { success: true, slot };
      }
    }

    case 'CANCEL_RESERVATION': {
      const { slotId, reservationId } = payload;
      const clientIp = payload.clientIp || '127.0.0.1';
      const slot = appState.slots[slotId];
      if (!slot) throw new Error('Slot not found');

      const index = (slot.reservations || []).findIndex(r => r.id === reservationId);
      if (index === -1) throw new Error('Reservation not found');

      const reservation = slot.reservations[index];

      // IP verification: only creator can cancel
      if (reservation.creatorIp && !canModifyItem(reservation.creatorIp, clientIp)) {
        throw new Error(`Permission denied: Only the creator (IP: ${reservation.creatorIp}) can cancel this reservation. Your IP: ${clientIp}`);
      }

      const [removed] = slot.reservations.splice(index, 1);
      addHistoryEntry('CANCEL_RESERVE', slot.spaceName, slot.tenantName, {
        userName: removed.userName,
        creatorIp: clientIp,
        message: `${removed.userName} (${clientIp}) cancelled reservation for ${slot.tenantName} on ${slot.spaceName}`
      });

      saveState();
      broadcastStateUpdate();
      return { success: true, slot };
    }

    case 'RESET_ALL': {
      appState = createInitialState();
      saveState();
      broadcastStateUpdate();
      return { success: true, message: 'All slots reset' };
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

// REST API Endpoints
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: Date.now(),
    environment: IS_VERCEL ? 'vercel-serverless' : 'node-server'
  });
});

app.get('/api/me', (req, res) => {
  res.json({ ip: getClientIp(req) });
});

app.get('/api/state', (req, res) => {
  res.json({
    spaces: appState.spaces,
    tenants: appState.tenants,
    slots: appState.slots,
    history: appState.history.slice(0, 50),
    serverTime: Date.now(),
    clientIp: getClientIp(req)
  });
});

app.post('/api/space-branches', (req, res) => {
  try {
    const clientIp = getClientIp(req);
    const result = handleClientAction('UPDATE_SPACE_BRANCHES', { ...req.body, clientIp });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/occupy', (req, res) => {
  try {
    const clientIp = getClientIp(req);
    const result = handleClientAction('OCCUPY', { ...req.body, clientIp });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/release', (req, res) => {
  try {
    const clientIp = getClientIp(req);
    const result = handleClientAction('RELEASE', { ...req.body, clientIp });
    res.json(result);
  } catch (err) {
    const isForbidden = err.message.includes('Permission denied');
    res.status(isForbidden ? 403 : 400).json({ error: err.message });
  }
});

app.post('/api/extend', (req, res) => {
  try {
    const clientIp = getClientIp(req);
    const result = handleClientAction('EXTEND', { ...req.body, clientIp });
    res.json(result);
  } catch (err) {
    const isForbidden = err.message.includes('Permission denied');
    res.status(isForbidden ? 403 : 400).json({ error: err.message });
  }
});

app.post('/api/reserve', (req, res) => {
  try {
    const clientIp = getClientIp(req);
    const result = handleClientAction('RESERVE', { ...req.body, clientIp });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/reserve/:slotId/:reservationId', (req, res) => {
  try {
    const clientIp = getClientIp(req);
    const result = handleClientAction('UPDATE_RESERVATION', {
      ...req.body,
      slotId: req.params.slotId,
      reservationId: req.params.reservationId,
      clientIp
    });
    res.json(result);
  } catch (err) {
    const isForbidden = err.message.includes('Permission denied');
    res.status(isForbidden ? 403 : 400).json({ error: err.message });
  }
});

app.post('/api/reserve/update', (req, res) => {
  try {
    const clientIp = getClientIp(req);
    const result = handleClientAction('UPDATE_RESERVATION', {
      ...req.body,
      clientIp
    });
    res.json(result);
  } catch (err) {
    const isForbidden = err.message.includes('Permission denied');
    res.status(isForbidden ? 403 : 400).json({ error: err.message });
  }
});

app.post('/api/check-conflicts', (req, res) => {
  try {
    const { spaceId, tenantIds, startTime, durationMinutes, ignoreReservationId } = req.body;
    const space = appState.spaces.find(s => s.id === spaceId);
    if (!space) return res.status(400).json({ error: 'Space not found' });

    const start = startTime ? new Date(startTime).getTime() : Date.now();
    const durMins = Math.max(1, parseInt(durationMinutes, 10) || 30);
    const end = start + (durMins * 60 * 1000);

    const conflicts = [];
    const tenants = Array.isArray(tenantIds) ? tenantIds : [];

    for (const tId of tenants) {
      const slot = appState.slots[`${space.id}:${tId}`];
      if (!slot) continue;
      const c = checkSlotConflict(slot, start, end, ignoreReservationId);
      if (c) conflicts.push(c);
    }

    res.json({
      hasConflict: conflicts.length > 0,
      conflicts,
      checkedWindow: { start, end }
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/reserve/:slotId/:reservationId', (req, res) => {
  try {
    const clientIp = getClientIp(req);
    const result = handleClientAction('CANCEL_RESERVATION', {
      slotId: req.params.slotId,
      reservationId: req.params.reservationId,
      clientIp
    });
    res.json(result);
  } catch (err) {
    const isForbidden = err.message.includes('Permission denied');
    res.status(isForbidden ? 403 : 400).json({ error: err.message });
  }
});

app.get('/api/history', (req, res) => {
  pruneOldHistory();
  res.json(appState.history);
});

app.post('/api/reset', (req, res) => {
  try {
    const result = handleClientAction('RESET_ALL', {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Seed demo data
app.post('/api/seed-demo', (req, res) => {
  try {
    const now = Date.now();
    appState = createInitialState();

    // Stage Sekkat: Occupy 'ali' and 'demo'
    const sekkat = appState.spaces.find(s => s.id === 'stage_sekkat');
    if (sekkat) {
      sekkat.branches = {
        frontend: 'feature/cart-checkout-v2',
        backend: 'feature/order-api-v2',
        crm: 'feature/crm-order-sync'
      };

      const sAli = appState.slots['stage_sekkat:ali'];
      sAli.status = 'occupied';
      sAli.currentOccupant = {
        id: crypto.randomUUID(),
        userName: 'Sarah Chen',
        branches: { ...sekkat.branches },
        startedAt: now - (15 * 60 * 1000),
        endsAt: now + (45 * 60 * 1000),
        totalDurationMs: 60 * 60 * 1000,
        notes: 'Testing cart checkout'
      };

      const sDemo = appState.slots['stage_sekkat:demo'];
      sDemo.status = 'occupied';
      sDemo.currentOccupant = {
        id: crypto.randomUUID(),
        userName: 'Sarah Chen',
        branches: { ...sekkat.branches },
        startedAt: now - (15 * 60 * 1000),
        endsAt: now + (45 * 60 * 1000),
        totalDurationMs: 60 * 60 * 1000,
        notes: 'Testing cart checkout'
      };
    }

    // Pre-prod Talarey: Occupy all 3
    const talarey = appState.spaces.find(s => s.id === 'preprod_talarey');
    if (talarey) {
      talarey.branches = {
        frontend: 'release/v3.4.0-rc',
        backend: 'release/v3.4.0-backend',
        crm: ''
      };

      ['ali', 'demo', 'demo1'].forEach(tId => {
        const slot = appState.slots[`preprod_talarey:${tId}`];
        slot.status = 'occupied';
        slot.currentOccupant = {
          id: crypto.randomUUID(),
          userName: 'Alex Dev',
          branches: { ...talarey.branches },
          startedAt: now - (20 * 60 * 1000),
          endsAt: now + (40 * 60 * 1000),
          totalDurationMs: 60 * 60 * 1000,
          notes: 'Full regression run'
        };
      });
    }

    // Beta: demo1 has future reservation
    const beta = appState.spaces.find(s => s.id === 'beta');
    if (beta) {
      beta.branches = {
        frontend: '',
        backend: 'bugfix/auth-token-refresh',
        crm: 'bugfix/salesforce-lead-dup'
      };

      const sBeta = appState.slots['beta:demo1'];
      sBeta.reservations = [{
        id: crypto.randomUUID(),
        userName: 'Marcus Vance',
        branches: { ...beta.branches },
        startTime: now + (30 * 60 * 1000),
        endTime: now + (90 * 60 * 1000),
        durationMinutes: 60,
        notes: 'Lead sync validation',
        createdAt: now
      }];
    }

    saveState();
    broadcastStateUpdate();
    res.json({ success: true, message: 'Demo data seeded' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server when run directly (not in Vercel serverless function or module import)
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain && !IS_VERCEL) {
  server.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(` TENANT RESERVER SERVER RUNNING ON PORT ${PORT}`);
    console.log(` Space-level Branches: Frontend, Backend, CRM`);
    console.log(` Tenant Selection per Space`);
    console.log(`===============================================`);
  });
}

export default app;
export { app, server };
