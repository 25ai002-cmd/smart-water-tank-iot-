/* =====================================================
   Smart Water Tank Monitor — script.js (Dashboard Page)
   Purpose: Handles dashboard UI updates, tank animation, and demo mode.
   ===================================================== */

/**
  * Initialize Dashboard specific listeners and events
  */
document.addEventListener('DOMContentLoaded', () => {
  // Subscribe to shared state updates
  onStatusUpdate((data) => {
    applyDashboardData(data);
  });

  // Fetch initial unread count for bell badge
  fetchUnreadCount();
});

/* ================================================
   NOTIFICATION DROPDOWN — Bell popup panel
   ================================================ */

function toggleBellDropdown() {
  const dropdown = document.getElementById('bell-dropdown');
  const btn = document.getElementById('bell-btn');
  if (!dropdown) return;
  const isOpen = dropdown.classList.contains('open');
  if (isOpen) {
    closeBellDropdown();
  } else {
    dropdown.classList.add('open');
    btn && btn.setAttribute('aria-expanded', 'true');
    updateDropdownList();
  }
}

function closeBellDropdown() {
  const dropdown = document.getElementById('bell-dropdown');
  const btn = document.getElementById('bell-btn');
  if (dropdown) dropdown.classList.remove('open');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

async function updateDropdownList() {
  const list = document.getElementById('notif-dropdown-list');
  if (!list || !state.apiMode) return;

  try {
    const res = await fetch(`${CONFIG.API_URL}/api/notifications?limit=6`);
    if (!res.ok) return;
    const { notifications, unread } = await res.json();

    updateBellBadge(unread || 0);

    if (!notifications || notifications.length === 0) {
      list.innerHTML = `
        <div class="notif-empty-state">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          <p>No notifications yet</p>
        </div>`;
      return;
    }

    list.innerHTML = notifications.map(n => {
      const icon = priorityIcon(n.priority);
      const time = timeAgo(n.createdAt);
      const unreadClass = !n.isRead ? 'unread' : '';
      return `
        <div class="notif-drop-item ${unreadClass}">
          <div class="notif-drop-icon ${n.priority}">${icon}</div>
          <div class="notif-drop-content">
            <p class="notif-drop-title">${escHtml(n.title)}</p>
            <p class="notif-drop-msg">${escHtml(n.message)}</p>
            <p class="notif-drop-time">${time}</p>
          </div>
          ${!n.isRead ? '<span class="notif-drop-dot"></span>' : ''}
        </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = '<div class="notif-empty-state"><p>Could not load notifications</p></div>';
  }
}

async function markAllReadDash() {
  if (!state.apiMode) return;
  try {
    await fetch(`${CONFIG.API_URL}/api/notifications/read-all`, { method: 'POST' });
    updateBellBadge(0);
    updateDropdownList();
  } catch { /* silent */ }
}

function priorityIcon(priority) {
  if (priority === 'critical') return '🚨';
  if (priority === 'warning')  return '⚠️';
  if (priority === 'success')  return '✅';
  return 'ℹ️';
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)   return 'Just now';
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400)return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}



/**
  * Map backend status data to dashboard UI elements
  */
function applyDashboardData(data) {
  if (!data || !data.sensor) return;

  const pct = data.sensor.waterPercentage;

  // 1. Update Tank Visual
  const tankWater = document.getElementById('tank-water');
  const tankLabel = document.getElementById('tank-label');
  if (tankWater) {
    tankWater.style.height = pct + '%';
    if (pct <= 15) {
      tankWater.style.background = 'linear-gradient(180deg, rgba(220,38,38,0.65) 0%, rgba(185,28,28,0.85) 100%)';
    } else if (pct >= 90) {
      tankWater.style.background = 'linear-gradient(180deg, rgba(37,99,235,0.45) 0%, rgba(29,78,216,0.75) 100%)';
    } else {
      tankWater.style.background = 'linear-gradient(180deg, rgba(37,99,235,0.55) 0%, rgba(29,78,216,0.80) 100%)';
    }
  }
  if (tankLabel) tankLabel.textContent = Math.round(pct) + '%';

  // 2. Stats grid (show cm directly — clean and precise)
  const tankH      = data.sensor.tankHeight || CONFIG.tankHeight;
  const sensorDist = data.sensor.sensorDistance;
  const waterLvlCm = data.sensor.waterLevel;

  setTextContent('stat-percentage',  Math.round(pct) + '%');
  setTextContent('stat-water-height', waterLvlCm + ' cm');
  setTextContent('stat-empty-space',  sensorDist + ' cm');
  setTextContent('stat-distance',     sensorDist + ' cm');

  // Detail table
  setTextContent('d-tank-height',  tankH + ' cm');
  setTextContent('d-water-filled', waterLvlCm + ' cm');
  setTextContent('d-empty-space',  sensorDist + ' cm');
  setTextContent('d-sensor-dist',  sensorDist + ' cm');
  setTextContent('d-water-pct',    Math.round(pct) + '%');
  setTextContent('d-last-update',  data.sensor.timestamp ? formatTimestamp(data.sensor.timestamp) : getCurrentTime());

  // Node ESP Connection status in details table
  const isEspConnected = (data.hardware && typeof data.hardware.connected === 'boolean')
    ? data.hardware.connected
    : ((state.hardware && typeof state.hardware.connected === 'boolean')
        ? state.hardware.connected
        : true);
  const espStatusEl = document.getElementById('d-esp-status');
  if (espStatusEl) {
    if (isEspConnected) {
      espStatusEl.innerHTML = '<span class="badge-pill on" style="color:#10b981; font-weight:700;">🟢 Connected &amp; Syncing</span>';
    } else {
      espStatusEl.innerHTML = '<span class="badge-pill off" style="color:#ef4444; background:rgba(239,68,68,0.1); border-color:rgba(239,68,68,0.3); font-weight:700;">🔴 Not Connected</span>';
    }
  }

  // 3. Motor status
  const motorCard       = document.getElementById('motor-card');
  const motorStatusText = document.getElementById('motor-status-text');
  const motorBadge      = document.getElementById('motor-badge');
  const dashMotorBtn    = document.getElementById('dash-motor-btn');
  const motorControlLabel = document.getElementById('motor-control-label');

  if (motorCard && data.motor) {
    const isOn          = data.motor.status;
    const isManual      = data.motor.mode === 'manual';
    const isSourceEmpty = data.motor.sourceEmpty;
    motorCard.classList.toggle('is-on', isOn);
    if (motorStatusText) {
      if (isSourceEmpty) {
        motorStatusText.textContent = 'BLOCKED (RESOURCE EMPTY)';
        motorStatusText.style.color = '#ef4444';
      } else {
        motorStatusText.textContent = isOn ? 'ON' : 'OFF';
        motorStatusText.className = isOn ? 'hw-status is-on' : 'hw-status';
        motorStatusText.style.color = '';
      }
    }
    if (motorBadge) {
      if (isSourceEmpty) {
        motorBadge.textContent = 'Resource Empty';
        motorBadge.className   = 'hw-badge';
        motorBadge.style.background = 'rgba(239, 68, 68, 0.2)';
        motorBadge.style.color = '#ef4444';
        motorBadge.title = 'Resource is empty — refill source and reset';
      } else {
        motorBadge.style.background = '';
        motorBadge.style.color = '';
        motorBadge.textContent = isManual ? 'Manual' : 'Auto';
        motorBadge.className   = isManual ? 'hw-badge badge-manual' : 'hw-badge badge-auto';
        motorBadge.title       = isManual ? 'Click to switch to Auto mode' : 'Click to switch to Manual override';
      }
    }
    if (dashMotorBtn) {
      dashMotorBtn.textContent = isOn ? 'Turn OFF' : (isSourceEmpty ? 'Reset & Test' : 'Turn ON');
      dashMotorBtn.className   = isOn ? 'btn-sm danger' : (isSourceEmpty ? 'btn-sm warning' : 'btn-sm');
    }
    if (motorControlLabel) {
      if (isSourceEmpty) {
        motorControlLabel.textContent = '🚨 Resource is empty! Pump stopped to prevent dry run.';
        motorControlLabel.style.color = '#ef4444';
      } else {
        motorControlLabel.style.color = '';
        motorControlLabel.textContent = isOn
          ? (isManual ? 'Running — Manual override' : 'Running — Auto mode')
          : (isManual ? 'Pump is idle (Manual mode)' : 'Pump is idle (Auto mode)');
      }
    }
  }

  // 4. Buzzer status
  const buzzerCard       = document.getElementById('buzzer-card');
  const buzzerStatusText = document.getElementById('buzzer-status-text');
  if (buzzerCard && data.buzzer) {
    const isOn = data.buzzer.status;
    buzzerCard.classList.toggle('is-on', isOn);
    if (buzzerStatusText) buzzerStatusText.textContent = isOn ? 'ACTIVE' : 'OFF';
  }

  // 5. Alert banner — check hardware connection
  if (!isEspConnected && state.apiMode) {
    setAlertBanner('critical', 'Node ESP is not connected — No data received from NodeMCU ESP8266. Check power and Wi-Fi connection.');
  } else {
    const alertLevel   = data.alert ? data.alert.level : getLocalAlertLevel(pct);
    const alertMessage = data.alert ? data.alert.message : getLocalAlertMsg(pct);
    setAlertBanner(alertLevel, alertMessage);
  }

  // 6. Toggle Demo Slider visibility (hide it when live server is active)
  const demoSection = document.getElementById('demo-section');
  if (demoSection) {
    demoSection.style.display = state.apiMode ? 'none' : 'block';
  }

  // Sync Demo slider if in demo mode
}



function getLocalAlertLevel(pct) {
  if (pct < CONFIG.buzzerLowThreshold) return 'low';
  if (pct > CONFIG.buzzerHighThreshold) return 'high';
  return 'normal';
}

function getLocalAlertMsg(pct) {
  if (pct < CONFIG.buzzerLowThreshold) {
    return 'Tank level low — pump started automatically.';
  } else if (pct > CONFIG.buzzerHighThreshold) {
    return 'Tank is full — pump stopped automatically.';
  }
  return 'Normal water level — system running fine.';
}

function setAlertBanner(level, message) {
  const banner = document.getElementById('alert-banner');
  const iconWrap = document.getElementById('alert-icon');
  const text = document.getElementById('alert-text');
  if (!banner) return;

  banner.className = 'alert-banner';

  // Strip any prepended warning/alert emojis from message string to guarantee single icon rendering
  const cleanMessage = (message || '').replace(/^[\s⚠️🚨🔔ℹ️✅\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE0F}]+/u, '').trim();

  if (level === 'critical' || level === 'empty' || message.includes('Resource Empty') || message.includes('not connected') || message.includes('Not Connected') || message.includes('Source Empty')) {
    banner.classList.add('alert-low');
    if (iconWrap) iconWrap.innerHTML = `<span style="font-size:1.1rem; line-height:1;">⚠️</span>`;
    if (text) text.innerHTML = `<span style="color:#ef4444; font-weight:700;">${cleanMessage}</span>`;
    return;
  }

  const icons = {
    low:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    high:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
    normal: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  };

  if (level === 'low') {
    banner.classList.add('alert-low');
  } else if (level === 'high') {
    banner.classList.add('alert-high');
  } else {
    banner.classList.add('alert-normal');
  }

  if (iconWrap) iconWrap.innerHTML = icons[level] || icons.normal;
  if (text) text.textContent = cleanMessage;
}

function setTextContent(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

/* ================================================
   MOTOR TOGGLE — Dashboard Quick Control
   ================================================ */
async function toggleMotorDash() {
  const btn = document.getElementById('dash-motor-btn');
  const motorCard = document.getElementById('motor-card');
  const motorStatusText = document.getElementById('motor-status-text');
  const motorBadge = document.getElementById('motor-badge');
  const motorControlLabel = document.getElementById('motor-control-label');

  const isCurrentlyOn = (btn && btn.textContent.trim().toLowerCase().includes('turn off')) || !!state.motorOn;
  const newStatus = !isCurrentlyOn;

  // 1. Optimistic instant UI reaction
  if (btn) {
    btn.disabled = true;
    btn.textContent = newStatus ? 'Turn OFF' : 'Turn ON';
    btn.className   = newStatus ? 'btn-sm danger' : 'btn-sm';
  }
  if (motorCard) motorCard.classList.toggle('is-on', newStatus);
  if (motorStatusText) {
    motorStatusText.textContent = newStatus ? 'ON' : 'OFF';
    motorStatusText.className   = newStatus ? 'hw-status is-on' : 'hw-status';
    motorStatusText.style.color = '';
  }
  if (motorBadge) {
    motorBadge.textContent = 'Manual';
    motorBadge.className   = 'hw-badge badge-manual';
  }
  if (motorControlLabel) {
    motorControlLabel.style.color = '';
    motorControlLabel.textContent = newStatus ? 'Running — Manual override' : 'Pump is idle (Manual mode)';
  }

  const isLive = (typeof window !== 'undefined' && window.location && window.location.protocol.startsWith('http')) || state.apiMode;

  if (isLive) {
    try {
      const response = await fetch(`${CONFIG.API_URL}/api/motor`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status: newStatus, mode: 'manual' }),
      });
      if (!response.ok) throw new Error('API error');
      const data = await response.json();
      state.motorOn     = data.status;
      state.motorManual = (data.mode === 'manual');
      state.apiMode     = true;

      applyDashboardData({
        motor: data,
        sensor: {
          waterPercentage: state.waterPercentage,
          tankHeight: CONFIG.tankHeight,
          sensorDistance: state.lastSensorDist || 25,
          waterLevel: state.lastWaterLevel || 75,
          timestamp: new Date().toISOString()
        },
        buzzer: { status: state.buzzerOn }
      });
    } catch (err) {
      console.error('Failed to toggle motor:', err);
      // Revert optimistic update on error
      if (btn) {
        btn.textContent = isCurrentlyOn ? 'Turn OFF' : 'Turn ON';
        btn.className   = isCurrentlyOn ? 'btn-sm danger' : 'btn-sm';
      }
      if (motorCard) motorCard.classList.toggle('is-on', isCurrentlyOn);
      if (motorStatusText) {
        motorStatusText.textContent = isCurrentlyOn ? 'ON' : 'OFF';
        motorStatusText.className   = isCurrentlyOn ? 'hw-status is-on' : 'hw-status';
      }
      if (motorControlLabel) {
        motorControlLabel.textContent = '❌ Failed — server unreachable';
        motorControlLabel.style.color = 'var(--danger)';
        setTimeout(() => {
          if (motorControlLabel) {
            motorControlLabel.style.color = '';
            motorControlLabel.textContent = isCurrentlyOn ? 'Running — Manual override' : 'Pump is idle (Manual mode)';
          }
        }, 3000);
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  } else {
    // Demo mode: simulate toggle
    state.motorManual = true;
    state.motorOn     = newStatus;
    const slider = document.getElementById('water-slider');
    const pct = slider ? parseInt(slider.value) : state.waterPercentage;
    onSliderChange(pct);
    if (btn) btn.disabled = false;
  }
}

/**
 * Toggle between Auto and Manual mode directly from the Dashboard badge
 */
async function toggleMotorModeDash() {
  const targetMode = state.motorManual ? 'auto' : 'manual';
  if (state.apiMode) {
    try {
      const response = await fetch(`${CONFIG.API_URL}/api/motor`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status: state.motorOn, mode: targetMode }),
      });
      if (response.ok) {
        const data = await response.json();
        state.motorManual = (data.mode === 'manual');
        const badge = document.getElementById('motor-badge');
        if (badge) {
          badge.textContent = targetMode === 'auto' ? 'Auto' : 'Manual';
          badge.className = targetMode === 'manual' ? 'hw-badge active-mode' : 'hw-badge';
        }
      }
    } catch (e) {
      console.warn('Mode toggle error:', e);
    }
  } else {
    state.motorManual = (targetMode === 'manual');
    const badge = document.getElementById('motor-badge');
    if (badge) {
      badge.textContent = targetMode === 'auto' ? 'Auto' : 'Manual';
      badge.className = targetMode === 'manual' ? 'hw-badge active-mode' : 'hw-badge';
    }
  }
}
window.toggleMotorModeDash = toggleMotorModeDash;

