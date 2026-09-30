/* =====================================================
   Smart Water Tank Monitor — common.js (Shared Utilities)
   Handles CONFIG, shared state, API polling, status UI,
   and real-time notification bell badge via Socket.IO.
   ===================================================== */

const CONFIG = {
  sensorHeight:       22.7,    // cm total height from tank bottom to sensor
  tankHeight:         20.0,    // cm maximum 100% full water height
  motorOnThreshold:   20,      // %
  motorOffThreshold:  90,      // %
  buzzerLowThreshold: 20,      // %
  buzzerHighThreshold:90,      // %
  scheduleEnabled:    false,
  scheduleTime:       '05:00',

  // API settings (dynamic origin so phone & local PC connect seamlessly)
  API_URL:            (typeof window !== 'undefined' && window.location && window.location.origin && !window.location.origin.includes('file://')) ? window.location.origin : 'http://localhost:3000',
  POLL_INTERVAL_MS:   3000,
  API_TIMEOUT_MS:     4000,
};

const state = {
  waterPercentage: 0,
  motorManual:     false,
  motorOn:         false,
  buzzerOn:        false,
  apiMode:         false,
  polling:         null,
};

// Listeners list for pages to subscribe to real-time status updates
const statusListeners = [];

/**
  * Register a listener callback that triggers when new API data is received.
  * @param {function} callback
  */
function onStatusUpdate(callback) {
  if (typeof callback === 'function') {
    statusListeners.push(callback);
  }
}

/**
  * Try to reach the API server.
  */
async function initAPIConnection() {
  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), CONFIG.API_TIMEOUT_MS);

    const response = await fetch(`${CONFIG.API_URL}/api/status`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json();
      state.apiMode = true;
      setConnectionStatus('live');
      applySharedData(data);
      startPolling();
      console.log('✅ Connected to live API.');
    } else {
      throw new Error();
    }
  } catch {
    state.apiMode = false;
    setConnectionStatus('disconnected');
    console.log('⚠️ Server offline. Please start START SERVER.bat');
  }
}


/**
  * Poll the API for status updates.
  */
function startPolling() {
  if (state.polling) clearInterval(state.polling);

  state.polling = setInterval(async () => {
    try {
      const controller = new AbortController();
      const timeout    = setTimeout(() => controller.abort(), CONFIG.API_TIMEOUT_MS);

      const response = await fetch(`${CONFIG.API_URL}/api/status`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) throw new Error();

      const data = await response.json();
      setConnectionStatus('live');
      applySharedData(data);
    } catch {
      setConnectionStatus('disconnected');
    }
  }, CONFIG.POLL_INTERVAL_MS);
}

/**
  * Update the bell badge count on all pages.
  * @param {number} count – unread notifications count
  */
function updateBellBadge(count) {
  const badges = document.querySelectorAll('.bell-badge');
  badges.forEach(badge => {
    badge.textContent = count > 99 ? '99+' : count;
    badge.style.display = count > 0 ? 'flex' : 'none';
  });
}

/**
  * Connect to Socket.IO and subscribe to unread count broadcasts.
  * Called once on DOMContentLoaded if socket.io.js is loaded.
  */
function initSocketBell() {
  if (typeof io === 'undefined') return;
  try {
    const socket = io(CONFIG.API_URL, { transports: ['websocket', 'polling'] });
    socket.on('notification:unread_count', ({ count }) => {
      updateBellBadge(count);
    });
    socket.on('sensor:data', (data) => {
      if (data) {
        state.apiMode = true;
        setConnectionStatus('live');
        applySharedData(data);
      }
    });
    socket.on('notification:new', () => {
      fetchUnreadCount();
      
      // Ring animation
      const bellBtns = document.querySelectorAll('.bell-btn');
      bellBtns.forEach(btn => {
        btn.classList.add('ringing');
        setTimeout(() => btn.classList.remove('ringing'), 600);
      });

      // Update dropdown list if open
      const dropdown = document.getElementById('bell-dropdown');
      if (dropdown && dropdown.classList.contains('show')) {
        updateDropdownList();
      }
    });
  } catch (e) {
    console.warn('[Socket] Could not connect:', e);
  }
}

