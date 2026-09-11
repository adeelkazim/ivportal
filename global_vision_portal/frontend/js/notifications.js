/* Notification bell — visible to all authenticated users.
   Admins see inventory/general notifications.
   All users see task_status notifications sent to them.
   Drop-up toasts fire when new task status notifications arrive. */

let notificationsOpen   = false;
let pollTimer           = null;
let lastSeenNotifId     = parseInt(localStorage.getItem('lastSeenNotifId') || '0', 10);
let toastQueue          = [];
let toastActive         = false;

// ── Bootstrap ─────────────────────────────────────────────────────

function startNotificationPolling() {
    if (!isValidJwt(getToken())) return;
    injectNotificationBell();
    loadNotifications();
    if (!pollTimer) pollTimer = setInterval(loadNotifications, 30000);
}

document.addEventListener('portal-layout-ready', startNotificationPolling);
document.addEventListener('DOMContentLoaded', function () {
    if (document.body.dataset.portalLayoutReady && isValidJwt(getToken())) {
        startNotificationPolling();
    }
});

// ── Bell injection ────────────────────────────────────────────────

function injectNotificationBell() {
    const slot = document.getElementById('topbarNotifSlot');
    if (!slot || document.getElementById('notifBellBtn')) return;

    const adminOnly = isAdmin();
    const clearBtnHtml = adminOnly
        ? `<button type="button" id="notifClearAllBtn" class="btn-link" style="font-size:12px;color:#ef4444;">Clear all</button>`
        : '';

    slot.innerHTML = `
        <div class="nav-notif-wrap topbar-notif-wrap">
            <button type="button" id="notifBellBtn" class="portal-notif-btn" aria-label="Notifications">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
                <span id="notifBadge" class="notif-badge" style="display:none">0</span>
            </button>
            <div id="notifPanel" class="notif-panel notif-panel-topbar" style="display:none">
                <div class="notif-panel-header">
                    <strong>Notifications</strong>
                    <div style="display:flex;gap:10px;align-items:center;">
                        <button type="button" id="notifMarkAllBtn" class="btn-link" style="font-size:12px;">Mark all read</button>
                        ${clearBtnHtml}
                    </div>
                </div>
                <div id="notifList" class="notif-list">
                    <p class="notif-empty">No notifications</p>
                </div>
            </div>
        </div>
    `;

    document.getElementById('notifBellBtn').addEventListener('click', toggleNotificationPanel);
    document.getElementById('notifMarkAllBtn').addEventListener('click', markAllNotificationsRead);
    if (adminOnly) {
        document.getElementById('notifClearAllBtn').addEventListener('click', clearAllNotifications);
    }

    document.addEventListener('click', function (e) {
        if (!e.target.closest('.topbar-notif-wrap')) closeNotificationPanel();
    });
}

// ── Panel toggle ──────────────────────────────────────────────────

function toggleNotificationPanel(e) {
    e.stopPropagation();
    const panel = document.getElementById('notifPanel');
    if (!panel) return;
    notificationsOpen = !notificationsOpen;
    panel.style.display = notificationsOpen ? 'block' : 'none';
    if (notificationsOpen) loadNotifications();
}

function closeNotificationPanel() {
    const panel = document.getElementById('notifPanel');
    if (panel) panel.style.display = 'none';
    notificationsOpen = false;
}

// ── Load & render ─────────────────────────────────────────────────

async function loadNotifications() {
    if (!isValidJwt(getToken())) return;

    try {
        const response = await apiCall('/notifications');
        if (!response) return;

        const list   = response.notifications || [];
        const unread = response.unreadCount   || 0;

        renderNotificationBadge(unread);
        if (notificationsOpen) renderNotificationList(list);

        // Drop-up toasts for new task_status notifications
        const maxId = list.reduce((m, n) => Math.max(m, n.NotificationID || 0), 0);
        if (lastSeenNotifId === 0 && maxId > 0) {
            // First load: silently set watermark, don't toast for existing notifications
            lastSeenNotifId = maxId;
            localStorage.setItem('lastSeenNotifId', String(maxId));
        } else if (maxId > lastSeenNotifId) {
            const freshOnes = list.filter(
                n => (n.NotificationID || 0) > lastSeenNotifId && n.Type === 'task_status' && !n.IsRead
            );
            freshOnes.forEach(n => enqueueToast(n));
            lastSeenNotifId = maxId;
            localStorage.setItem('lastSeenNotifId', String(maxId));
        }
    } catch (error) {
        console.warn('Notifications:', error.message);
    }
}

function renderNotificationBadge(unread) {
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    if (unread > 0) {
        badge.textContent = unread > 99 ? '99+' : unread;
        badge.style.display = 'inline-flex';
    } else {
        badge.style.display = 'none';
    }
}

function renderNotificationList(notifications) {
    const container = document.getElementById('notifList');
    if (!container) return;

    if (!notifications.length) {
        container.innerHTML = '<p class="notif-empty">No notifications</p>';
        return;
    }

    container.innerHTML = notifications.map(n => `
        <div class="notif-item ${n.IsRead ? 'read' : 'unread'}" data-id="${n.NotificationID}">
            <strong>${escapeNotifHtml(n.Title || 'Notification')}</strong>
            <p>${escapeNotifHtml(n.Message || '')}</p>
            <small>${formatNotifDate(n.CreatedAt)}</small>
            ${!n.IsRead ? `<button type="button" class="btn-link notif-mark-read" data-id="${n.NotificationID}">Mark read</button>` : ''}
        </div>
    `).join('');

    container.querySelectorAll('.notif-mark-read').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                await apiCall(`/notifications/${btn.dataset.id}/read`, { method: 'PUT' });
                loadNotifications();
            } catch (err) {
                console.warn(err);
            }
        });
    });
}

