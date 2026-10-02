/* =====================================================
   Smart Water Tank Monitor — controls.js (Control panel)
   Purpose: Handles threshold settings, scheduling, push alerts, and pump controls.
   ===================================================== */

document.addEventListener('DOMContentLoaded', () => {
  // Sync page elements when connection changes or polls updates
  onStatusUpdate((data) => {
    syncControlsUI(data);
  });

  // Setup push alerts on page load
  initPushNotifications();
});

function syncControlsUI(data) {
  if (!data) return;

  // 1. Sync manual motor control UI elements
  const toggleBtn = document.getElementById('motor-toggle-btn');
  const controlLabel = document.getElementById('control-label');
  if (toggleBtn && controlLabel && data.motor) {
    const isOn          = data.motor.status;
    const isSourceEmpty = data.motor.sourceEmpty;
    toggleBtn.textContent = isOn ? 'Turn OFF Pump' : (isSourceEmpty ? 'Reset Alert & Turn ON' : 'Turn ON Pump');
    toggleBtn.className = isOn ? 'btn-primary btn-danger' : (isSourceEmpty ? 'btn-primary' : 'btn-primary');
    const isEspConnected = (data.hardware && data.hardware.connected) || (state.hardware && state.hardware.connected);
    if (isSourceEmpty) {
      controlLabel.textContent = `🚨 Pump locked: Resource is empty! (Refill resource & turn ON to test)`;
      controlLabel.style.color = '#ef4444';
    } else if (!isEspConnected && state.apiMode) {
      controlLabel.textContent = isOn ? `Pump is running (⚠️ Node ESP Not Connected)` : `Pump is idle (⚠️ Node ESP Not Connected)`;
      controlLabel.style.color = '#d97706';
    } else {
      controlLabel.style.color = '';
      controlLabel.textContent = isOn
        ? `Pump is running (${data.motor.mode === 'manual' ? 'Manual override' : 'Auto mode'})`
        : `Pump is idle`;
    }

    const modeDot = document.getElementById('mode-dot');
    const modeValue = document.getElementById('mode-value');
    if (modeValue) {
      if (!isEspConnected && state.apiMode) {
        modeValue.innerHTML = `${data.motor.mode === 'manual' ? 'Manual' : 'Auto'} <span style="color:#ef4444; font-size:0.75rem; font-weight:700;">(🔴 Node ESP Not Connected)</span>`;
      } else {
        modeValue.textContent = data.motor.mode === 'manual' ? 'Manual Override' : 'Auto';
      }
    }
    if (modeDot) {
      modeDot.style.background = isEspConnected ? '#10b981' : '#ef4444';
    }
  }

  // 2. Sync Settings thresholds inputs (only if user is not actively editing)
  if (data.settings) {
    const startInput = document.getElementById('input-start-threshold');
    const stopInput = document.getElementById('input-stop-threshold');
    if (startInput && document.activeElement !== startInput) startInput.value = data.settings.motorOnThreshold;
    if (stopInput && document.activeElement !== stopInput) stopInput.value = data.settings.motorOffThreshold;

    // Sync Schedule settings inputs
    const scheduleToggle = document.getElementById('schedule-enabled-toggle');
    const scheduleTimeInput = document.getElementById('input-schedule-time');
    if (scheduleToggle) {
      scheduleToggle.checked = data.settings.scheduleEnabled;
      updateScheduleToggleLabel(data.settings.scheduleEnabled);
    }
    if (scheduleTimeInput && document.activeElement !== scheduleTimeInput) {
      scheduleTimeInput.value = data.settings.scheduleTime || '05:00';
    }
    updateScheduleNote(data.settings.scheduleEnabled, data.settings.scheduleTime);
  }
}

/* ================================================
   MOTOR MANUAL TOGGLE CONTROLS
   ================================================ */
