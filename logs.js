/* =====================================================
   Smart Water Tank Monitor — logs.js (Activity Logs Page)
   Purpose: Fetch, render, and manage the sensor history log table.
   Renders mobile cards (<640px) and a desktop table (>=640px) from same data.
   ===================================================== */

document.addEventListener('DOMContentLoaded', () => {
  fetchLogs();

  // Refresh logs every 10 seconds when page is visible
  setInterval(() => {
    if (!document.hidden) fetchLogs();
  }, 10000);
});

/**
 * Format a timestamp into date + time strings.
 */
function formatTime(ts) {
  const d = new Date(ts);
  const date = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  return { date, time, full: `${date} ${time}` };
}

async function fetchLogs(limit = 50) {
  const tbody       = document.getElementById('logs-tbody');
  const cardList    = document.getElementById('logs-card-list');
  const emptyState  = document.getElementById('empty-state');
  const logsCountEl = document.getElementById('logs-count');
  if (!tbody && !cardList) return;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${CONFIG.API_URL}/api/history?limit=${limit}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) throw new Error();

    const { count, data } = await response.json();

    if (logsCountEl) logsCountEl.textContent = `${count} record${count !== 1 ? 's' : ''}`;

    if (data.length === 0) {
      if (tbody)    tbody.innerHTML    = '';
      if (cardList) cardList.innerHTML = '';
      if (emptyState) emptyState.style.display = 'flex';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    // ── Desktop Table Rows ──────────────────────────────
    if (tbody) {
      tbody.innerHTML = data.map(row => {
        const { full } = formatTime(row.timestamp);
        const pct = Math.round(row.waterPercentage);
        return `
          <tr>
            <td><strong style="color:var(--primary);">#${row.id}</strong></td>
            <td style="color:var(--text-secondary); font-size:0.8rem;">${full}</td>
            <td>${row.sensorDistance ? row.sensorDistance.toFixed(1) : '—'} cm</td>
            <td>${row.waterLevel     ? row.waterLevel.toFixed(1)     : '—'} cm</td>
            <td>
              <span class="pct-bar-wrap">
                <span class="pct-bar" style="width:${pct}%"></span>
                <span class="pct-label">${pct}%</span>
              </span>
            </td>
            <td><span class="badge-pill ${row.motorOn  ? 'on' : 'off'}">${row.motorOn  ? 'ON' : 'OFF'}</span></td>
            <td><span class="badge-pill ${row.buzzerOn ? 'on' : 'off'}">${row.buzzerOn ? 'ON' : 'OFF'}</span></td>
          </tr>`;
      }).join('');
    }

    // ── Mobile Cards ────────────────────────────────────
    if (cardList) {
      cardList.innerHTML = data.map(row => {
        const { date, time } = formatTime(row.timestamp);
        const pct = Math.round(row.waterPercentage);
        const motorClass  = row.motorOn  ? 'on' : 'off';
        const buzzerClass = row.buzzerOn ? 'on' : 'off';
        return `
          <div class="log-card">
            <div class="log-card-header">
              <span class="log-card-id">#${row.id}</span>
              <span class="log-card-time">📅 ${date} &nbsp;🕐 ${time}</span>
            </div>
            <div class="log-card-body">
              <div class="log-card-stat">
                <span class="log-card-stat-label">Sensor Dist</span>
                <span class="log-card-stat-val">${row.sensorDistance ? row.sensorDistance.toFixed(1) : '—'} cm</span>
              </div>
              <div class="log-card-stat">
                <span class="log-card-stat-label">Water Level</span>
                <span class="log-card-stat-val">${row.waterLevel ? row.waterLevel.toFixed(1) : '—'} cm</span>
              </div>
              <div class="log-card-stat">
                <span class="log-card-stat-label">Water %</span>
                <span class="log-card-stat-val">
                  <span class="pct-bar-wrap">
                    <span class="pct-bar" style="width:${pct * 0.7}px; max-width:60px;"></span>
                    <span class="pct-label">${pct}%</span>
                  </span>
                </span>
              </div>
              <div class="log-card-stat">
                <span class="log-card-stat-label">Status</span>
                <span class="log-card-stat-val" style="display:flex; gap:4px; flex-wrap:wrap; margin-top:2px;">
                  <span class="badge-pill ${motorClass}">${row.motorOn ? '⚙️ ON' : 'Motor OFF'}</span>
                </span>
              </div>
            </div>
            <div class="log-card-footer">
              <span class="log-card-footer-label">Buzzer:</span>
              <span class="badge-pill ${buzzerClass}">${row.buzzerOn ? '🔔 ACTIVE' : 'OFF'}</span>
            </div>
          </div>`;
      }).join('');
    }

  } catch {
    const errHtml = `<div style="text-align:center; color:var(--text-muted); padding:2rem; font-size:0.85rem;">
      <span style="font-size:1.5rem; display:block; margin-bottom:0.5rem;">🔌</span>
      Could not fetch logs. Ensure the server is running.
    </div>`;

    if (tbody)    tbody.innerHTML    = `<tr><td colspan="7">${errHtml}</td></tr>`;
    if (cardList) cardList.innerHTML = errHtml;
    if (emptyState) emptyState.style.display = 'none';
  }
}

async function clearLogs() {
  const btn = document.getElementById('clear-logs-btn');
  if (!btn) return;

  const confirmed = await showConfirmModal(
    'Clear All Logs',
    'Are you sure you want to clear all activity logs? This cannot be undone.',
    '🗑️ Yes, Clear All',
    'Cancel'
  );
  if (!confirmed) return;

  btn.disabled = true;
  btn.textContent = 'Clearing…';

  try {
    const response = await fetch(`${CONFIG.API_URL}/api/history`, { method: 'DELETE' });
    if (!response.ok) throw new Error();
    fetchLogs();
    btn.textContent = '✅ Logs Cleared';
    setTimeout(() => {
      btn.textContent = '🗑️ Clear All Logs';
      btn.disabled = false;
    }, 2500);
  } catch {
    btn.textContent = '❌ Failed';
    setTimeout(() => {
      btn.textContent = '🗑️ Clear All Logs';
      btn.disabled = false;
    }, 2500);
  }
}
