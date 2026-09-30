/* =====================================================
   Smart Water Tank Monitor — notifications.js
   Purpose: Notification manager page – fetch, render,
            filter, search, paginate, and real-time updates.
   ===================================================== */

/* ── State ─────────────────────────────────────────── */
const nState = {
  page:        1,
  limit:       15,
  filter:      'all',
  sort:        'newest',
  search:      '',
  totalPages:  1,
  searchTimer: null,
};

/* ── Icon map ──────────────────────────────────────── */
const PRIORITY_ICONS = {
  critical: '🚨',
  warning:  '⚠️',
  success:  '✅',
  info:     'ℹ️',
};

/* ── On page load ──────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  fetchNotifications();
  fetchStats();
  connectSocket();
});

/* ── Socket.IO real-time listener ──────────────────── */
function connectSocket() {
  const badge = document.getElementById('socket-badge');
  if (typeof io === 'undefined') {
    if (badge) badge.innerHTML = '<span class="live-dot" style="background:#d97706"></span> Offline';
    return;
  }

  const socket = io(CONFIG.API_URL, { transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    if (badge) badge.innerHTML = '<span class="live-dot"></span> Live';
  });
  socket.on('disconnect', () => {
    if (badge) badge.innerHTML = '<span class="live-dot" style="background:#d97706"></span> Disconnected';
  });

  socket.on('notification:new', (notif) => {
    // Prepend to list if on page 1 and matches current filter
    if (nState.page === 1) {
      const container = document.getElementById('notif-list-inner');
      const currentEmpty = container.querySelector('.notif-empty');
      if (currentEmpty) container.innerHTML = '';

      const card = buildNotifCard(notif);
      container.insertAdjacentHTML('afterbegin', card);
    }
    // Show toast
    showToast(notif);
    // Refresh stats
    fetchStats();
  });

  socket.on('notification:unread_count', ({ count }) => {
    updateBellBadge(count);
    const unreadEl = document.getElementById('stat-unread');
    if (unreadEl) unreadEl.textContent = count;
  });
}

/* ── Fetch & render notifications ──────────────────── */
async function fetchNotifications() {
  const container = document.getElementById('notif-list-inner');
  const pagination = document.getElementById('pagination');

  try {
    const params = new URLSearchParams({
      page:   nState.page,
      limit:  nState.limit,
      sort:   nState.sort,
    });

    if (nState.filter !== 'all') params.set('type', nState.filter);
    if (nState.search)           params.set('search', nState.search);

    const res  = await fetch(`${CONFIG.API_URL}/api/notifications?${params}`);
    if (!res.ok) throw new Error('API error');
    const { total, unread, page, totalPages, data } = await res.json();

    nState.totalPages = totalPages;

    updateBellBadge(unread);
    document.getElementById('stat-unread').textContent  = unread;

    // Render cards
    if (data.length === 0) {
      container.innerHTML = `
        <div class="notif-empty">
          <div class="notif-empty-icon">🔔</div>
          <p>No notifications found${nState.search ? ' for "<strong>' + escapeHtml(nState.search) + '</strong>"' : ''}.<br>The system will generate alerts as sensor events are detected.</p>
        </div>`;
    } else {
      container.innerHTML = `<div class="notif-list">${data.map(buildNotifCard).join('')}</div>`;
    }

    // Pagination
    renderPagination(page, totalPages);

  } catch (err) {
    container.innerHTML = `
      <div class="notif-empty">
        <div class="notif-empty-icon">🔌</div>
        <p>Could not fetch notifications.<br>Ensure the server is running.</p>
      </div>`;
    if (pagination) pagination.style.display = 'none';
  }
}