async function toggleMotor() {
  const newStatus = !state.motorOn;

  if (state.apiMode) {
    try {
      const response = await fetch(`${CONFIG.API_URL}/api/motor`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status: newStatus, mode: 'manual' }),
      });
      if (!response.ok) throw new Error();
      const data = await response.json();
      state.motorOn = data.status;
      state.motorManual = (data.mode === 'manual');
      syncControlsUI({ motor: data });
    } catch {
      showFeedback('settings-feedback', '❌ Failed to toggle motor on server.', 'error');
    }
  } else {
    // Demo mode simulated toggle
    state.motorManual = true;
    state.motorOn = newStatus;
    syncControlsUI({ motor: { status: state.motorOn, mode: 'manual' } });

    // Auto reset manual demo mode in 30 seconds
    clearTimeout(state.demoManualTimer);
    state.demoManualTimer = setTimeout(() => {
      state.motorManual = false;
      showFeedback('settings-feedback', '⚡ Demo manual override timed out. Reverting to auto control.', 'success');
      // Trigger a standard level check update
      loadDemoDefaults();
    }, 30000);
  }
}

/* ================================================
   AUTO SETTINGS ACTIONS & INPUT RESTRICTIONS
   ================================================ */

/**
 * Enforces maximum 2 digits and real-time bounds checking on threshold inputs
 */
function handleThresholdInput(inputEl, minVal, maxVal) {
  if (!inputEl) return;
  
  // Allow empty while user is typing/backspacing
  if (inputEl.value === '') return;

  // Enforce max 2 numerical characters
  if (inputEl.value.length > 2) {
    inputEl.value = inputEl.value.slice(0, 2);
  }

  const val = parseInt(inputEl.value, 10);
  if (isNaN(val)) return;

  // Real-time error feedback for stop threshold safety (max 90%)
  if (inputEl.id === 'input-stop-threshold' && val > 90) {
    showFeedback('threshold-feedback', '⚠️ Sensor Safety Limit: Stop threshold cannot exceed 90%! Setting above 90% damages the ultrasonic sensor.', 'error');
    inputEl.value = '90';
  } else if (inputEl.id === 'input-start-threshold' && val > 50) {
    showFeedback('threshold-feedback', '⚠️ Start threshold must be between 10% and 50%.', 'error');
    inputEl.value = '50';
  }
}

async function saveSettings() {
  const startInput = document.getElementById('input-start-threshold');
  const stopInput = document.getElementById('input-stop-threshold');
  if (!startInput || !stopInput) return;

  const start = parseInt(startInput.value, 10);
  const stop = parseInt(stopInput.value, 10);

  // Validate Start Threshold (10 to 50)
  if (isNaN(start) || start < 10 || start > 50) {
    showFeedback('threshold-feedback', '⚠️ Start threshold must be between 10% and 50%.', 'error');
    return;
  }

  // Validate Stop Threshold (51 to 90)
  if (stop > 90) {
    showFeedback('threshold-feedback', '⚠️ Sensor Safety Error: Stop threshold cannot exceed 90%! Selecting more than 90% will cause water to touch and damage the ultrasonic sensor.', 'error');
    stopInput.value = 90;
    return;
  }

  if (isNaN(stop) || stop < 51) {
    showFeedback('threshold-feedback', '⚠️ Stop threshold must be between 51% and 90%.', 'error');
    return;
  }

  if (start >= stop) {
    showFeedback('threshold-feedback', '⚠️ Start threshold must be less than Stop threshold.', 'error');
    return;
  }

  if (state.apiMode) {
    try {
      const response = await fetch(`${CONFIG.API_URL}/api/settings`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ motorOnThreshold: start, motorOffThreshold: stop }),
      });
      const data = await response.json();
      if (!response.ok) {
        showFeedback('threshold-feedback', `❌ ${data.error || 'Failed to save settings'}`, 'error');
        return;
      }
      showFeedback('threshold-feedback', '⚡ Threshold settings saved successfully!', 'success');
    } catch {
      showFeedback('threshold-feedback', '❌ Failed to save threshold settings to server.', 'error');
    }
  } else {
    CONFIG.motorOnThreshold = start;
    CONFIG.motorOffThreshold = stop;
    showFeedback('threshold-feedback', '⚡ Threshold settings saved locally!', 'success');
  }
}