/**
  * Fetch unread notification count from the API.
  */
async function fetchUnreadCount() {
  try {
    const res = await fetch(`${CONFIG.API_URL}/api/notifications?limit=1`);
    if (!res.ok) return;
    const { unread } = await res.json();
    updateBellBadge(unread);
  } catch { /* silent */ }
}

/**
  * Process status payload and update local config/state, then notify subscribers.
  */
function applySharedData(data) {
  if (!data || !data.sensor) return;

  state.waterPercentage = data.sensor.waterPercentage;

  if (data.motor) {
    state.motorOn = data.motor.status;
    state.motorManual = (data.mode === 'manual' || data.motor.mode === 'manual');
  }
  if (data.buzzer) {
    state.buzzerOn = data.buzzer.status;
  }

  if (data.settings) {
    CONFIG.motorOnThreshold   = data.settings.motorOnThreshold;
    CONFIG.motorOffThreshold  = data.settings.motorOffThreshold;
    CONFIG.buzzerLowThreshold = data.settings.buzzerLowThreshold;
    CONFIG.buzzerHighThreshold = data.settings.buzzerHighThreshold;
    CONFIG.scheduleEnabled    = data.settings.scheduleEnabled || false;
    CONFIG.scheduleTime       = data.settings.scheduleTime || '05:00';
  }

  if (data.hardware) {
    state.hardware = data.hardware;
    updateHardwareUI(data.hardware);
  }

  // Update bell badge if unread count is in the payload
  if (data.unreadNotifications !== undefined) {
    updateBellBadge(data.unreadNotifications);
  }

  // Notify page-specific listeners
  statusListeners.forEach(listener => listener(data));
}



/**
  * Set the visual connection status badge in the header.
  * @param {'live'|'demo'|'disconnected'} status
  */
function setConnectionStatus(status) {
  const dot   = document.getElementById('connection-dot');
  const label = document.getElementById('connection-text');
  if (!dot || !label) return;

  dot.className = 'status-dot';
  if (status === 'live') {
    dot.classList.add('live');
    label.textContent = state.hardware && state.hardware.connected
      ? 'Hardware Syncing'
      : 'Server Online';
  } else {
    dot.classList.add('demo');
    label.textContent = status === 'disconnected' ? 'Reconnecting…' : 'Server Offline';
  }
}

/**
  * Update hardware setup UI elements if present on page
  */
function updateHardwareUI(hw) {
  const hwDot = document.getElementById('hw-live-dot');
  const hwBadge = document.getElementById('hw-live-status');
  const hwTime = document.getElementById('hw-last-seen');
  const hwIpContainer = document.getElementById('hw-server-ips');

  if (hwDot) {
    hwDot.className = 'status-dot ' + (hw.connected ? 'live' : 'demo');
  }
  if (hwBadge) {
    hwBadge.textContent = hw.connected ? '🟢 Hardware Connected & Syncing' : '🔴 Hardware Disconnected / Standby';
    hwBadge.style.color = hw.connected ? '#10b981' : '#f59e0b';
  }
  if (hwTime) {
    if (hw.lastSeen) {
      hwTime.textContent = `${hw.secondsAgo}s ago (${formatTimestamp(hw.lastSeen)})`;
    } else {
      hwTime.textContent = 'Never (Awaiting first POST payload)';
    }
  }
  if (hwIpContainer && hw.serverIps && hw.serverIps.length > 0) {
    hwIpContainer.innerHTML = hw.serverIps.map(ip => `<code>http://${ip}:3000/api/sensor</code>`).join('<br>');
  }

  const hwRemoteContainer = document.getElementById('hw-remote-url');
  if (hwRemoteContainer) {
    if (hw.publicUrl) {
      hwRemoteContainer.innerHTML = `
        <div style="margin-top:2px;">
          <a href="${hw.publicUrl}" target="_blank" style="color:#38bdf8; font-weight:700; text-decoration:underline;">${hw.publicUrl}</a>
          ${hw.publicIp ? `<span style="font-size:0.75rem; color:var(--text-muted); display:block; margin-top:3px;">🔑 Tunnel Password (if prompted on phone): <code>${hw.publicIp}</code></span>` : ''}
        </div>
      `;
    } else {
      hwRemoteContainer.innerHTML = `<span style="color:var(--text-muted); font-size:0.8rem;">Initializing cloud tunnel...</span>`;
    }
  }

  // Refresh header status label with hardware info
  if (state.apiMode) {
    setConnectionStatus('live');
  }
}