/* ── Fetch summary stats ───────────────────────────── */
async function fetchStats() {
  try {
    const res = await fetch(`${CONFIG.API_URL}/api/notifications?limit=200`);
    if (!res.ok) return;
    const { total, unread, data } = await res.json();

    const counts = { critical: 0, warning: 0, success: 0 };
    data.forEach(n => { if (counts[n.priority] !== undefined) counts[n.priority]++; });

    document.getElementById('stat-total').textContent    = total;
    document.getElementById('stat-unread').textContent   = unread;
    document.getElementById('stat-critical').textContent = counts.critical;
    document.getElementById('stat-warning').textContent  = counts.warning;
    document.getElementById('stat-success').textContent  = counts.success;
  } catch { /* silent */ }
}

/* ── Build a notification card HTML ────────────────── */
function buildNotifCard(notif) {
  const icon     = PRIORITY_ICONS[notif.priority] || '🔔';
  const timeStr  = formatRelativeTime(notif.createdAt);
  const unread   = !notif.isRead ? 'unread' : '';
  const readBtn  = !notif.isRead
    ? `<button class="notif-action-btn" onclick="markRead(${notif.id}, this)" aria-label="Mark as read">Mark read</button>`
    : `<span style="font-size:0.72rem; color:var(--text-muted);">Read</span>`;

  return `
    <div class="notif-card priority-${notif.priority} ${unread}" id="notif-card-${notif.id}" data-id="${notif.id}">
      <div class="notif-icon-wrap priority-${notif.priority}" aria-hidden="true">${icon}</div>
      <div class="notif-body">
        <p class="notif-title">${escapeHtml(notif.title)}</p>
        <p class="notif-msg">${escapeHtml(notif.message)}</p>
        <div class="notif-meta">
          ${!notif.isRead ? '<span class="notif-unread-dot" aria-label="Unread"></span>' : ''}
          <span class="notif-priority-badge priority-${notif.priority}">${notif.priority}</span>
          <span class="notif-time" title="${new Date(notif.createdAt).toLocaleString('en-IN')}">${timeStr}</span>
        </div>
      </div>
      <div class="notif-actions">
        ${readBtn}
        <button class="notif-action-btn delete" onclick="deleteNotif(${notif.id}, this)" aria-label="Delete notification">🗑️</button>
      </div>
    </div>`;
}

/* ── Mark single notification as read ─────────────── */
async function markRead(id, btn) {
  try {
    const res = await fetch(`${CONFIG.API_URL}/api/notifications/${id}/read`, { method: 'POST' });
    if (!res.ok) return;
    const { unread } = await res.json();
    const card = document.getElementById(`notif-card-${id}`);
    if (card) {
      card.classList.remove('unread');
      const dot = card.querySelector('.notif-unread-dot');
      if (dot) dot.remove();
      if (btn) btn.parentElement.innerHTML = '<span style="font-size:0.72rem; color:var(--text-muted);">Read</span>';
    }
    updateBellBadge(unread);
    document.getElementById('stat-unread').textContent = unread;
  } catch { /* silent */ }
}

/* ── Delete a notification ─────────────────────────── */
async function deleteNotif(id, btn) {
  try {
    const res = await fetch(`${CONFIG.API_URL}/api/notifications/${id}`, { method: 'DELETE' });
    if (!res.ok) return;
    const card = document.getElementById(`notif-card-${id}`);
    if (card) {
      card.style.transition = 'opacity 0.25s, transform 0.25s';
      card.style.opacity    = '0';
      card.style.transform  = 'translateX(30px)';
      setTimeout(() => { card.remove(); fetchStats(); }, 280);
    }
  } catch { /* silent */ }
}

/* ── Mark all as read ──────────────────────────────── */
async function markAllRead() {
  const btn = document.getElementById('mark-all-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Marking…'; }
  try {
    await fetch(`${CONFIG.API_URL}/api/notifications/read-all`, { method: 'POST' });
    showBulkFeedback('✅ All notifications marked as read.');
    fetchNotifications();
    fetchStats();
  } catch { showBulkFeedback('❌ Failed. Server may be offline.'); }
  if (btn) { btn.disabled = false; btn.textContent = '✅ Mark All as Read'; }
}