/* ================================================
   TIME MANAGEMENT SCHEDULE ACTIONS
   ================================================ */
function toggleSchedule() {
  const toggle = document.getElementById('schedule-enabled-toggle');
  if (!toggle) return;
  updateScheduleToggleLabel(toggle.checked);
}

function onScheduleTimeChange() {
  const toggle = document.getElementById('schedule-enabled-toggle');
  const timeInput = document.getElementById('input-schedule-time');
  if (toggle && timeInput) {
    updateScheduleNote(toggle.checked, timeInput.value);
  }
}

function updateScheduleToggleLabel(enabled) {
  const label = document.getElementById('schedule-toggle-label');
  if (label) {
    label.textContent = enabled ? 'Daily Schedule is ON' : 'Daily Schedule is OFF';
  }
}

function updateScheduleNote(enabled, time) {
  const note = document.getElementById('schedule-note');
  if (note) {
    if (enabled) {
      note.textContent = `📅 Schedule active: Pump will start daily at ${formatTime12h(time)} and fill the tank.`;
      note.style.color = '#10b981';
    } else {
      note.textContent = '📅 Daily Schedule is disabled.';
      note.style.color = '';
    }
  }
}

async function saveScheduleSettings() {
  const toggle = document.getElementById('schedule-enabled-toggle');
  const timeInput = document.getElementById('input-schedule-time');
  if (!toggle || !timeInput) return;

  const enabled = toggle.checked;
  const time = timeInput.value;

  if (!time || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    showFeedback('schedule-feedback', 'Please select a valid time.', 'error');
    return;
  }

  if (state.apiMode) {
    try {
      const response = await fetch(`${CONFIG.API_URL}/api/settings`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ scheduleEnabled: enabled, scheduleTime: time }),
      });
      if (!response.ok) throw new Error();
      const data = await response.json();
      showFeedback('schedule-feedback', '⚡ Schedule saved successfully!', 'success');
    } catch {
      showFeedback('schedule-feedback', '❌ Failed to save schedule settings to server.', 'error');
    }
  } else {
    CONFIG.scheduleEnabled = enabled;
    CONFIG.scheduleTime = time;
    showFeedback('schedule-feedback', '⚡ Schedule saved locally (Demo Mode)!', 'success');
  }
}

/* ================================================
   FEEDBACK MESSAGES UTILITIES
   ================================================ */
function showFeedback(elementId, message, type) {
  const el = document.getElementById(elementId);
  if (!el) return;

  el.textContent = message;
  el.className = 'input-feedback ' + (type === 'success' ? 'feedback-success' : 'feedback-error');
  el.style.opacity = '1';

  clearTimeout(el.timer);
  el.timer = setTimeout(() => {
    el.style.opacity = '0';
  }, 4000);
}

/* ================================================
   PUSH ALERTS & WEB PUSH SERVICE WORKER
   ================================================ */
const NOTIF = {
  sw:           null,
  subscription: null,
  vapidKey:     null,
  supported:    false,
};

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

async function initPushNotifications() {
  const noteEl = document.getElementById('notif-browser-note');
  const btn = document.getElementById('notif-toggle-btn');

  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    NOTIF.supported = false;
    setNotifUI('unsupported');
    if (noteEl) {
      noteEl.innerHTML = '⚠️ Push notifications are not supported in this browser.';
    }
    return;
  }

  NOTIF.supported = true;

  if (Notification.permission === 'denied') {
    setNotifUI('blocked');
    showUnblockInstructions(noteEl);
    return;
  }

  try {
    NOTIF.sw = await navigator.serviceWorker.register('/sw.js');
  } catch (err) {
    setNotifUI('error');
    return;
  }

  try {
    const res = await fetch(`${CONFIG.API_URL}/api/vapid-public-key`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    NOTIF.vapidKey = data.publicKey;
  } catch {
    setNotifUI('server-offline');
    return;
  }

  try {
    const swReg = await navigator.serviceWorker.ready;
    const existing = await swReg.pushManager.getSubscription();
    if (existing) {
      NOTIF.subscription = existing;
      localStorage.setItem('notifEnabled', 'true');
      setNotifUI('enabled');
    } else if (localStorage.getItem('notifEnabled') === 'true') {
      await subscribeToPush(false);
    } else {
      setNotifUI('idle');
    }
  } catch {
    setNotifUI('idle');
  }

  if (btn) btn.disabled = false;
}