/* === UTILITY FORMATTERS === */
function formatTimestamp(isoString) {
  try {
    return new Date(isoString).toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
    });
  } catch {
    return getCurrentTime();
  }
}

function getCurrentTime() {
  return new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  });
}

function formatTime12h(timeStr) {
  if (!timeStr) return '';
  const [hh, mm] = timeStr.split(':');
  const hour = parseInt(hh);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${mm} ${ampm}`;
}

/* === BELL DROPDOWN INTERACTIVE LOGIC === */

function setupNotificationDropdown() {
  const bellBtn = document.querySelector('.bell-btn');
  if (!bellBtn) return;

  // Only set up once
  if (document.getElementById('bell-dropdown')) return;

  // Wrap bellBtn in a bell-wrapper for click containment only
  if (!bellBtn.parentElement.classList.contains('bell-wrapper')) {
    const wrapper = document.createElement('div');
    wrapper.className = 'bell-wrapper';
    bellBtn.parentNode.insertBefore(wrapper, bellBtn);
    wrapper.appendChild(bellBtn);
  }
  const wrapper = bellBtn.parentElement;

  // ── Create dropdown and attach directly to <body> ──
  // This bypasses any overflow:hidden on .app-container so the
  // dropdown is NEVER clipped by the phone-frame bezel.
  const dropdown = document.createElement('div');
  dropdown.className = 'bell-dropdown';
  dropdown.id = 'bell-dropdown';
  dropdown.innerHTML = `
    <div class="dropdown-header">
      <span class="dropdown-header-title">Recent Alerts</span>
      <button class="dropdown-header-action" id="dropdown-mark-all">Mark all read</button>
    </div>
    <div class="dropdown-list" id="dropdown-list">
      <div class="dropdown-empty">
        <div class="dropdown-empty-icon">🔔</div>
        <p>Loading alerts...</p>
      </div>
    </div>
    <div class="dropdown-footer">
      <a href="notifications.html" class="dropdown-footer-link">View All Alerts</a>
    </div>
  `;
  document.body.appendChild(dropdown);

  /**
   * Position the dropdown using fixed coordinates derived from the
   * bell button's screen rect. Works regardless of any parent
   * overflow:hidden or transform contexts.
   */
  function repositionDropdown() {
    const btnRect   = bellBtn.getBoundingClientRect();
    const GAP       = 8;
    const MARGIN    = 10;
    const dropW     = Math.min(300, window.innerWidth - MARGIN * 2);
    const spaceBelow = window.innerHeight - btnRect.bottom - GAP - MARGIN;
    const maxHeight = Math.min(400, Math.max(200, spaceBelow));

    // Align right edge of dropdown with right edge of button, clamped to viewport
    let left = btnRect.right - dropW;
    if (left < MARGIN) left = MARGIN;
    if (left + dropW > window.innerWidth - MARGIN) left = window.innerWidth - dropW - MARGIN;

    dropdown.style.position  = 'fixed';
    dropdown.style.top       = (btnRect.bottom + GAP) + 'px';
    dropdown.style.left      = left + 'px';
    dropdown.style.right     = 'auto';
    dropdown.style.bottom    = 'auto';
    dropdown.style.width     = dropW + 'px';
    dropdown.style.maxHeight = maxHeight + 'px';
    dropdown.style.zIndex    = '9000';
  }

  // ── Toggle open/close ──
  bellBtn.addEventListener('click', (e) => {
    if (window.location.pathname.includes('notifications.html')) {
      return; // Navigate normally on the notifications page
    }
    e.preventDefault();
    e.stopPropagation();
    const isOpen = dropdown.classList.toggle('show');
    if (isOpen) {
      repositionDropdown();
      updateDropdownList();
    }
  });

  // Re-position on scroll or resize
  window.addEventListener('resize', () => {
    if (dropdown.classList.contains('show')) repositionDropdown();
  });
  window.addEventListener('scroll', () => {
    if (dropdown.classList.contains('show')) repositionDropdown();
  }, { passive: true });

  // ── Close when clicking outside ──
  document.addEventListener('click', (e) => {
    if (!wrapper.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.remove('show');
    }
  });

  // ── Mark all read ──
  const markAllBtn = dropdown.querySelector('#dropdown-mark-all');
  markAllBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const res = await fetch(`${CONFIG.API_URL}/api/notifications/read-all`, { method: 'POST' });
      if (res.ok) {
        updateBellBadge(0);
        updateDropdownList();
      }
    } catch (err) {
      console.error(err);
    }
  });
}

async function updateDropdownList() {
  const list = document.getElementById('dropdown-list');
  if (!list) return;

  try {
    const res = await fetch(`${CONFIG.API_URL}/api/notifications?limit=5`);
    if (!res.ok) throw new Error();
    const json = await res.json();
    // Server may return { notifications } or { data }
    const notifications = json.notifications || json.data || [];

    if (notifications.length === 0) {
      list.innerHTML = `
        <div class="dropdown-empty">
          <div class="dropdown-empty-icon">🔔</div>
          <p>No recent alerts.</p>
        </div>`;
      return;
    }

    const priorityIcons = { critical: '🚨', warning: '⚠️', success: '✅', info: 'ℹ️' };

    list.innerHTML = notifications.map(n => {
      const unreadClass = !n.isRead ? 'unread' : '';
      const dot  = !n.isRead ? '<span class="dropdown-item-dot"></span>' : '';
      const icon = priorityIcons[n.priority] || '🔔';
      const timeStr = formatRelativeTimeCommon(n.createdAt);
      return `
        <a href="notifications.html" class="dropdown-item ${unreadClass}">
          <div class="dropdown-item-icon priority-${n.priority}">${icon}</div>
          <div class="dropdown-item-content">
            <p class="dropdown-item-title">${escapeHtmlCommon(n.title)}</p>
            <p class="dropdown-item-desc">${escapeHtmlCommon(n.message)}</p>
            <span class="dropdown-item-time">${timeStr}</span>
          </div>
          ${dot}
        </a>`;
    }).join('');

  } catch {
    list.innerHTML = `
      <div class="dropdown-empty">
        <div class="dropdown-empty-icon">🔌</div>
        <p>Could not fetch alerts.</p>
      </div>`;
  }
}

function formatRelativeTimeCommon(isoStr) {
  const diff = Date.now() - new Date(isoStr).getTime();
  const sec  = Math.floor(diff / 1000);
  if (sec < 60)   return 'just now';
  const min  = Math.floor(sec / 60);
  if (min < 60)   return `${min}m ago`;
  const hr   = Math.floor(min / 60);
  if (hr < 24)    return `${hr}h ago`;
  const day  = Math.floor(hr / 24);
  return `${day}d ago`;
}

function escapeHtmlCommon(str) {
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[m]));
}

/* =====================================================
   SIDEBAR TOGGLE (COLLAPSE & EXPAND)
   ===================================================== */
function initSidebarToggle() {
  const container = document.querySelector('.app-container');
  if (!container) return;

  // Check saved user preference (defaults to expanded)
  const isCollapsed = localStorage.getItem('sidebar_collapsed') === 'true';
  if (isCollapsed) {
    container.classList.add('sidebar-collapsed');
  }

  // 1. Inject sidebar close button into brand-section if not already present
  const brandSection = document.querySelector('.brand-section');
  if (brandSection && !document.getElementById('sidebar-close-btn')) {
    const closeBtn = document.createElement('button');
    closeBtn.id = 'sidebar-close-btn';
    closeBtn.className = 'sidebar-toggle-btn sidebar-close-btn';
    closeBtn.setAttribute('aria-label', 'Collapse side panel');
    closeBtn.setAttribute('title', 'Hide side panel');
    closeBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="9" y1="3" x2="9" y2="21"></line>
        <polyline points="15 9 12 12 15 15"></polyline>
      </svg>
    `;
    closeBtn.onclick = toggleSidebar;
    brandSection.appendChild(closeBtn);
  }

  // 2. Inject sidebar open button into page-header title block if not already present
  const pageHeader = document.querySelector('.page-header');
  if (pageHeader && !document.getElementById('sidebar-open-btn')) {
    const titleBlock = pageHeader.querySelector('div:first-child');
    const openBtn = document.createElement('button');
    openBtn.id = 'sidebar-open-btn';
    openBtn.className = 'sidebar-toggle-btn sidebar-open-btn';
    openBtn.setAttribute('aria-label', 'Open side panel');
    openBtn.setAttribute('title', 'Show side panel');
    openBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="9" y1="3" x2="9" y2="21"></line>
        <polyline points="13 9 16 12 13 15"></polyline>
      </svg>
    `;
    openBtn.onclick = toggleSidebar;
    
    if (titleBlock) {
      const wrapper = document.createElement('div');
      wrapper.className = 'header-title-wrap';
      wrapper.style.display = 'flex';
      wrapper.style.alignItems = 'center';
      wrapper.style.gap = '0.75rem';
      pageHeader.replaceChild(wrapper, titleBlock);
      wrapper.appendChild(openBtn);
      wrapper.appendChild(titleBlock);
    } else {
      pageHeader.insertBefore(openBtn, pageHeader.firstChild);
    }
  }

  // 3. Inject floating open button on body for easy access from anywhere
  if (!document.getElementById('sidebar-floating-toggle')) {
    const floatBtn = document.createElement('button');
    floatBtn.id = 'sidebar-floating-toggle';
    floatBtn.className = 'sidebar-floating-toggle';
    floatBtn.setAttribute('aria-label', 'Open side panel');
    floatBtn.setAttribute('title', 'Show side panel');
    floatBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="9" y1="3" x2="9" y2="21"></line>
        <polyline points="13 9 16 12 13 15"></polyline>
      </svg>
    `;
    floatBtn.onclick = toggleSidebar;
    document.body.appendChild(floatBtn);
  }
}