/* ── Clear all notifications ───────────────────────── */
async function clearAllNotifications() {
  const confirmed = await showConfirmModal(
    'Clear All Notifications',
    'Clear all notifications? This cannot be undone.',
    '🗑️ Yes, Clear All',
    'Cancel'
  );
  if (!confirmed) return;
  const btn = document.getElementById('clear-all-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Clearing…'; }
  try {
    await fetch(`${CONFIG.API_URL}/api/notifications`, { method: 'DELETE' });
    showBulkFeedback('🗑️ All notifications cleared.');
    fetchNotifications();
    fetchStats();
  } catch { showBulkFeedback('❌ Failed. Server may be offline.'); }
  if (btn) { btn.disabled = false; btn.textContent = '🗑️ Clear All'; }
}

/* ── Filter ────────────────────────────────────────── */
function setFilter(filter, el) {
  nState.filter = filter;
  nState.page   = 1;
  document.querySelectorAll('.filter-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.filter === filter);
    t.setAttribute('aria-selected', t.dataset.filter === filter ? 'true' : 'false');
  });
  fetchNotifications();
}

/* ── Search (debounced 400ms) ──────────────────────── */
function onSearch() {
  clearTimeout(nState.searchTimer);
  nState.searchTimer = setTimeout(() => {
    nState.search = document.getElementById('notif-search').value.trim();
    nState.page   = 1;
    fetchNotifications();
  }, 400);
}

/* ── Sort ──────────────────────────────────────────── */
function onSortChange() {
  nState.sort = document.getElementById('sort-select').value;
  nState.page = 1;
  fetchNotifications();
}

/* ── Pagination ────────────────────────────────────── */
function renderPagination(page, totalPages) {
  const el = document.getElementById('pagination');
  if (!el) return;

  if (totalPages <= 1) { el.style.display = 'none'; return; }
  el.style.display = 'flex';

  let html = `<button class="page-btn" onclick="goPage(${page - 1})" ${page === 1 ? 'disabled' : ''}>‹ Prev</button>`;
  const start = Math.max(1, page - 2);
  const end   = Math.min(totalPages, page + 2);

  if (start > 1) html += `<button class="page-btn" onclick="goPage(1)">1</button>${start > 2 ? '<span class="page-info">…</span>' : ''}`;
  for (let i = start; i <= end; i++) {
    html += `<button class="page-btn ${i === page ? 'active' : ''}" onclick="goPage(${i})">${i}</button>`;
  }
  if (end < totalPages) html += `${end < totalPages - 1 ? '<span class="page-info">…</span>' : ''}<button class="page-btn" onclick="goPage(${totalPages})">${totalPages}</button>`;

  html += `<button class="page-btn" onclick="goPage(${page + 1})" ${page === totalPages ? 'disabled' : ''}>Next ›</button>`;
  html += `<span class="page-info">Page ${page} of ${totalPages}</span>`;
  el.innerHTML = html;
}

function goPage(p) {
  if (p < 1 || p > nState.totalPages) return;
  nState.page = p;
  fetchNotifications();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ── Toast notification ────────────────────────────── */
function showToast(notif) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const icon = PRIORITY_ICONS[notif.priority] || '🔔';
  const toast = document.createElement('div');
  toast.className = `toast priority-${notif.priority}`;
  toast.innerHTML = `<div class="toast-title">${icon} ${escapeHtml(notif.title)}</div><div class="toast-msg">${escapeHtml(notif.message)}</div>`;
  container.appendChild(toast);
  setTimeout(() => { toast.remove(); }, 5000);
}

/* ── Bulk feedback message ─────────────────────────── */
function showBulkFeedback(msg) {
  const el = document.getElementById('bulk-feedback');
  if (!el) return;
  el.textContent = msg;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.textContent = ''; }, 4000);
}

/* ── Relative time formatter ───────────────────────── */
function formatRelativeTime(isoStr) {
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

/* ── HTML escape ───────────────────────────────────── */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[m]));
}