function showUnblockInstructions(noteEl) {
  if (!noteEl) return;
  noteEl.innerHTML = '<strong>🚫 Notifications are blocked.</strong> Please unlock them in your browser site settings and refresh.';
}

async function subscribeToPush(showMsg = true) {
  try {
    const swReg = await navigator.serviceWorker.ready;
    const sub   = await swReg.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: urlBase64ToUint8Array(NOTIF.vapidKey),
    });

    const res = await fetch(`${CONFIG.API_URL}/api/subscribe`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(sub),
    });
    if (!res.ok) throw new Error();

    NOTIF.subscription = sub;
    localStorage.setItem('notifEnabled', 'true');
    setNotifUI('enabled');
    if (showMsg) showFeedback('notif-feedback', '🔔 Notifications enabled!', 'success');
  } catch {
    localStorage.removeItem('notifEnabled');
    setNotifUI('idle');
    if (showMsg) showFeedback('notif-feedback', '❌ Could not subscribe.', 'error');
  }
}

async function unsubscribeFromPush() {
  try {
    if (NOTIF.subscription) {
      await fetch(`${CONFIG.API_URL}/api/subscribe`, {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ endpoint: NOTIF.subscription.endpoint }),
      });
      await NOTIF.subscription.unsubscribe();
      NOTIF.subscription = null;
    }
    localStorage.removeItem('notifEnabled');
    setNotifUI('idle');
    showFeedback('notif-feedback', '🔕 Notifications disabled.', 'success');
  } catch {
    showFeedback('notif-feedback', '❌ Could not unsubscribe.', 'error');
  }
}

async function handleNotifToggle() {
  const btn = document.getElementById('notif-toggle-btn');
  if (btn) btn.disabled = true;

  if (NOTIF.subscription) {
    await unsubscribeFromPush();
  } else {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      await subscribeToPush();
    } else {
      setNotifUI('blocked');
    }
  }

  if (btn) btn.disabled = false;
}

function setNotifUI(uiState) {
  const btn     = document.getElementById('notif-toggle-btn');
  const dotEl   = document.getElementById('notif-dot');
  const labelEl = document.getElementById('notif-status-label');

  if (!btn || !dotEl || !labelEl) return;
  dotEl.className = 'notif-dot';

  switch (uiState) {
    case 'enabled':
      dotEl.classList.add('notif-dot-on');
      labelEl.textContent  = 'Alerts enabled on this device';
      btn.textContent      = 'Disable Alerts';
      btn.className        = 'btn-primary btn-danger';
      btn.disabled         = false;
      break;
    case 'blocked':
      dotEl.classList.add('notif-dot-blocked');
      labelEl.textContent  = 'Blocked by browser';
      btn.textContent      = 'Enable Alerts';
      btn.className        = 'btn-secondary';
      btn.disabled         = true;
      break;
    case 'unsupported':
      dotEl.classList.add('notif-dot-blocked');
      labelEl.textContent  = 'Browser not supported';
      btn.textContent      = 'Not Available';
      btn.className        = 'btn-secondary';
      btn.disabled         = true;
      break;
    case 'server-offline':
      dotEl.classList.add('notif-dot-idle');
      labelEl.textContent  = 'Server offline';
      btn.textContent      = 'Enable Alerts';
      btn.className        = 'btn-secondary';
      btn.disabled         = true;
      break;
    default: // idle
      dotEl.classList.add('notif-dot-idle');
      labelEl.textContent  = 'Not enabled';
      btn.textContent      = 'Enable Alerts';
      btn.className        = 'btn-primary';
      btn.disabled         = false;
  }
}