function toggleSidebar() {
  const container = document.querySelector('.app-container');
  if (!container) return;
  container.classList.toggle('sidebar-collapsed');
  const isCollapsed = container.classList.contains('sidebar-collapsed');
  localStorage.setItem('sidebar_collapsed', isCollapsed);
}

// Initialize connection, socket bell, sidebar toggle, and dropdown on DOM load
document.addEventListener('DOMContentLoaded', () => {
  initSidebarToggle();
  initAPIConnection();
  fetchUnreadCount();
  initSocketBell();
  setupNotificationDropdown();
});

/**
 * Shows a beautiful custom confirmation modal instead of the browser's confirm() popup.
 * @param {string} title - Header text of the modal
 * @param {string} message - Description message
 * @param {string} confirmText - Label for the confirm button
 * @param {string} cancelText - Label for the cancel button
 * @returns {Promise<boolean>}
 */
function showConfirmModal(title, message, confirmText = 'Confirm', cancelText = 'Cancel') {
  return new Promise((resolve) => {
    // Create elements
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    
    overlay.innerHTML = `
      <div class="modal-container">
        <div class="modal-header">
          <div class="modal-header-icon">🗑️</div>
          <span>${escapeHtmlCommon(title)}</span>
        </div>
        <div class="modal-body">
          ${escapeHtmlCommon(message)}
        </div>
        <div class="modal-footer">
          <button class="btn-primary" id="modal-btn-confirm">${escapeHtmlCommon(confirmText)}</button>
          <button class="btn-secondary" id="modal-btn-cancel">${escapeHtmlCommon(cancelText)}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Trigger transition Reflow
    overlay.offsetHeight; 
    overlay.classList.add('show');

    const cleanUp = (result) => {
      overlay.classList.remove('show');
      // Wait for transition before destroying from DOM
      setTimeout(() => {
        overlay.remove();
        resolve(result);
      }, 300);
    };

    // Wire up events
    const confirmBtn = overlay.querySelector('#modal-btn-confirm');
    const cancelBtn = overlay.querySelector('#modal-btn-cancel');

    confirmBtn.addEventListener('click', () => cleanUp(true));
    cancelBtn.addEventListener('click', () => cleanUp(false));
    
    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanUp(false);
    });
  });
}