async function markAllNotificationsRead() {
    try {
        await apiCall('/notifications/read-all', { method: 'PUT' });
        loadNotifications();
    } catch (error) {
        console.warn(error);
    }
}

async function clearAllNotifications() {
    if (!confirm('Delete all notifications? This cannot be undone.')) return;
    try {
        await apiCall('/notifications', { method: 'DELETE' });
        loadNotifications();
    } catch (error) {
        console.warn('Clear notifications:', error.message);
        const list = document.getElementById('notifList');
        if (list) list.innerHTML = '<p class="notif-empty">No notifications</p>';
    }
}

// ── Drop-up toast system ──────────────────────────────────────────

function ensureToastContainer() {
    if (document.getElementById('notif-toast-container')) return;
    const styles = `
        #notif-toast-container {
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 9999;
            display: flex;
            flex-direction: column-reverse;
            gap: 10px;
            pointer-events: none;
        }
        .notif-toast {
            background: #1e293b;
            color: #f1f5f9;
            border-radius: 12px;
            padding: 14px 18px 12px;
            min-width: 300px;
            max-width: 380px;
            box-shadow: 0 8px 32px rgba(0,0,0,.35);
            pointer-events: all;
            position: relative;
            overflow: hidden;
            transform: translateY(30px);
            opacity: 0;
            transition: transform .35s cubic-bezier(.16,1,.3,1), opacity .35s ease;
        }
        .notif-toast.toast-show {
            transform: translateY(0);
            opacity: 1;
        }
        .notif-toast.toast-hide {
            transform: translateY(30px);
            opacity: 0;
        }
        .notif-toast-bar {
            position: absolute;
            bottom: 0;
            left: 0;
            height: 3px;
            background: #3b82f6;
            width: 100%;
            transform-origin: left;
            animation: toastBarShrink 7s linear forwards;
        }
        @keyframes toastBarShrink {
            from { transform: scaleX(1); }
            to   { transform: scaleX(0); }
        }
        .notif-toast-type {
            font-size: 11px;
            font-weight: 700;
            letter-spacing: .5px;
            text-transform: uppercase;
            color: #93c5fd;
            margin-bottom: 4px;
        }
        .notif-toast-title {
            font-size: 14px;
            font-weight: 700;
            color: #f1f5f9;
            line-height: 1.3;
            margin-bottom: 4px;
        }
        .notif-toast-msg {
            font-size: 12.5px;
            color: #94a3b8;
            line-height: 1.4;
        }
        .notif-toast-close {
            position: absolute;
            top: 8px;
            right: 10px;
            background: none;
            border: none;
            color: #64748b;
            font-size: 16px;
            cursor: pointer;
            line-height: 1;
            padding: 2px 5px;
            border-radius: 4px;
            transition: color .15s, background .15s;
        }
        .notif-toast-close:hover { color: #f1f5f9; background: rgba(255,255,255,.08); }
    `;
    const styleEl = document.createElement('style');
    styleEl.textContent = styles;
    document.head.appendChild(styleEl);

    const container = document.createElement('div');
    container.id = 'notif-toast-container';
    document.body.appendChild(container);
}

function enqueueToast(notif) {
    toastQueue.push(notif);
    if (!toastActive) drainToastQueue();
}

function drainToastQueue() {
    if (!toastQueue.length) { toastActive = false; return; }
    toastActive = true;
    const notif = toastQueue.shift();
    showToast(notif, drainToastQueue);
}

function showToast(notif, onDone) {
    ensureToastContainer();
    const container = document.getElementById('notif-toast-container');

    const toast = document.createElement('div');
    toast.className = 'notif-toast';
    toast.innerHTML = `
        <button class="notif-toast-close" title="Dismiss">&times;</button>
        <div class="notif-toast-type">Task Update</div>
        <div class="notif-toast-title">${escapeNotifHtml(notif.Title || 'Task status changed')}</div>
        <div class="notif-toast-msg">${escapeNotifHtml(notif.Message || '')}</div>
        <div class="notif-toast-bar"></div>
    `;
    container.appendChild(toast);

    // Trigger CSS entrance
    requestAnimationFrame(() => {
        requestAnimationFrame(() => toast.classList.add('toast-show'));
    });

    const dismissToast = () => {
        toast.classList.remove('toast-show');
        toast.classList.add('toast-hide');
        setTimeout(() => {
            toast.remove();
            if (onDone) onDone();
        }, 400);
    };

    toast.querySelector('.notif-toast-close').addEventListener('click', dismissToast);

    // Auto-dismiss after 7 s (bar animation matches this)
    const timer = setTimeout(dismissToast, 7000);
    toast.addEventListener('mouseenter', () => clearTimeout(timer));
    toast.addEventListener('mouseleave', () => setTimeout(dismissToast, 2000));
}

// ── Util ──────────────────────────────────────────────────────────

function formatNotifDate(d) {
    if (!d) return '';
    return new Date(d).toLocaleString();
}

function escapeNotifHtml(s) {
    if (!s) return '';
    const el = document.createElement('div');
    el.textContent = s;
    return el.innerHTML;
}
