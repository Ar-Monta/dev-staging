// API and WebSocket Client with resilient auto-reconnect & REST fallback

class TenantAPI {
  constructor() {
    this.ws = null;
    this.listeners = new Set();
    this.statusListeners = new Set();
    this.isConnected = false;
    this.reconnectTimer = null;
    this.pollInterval = null;
    this.clockOffset = 0;
    this.clientIp = null;
  }

  onStateUpdate(callback) {
    this.listeners.add(callback);
  }

  onConnectionChange(callback) {
    this.statusListeners.add(callback);
  }

  notifyStatus(status, text) {
    this.isConnected = status;
    this.statusListeners.forEach(cb => cb(status, text));
  }

  notifyState(data) {
    if (data.serverTime) {
      this.clockOffset = data.serverTime - Date.now();
    }
    if (data.clientIp) {
      this.clientIp = data.clientIp;
    }
    this.listeners.forEach(cb => cb(data));
  }

  getClientIp() {
    return this.clientIp || '127.0.0.1';
  }

  normalizeIp(ip) {
    if (!ip) return '127.0.0.1';
    let s = String(ip).trim();
    if (s.startsWith('::ffff:')) s = s.substring(7);
    if (s === '::1' || s === 'localhost') s = '127.0.0.1';
    return s;
  }

  isMyIp(ip) {
    if (!ip) return true; // Legacy items without recorded IP are allowed
    return this.normalizeIp(ip) === this.normalizeIp(this.clientIp || '127.0.0.1');
  }

  now() {
    return Date.now() + this.clockOffset;
  }

  connectWS() {
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.notifyStatus(true, 'Live Connected');
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        if (this.pollInterval) {
          clearInterval(this.pollInterval);
          this.pollInterval = null;
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'INIT' || msg.type === 'STATE_UPDATE') {
            this.notifyState(msg.payload);
          } else if (msg.type === 'ERROR') {
            console.warn('Server error via WS:', msg.message);
          }
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      this.ws.onclose = () => {
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        try { this.ws.close(); } catch (e) {}
      };
    } catch (err) {
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    this.wsAttempts = (this.wsAttempts || 0) + 1;

    // Start HTTP polling immediately if not active
    if (!this.pollInterval) {
      this.startPolling();
    }

    // After 3 attempts (typical on serverless platforms like Vercel where WS is unavailable),
    // rely cleanly on HTTP polling without flooding connection errors
    if (this.wsAttempts > 3) {
      return;
    }

    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectWS();
    }, 4000);
  }

  startPolling() {
    if (this.pollInterval) clearInterval(this.pollInterval);
    const poll = async () => {
      try {
        const state = await this.getState();
        this.notifyStatus(true, 'Live Synced');
        this.notifyState(state);
      } catch (e) {
        if (!this.isConnected) {
          this.notifyStatus(false, 'Syncing...');
        }
      }
    };
    poll();
    this.pollInterval = setInterval(poll, 3000);
  }

  async dispatchAction(action, payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return new Promise((resolve, reject) => {
        try {
          this.ws.send(JSON.stringify({ action, payload }));
          resolve({ success: true, via: 'ws' });
        } catch (err) {
          this.restAction(action, payload).then(resolve).catch(reject);
        }
      });
    } else {
      return this.restAction(action, payload);
    }
  }

  async restAction(action, payload) {
    const endpoints = {
      OCCUPY: { url: '/api/occupy', method: 'POST' },
      UPDATE_SPACE_BRANCHES: { url: '/api/space-branches', method: 'POST' },
      RELEASE: { url: '/api/release', method: 'POST' },
      EXTEND: { url: '/api/extend', method: 'POST' },
      RESERVE: { url: '/api/reserve', method: 'POST' },
      UPDATE_RESERVATION: { url: '/api/reserve/update', method: 'POST' },
      RESET_ALL: { url: '/api/reset', method: 'POST' }
    };

    if (action === 'CANCEL_RESERVATION') {
      const res = await fetch(`/api/reserve/${encodeURIComponent(payload.slotId)}/${encodeURIComponent(payload.reservationId)}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to cancel reservation');
      return data;
    }

    const cfg = endpoints[action];
    if (!cfg) throw new Error(`Unknown action endpoint: ${action}`);

    const res = await fetch(cfg.url, {
      method: cfg.method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Request failed');
    }
    return data;
  }

  async getState() {
    const res = await fetch('/api/state');
    if (!res.ok) throw new Error('Failed to fetch state');
    return await res.json();
  }

  async checkConflicts(spaceId, tenantIds, startTime, durationMinutes, ignoreReservationId = null) {
    const res = await fetch('/api/check-conflicts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spaceId, tenantIds, startTime, durationMinutes, ignoreReservationId })
    });
    return await res.json();
  }

  // Update space branches
  async updateSpaceBranches(spaceId, branches, userName = '') {
    return this.dispatchAction('UPDATE_SPACE_BRANCHES', { spaceId, branches, userName });
  }

  // Occupy selected tenants in a space (e.g. ['ali', 'demo'])
  async occupy(params) {
    // params: { spaceId, tenantIds, slotId, userName, durationMinutes, notes }
    return this.dispatchAction('OCCUPY', params);
  }

  // Reserve selected tenants in a space
  async reserve(params) {
    // params: { spaceId, tenantIds, slotId, userName, startTime, durationMinutes, notes }
    return this.dispatchAction('RESERVE', params);
  }

  // Update existing reservation (Creator IP verified by server)
  async updateReservation(params) {
    // params: { slotId, reservationId, userName, startTime, durationMinutes, branches, notes }
    return this.dispatchAction('UPDATE_RESERVATION', params);
  }

  // Release single tenant or all in space
  async release(params) {
    if (typeof params === 'string') {
      return this.dispatchAction('RELEASE', { slotId: params });
    }
    return this.dispatchAction('RELEASE', params);
  }

  // Extend time
  async extend(params) {
    if (typeof params === 'string') {
      const addMins = arguments[1] || 15;
      return this.dispatchAction('EXTEND', { slotId: params, additionalMinutes: addMins });
    }
    return this.dispatchAction('EXTEND', params);
  }

  async cancelReservation(slotId, reservationId) {
    return this.dispatchAction('CANCEL_RESERVATION', { slotId, reservationId });
  }

  async seedDemo() {
    const res = await fetch('/api/seed-demo', { method: 'POST' });
    return await res.json();
  }

  async resetAll() {
    const res = await fetch('/api/reset', { method: 'POST' });
    return await res.json();
  }
}

window.apiClient = new TenantAPI();
