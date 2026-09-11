/* Left sidebar menu + minimal top bar (user, profile, notifications) */

const NAV_ICONS = {
    'dashboard':      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
    'profile':        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    'tasks':          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    'inventory':      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
    'knowledge-base': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
    'medical-balance':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
    'admin-medical':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M8 12h8M12 8v8"/></svg>',
    'feedback':       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    'jobs':           '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
    'training':       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
    'chat':           '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    'task-log':        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
    'team-dashboard':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    'recommendations': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
    'late-today':      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/><line x1="2" y1="2" x2="4.5" y2="4.5" stroke-width="2.5"/></svg>',
    'absent-today':    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/><line x1="17" y1="11" x2="22" y2="16"/><line x1="22" y1="11" x2="17" y2="16"/></svg>',
};

const PORTAL_NAV_ITEMS = [
    { href: 'dashboard.html',        label: 'Dashboard',       key: 'dashboard'       },
    { href: 'profile.html',          label: 'Profile',         key: 'profile'         },
    { href: 'chat.html',             label: 'Chat',            key: 'chat'            },
    { href: 'tasks.html',            label: 'Tasks',           key: 'tasks'           },
    { href: 'inventory.html',        label: 'Inventory',       key: 'inventory'       },
    { href: 'knowledge-base.html',   label: 'Knowledge Base',  key: 'knowledge-base'  },
    { href: 'medical-balance.html',  label: 'My Balances',     key: 'medical-balance' },
    { href: 'admin-medical.html',    label: 'Manage Balances', key: 'admin-medical'  },
    { href: 'feedback.html',         label: 'Feedback',        key: 'feedback'        },
    { href: 'job-announcements.html',label: 'Jobs',            key: 'jobs'            },
    { href: 'training.html',          label: 'Training',        key: 'training'        },
    { href: 'task-log.html',          label: 'Daily Log',       key: 'task-log'        },
    { href: 'recommendations.html',   label: 'Recommendations', key: 'recommendations'  },
    { href: 'team-dashboard.html',    label: 'Team Dashboard',  key: 'team-dashboard'  },
    { href: 'admin-late-today.html',  label: 'Late Employees',  key: 'late-today'       },
    { href: 'admin-absent-today.html',label: 'Absent Today',    key: 'absent-today'     },
];

document.addEventListener('DOMContentLoaded', function() {
    if (document.body.classList.contains('login-body')) return;
    if (!document.querySelector('.container')) return;
    if (document.body.dataset.portalLayoutReady) return;

    initPortalLayout();
});

function initPortalLayout() {
    const legacyNav = document.querySelector('.navbar');
    const container = document.querySelector('.container');
    if (!container) return;

    document.getElementById('portalNavModal')?.remove();

    document.body.dataset.portalLayoutReady = '1';
    document.body.classList.add('portal-app');
    document.body.classList.toggle('portal-admin', isAdmin());
    document.body.classList.toggle('portal-employee', !isAdmin());
    document.body.insertAdjacentHTML('afterbegin', `
        <header class="portal-topbar" id="portalTopbar">
            <button type="button" class="portal-menu-btn" id="sidebarToggle" aria-label="Open menu">☰</button>
            <a href="${isAdmin() ? 'admin-dashboard.html' : 'dashboard.html'}" class="portal-topbar-brand" style="text-decoration:none;color:inherit;display:flex;align-items:center;gap:8px;">
                <img src="images/logo.png" alt="Global Vision" style="height:28px;width:28px;object-fit:contain;border-radius:4px;">
                ${isAdmin() ? 'Global Vision Portal · Admin' : 'Global Vision Portal'}
            </a>
            <div class="portal-topbar-right">
                <span class="portal-topbar-user" id="topbarUserName">User</span>
                <a href="profile.html" class="portal-topbar-profile" title="Profile">Profile</a>
                <div id="topbarNotifSlot" class="portal-topbar-notif"></div>
            </div>
        </header>
        <aside class="portal-sidebar" id="portalSidebar" aria-hidden="true">
            <div class="portal-sidebar-header">
                <strong>Menu</strong>
                <button type="button" class="portal-sidebar-close" id="sidebarClose" aria-label="Close menu">×</button>
            </div>
            <nav class="portal-sidebar-nav" id="sidebarNav">
                <div id="sidebarNavMain"></div>
                <div id="sidebarNavAdmin"></div>
            </nav>
            <div class="portal-sidebar-footer">
                <a href="#logout" class="portal-sidebar-logout" id="logoutBtn">Logout</a>
            </div>
        </aside>
        <div class="portal-sidebar-overlay" id="portalSidebarOverlay"></div>
    `);

    if (legacyNav) legacyNav.remove();

    container.classList.add('portal-page-content');

    const user = getUser();
    if (user) {
        const nameEl = document.getElementById('topbarUserName');
        if (nameEl) nameEl.textContent = user.Name || user.Email || 'User';
    }

    renderSidebarNav();
    setupSidebarToggle();
    fetchChatUnreadBadge();
    markActiveSidebarLink();

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function(e) {
            e.preventDefault();
            if (typeof logout === 'function') logout();
        });
    }

    if (typeof injectAdminSidebarLinks === 'function') {
        injectAdminSidebarLinks();
    }

    if (typeof loadPortalAnnouncements === 'function') {
        loadPortalAnnouncements();
    }

    if (typeof injectNotificationBell === 'function') {
        injectNotificationBell();
    }

    document.dispatchEvent(new Event('portal-layout-ready'));
}

function renderSidebarNav() {
    const main = document.getElementById('sidebarNavMain');
    if (!main) return;

    const allowed = typeof getAllowedScreens === 'function' ? getAllowedScreens() : null;

    const dashboardHref = isAdmin() ? 'admin-dashboard.html' : 'dashboard.html';
    const employeeOnlyKeys = new Set(['knowledge-base', 'jobs', 'training', 'medical-balance']);

    // Keys always visible in sidebar for every employee regardless of RBAC
    const alwaysVisible = new Set(['dashboard', 'tasks', 'task-log', 'inventory', 'jobs', 'profile', 'feedback']);

    // Keys that are restricted — only show if RBAC explicitly grants them
    const restrictedKeys = new Set(['admin-medical', 'team-dashboard', 'late-today', 'absent-today']);

    main.innerHTML = PORTAL_NAV_ITEMS.filter(item => {
        if (isAdmin() && employeeOnlyKeys.has(item.key)) return false;
        // Restricted pages: only show if RBAC grants it (works for Admin, FinanceManager, or any future role)
        if (restrictedKeys.has(item.key)) return allowed && allowed.includes(item.key);
        if (!isAdmin() && alwaysVisible.has(item.key)) return true;
        if (!allowed || !allowed.length) return true;
        return allowed.includes(item.key);
    }).map(item => {
        const href = item.key === 'dashboard' ? dashboardHref : item.href;
        const icon = NAV_ICONS[item.key] || '';
        const badge = item.key === 'chat'
            ? `<span id="chatNavBadge" style="display:none;background:#ef4444;color:#fff;font-size:9px;font-weight:700;min-width:16px;height:16px;border-radius:8px;padding:0 4px;display:none;align-items:center;justify-content:center;margin-left:auto;"></span>`
            : '';
        return `
        <a href="${href}" class="portal-sidebar-link sidebar-nav-link" data-screen-key="${item.key}">
            <span class="nav-icon">${icon}</span>
            <span class="nav-label">${item.label}</span>
            ${badge}
        </a>`;
    }).join('');

    main.querySelectorAll('.portal-sidebar-link').forEach(link => {
        link.addEventListener('click', () => closeSidebar());
    });

    markActiveSidebarLink();
}

function markActiveSidebarLink() {
    const page = window.location.pathname.split('/').pop();
    document.querySelectorAll('.portal-sidebar-link').forEach(link => {
        const href = link.getAttribute('href');
        link.classList.toggle('active', href === page);
    });
}

function setupSidebarToggle() {
    const toggle = document.getElementById('sidebarToggle');
    const closeBtn = document.getElementById('sidebarClose');
    const overlay = document.getElementById('portalSidebarOverlay');

    toggle?.addEventListener('click', openSidebar);
    closeBtn?.addEventListener('click', closeSidebar);
    overlay?.addEventListener('click', closeSidebar);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeSidebar();
    });
}

function openSidebar() {
    document.body.classList.add('sidebar-open');
    const sidebar = document.getElementById('portalSidebar');
    if (sidebar) sidebar.setAttribute('aria-hidden', 'false');
}

function closeSidebar() {
    document.body.classList.remove('sidebar-open');
    const sidebar = document.getElementById('portalSidebar');
    if (sidebar) sidebar.setAttribute('aria-hidden', 'true');
}

function applySidebarScreenAccess() {
    const allowed = typeof getAllowedScreens === 'function' ? getAllowedScreens() : null;
    if (!allowed || !allowed.length) return;

    document.querySelectorAll('#sidebarNavMain .portal-sidebar-link[data-screen-key]').forEach(link => {
        const key = link.getAttribute('data-screen-key');
        if (key && !allowed.includes(key)) link.remove();
    });
    document.querySelectorAll('#sidebarNavAdmin .admin-sidebar-link[data-screen-key]').forEach(link => {
        const key = link.getAttribute('data-screen-key');
        if (key && !allowed.includes(key)) link.remove();
    });
}

async function fetchChatUnreadBadge() {
    if (window.location.pathname.includes('chat.html')) return; // chat.js handles its own badge
    if (!isAuthenticated()) return;
    try {
        const res = await apiCall('/chat/unread-count');
        const count = (res && res.count) || 0;
        const badge = document.getElementById('chatNavBadge');
        if (!badge) return;
        if (count > 0) {
            badge.textContent = count > 99 ? '99+' : count;
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    } catch (e) { /* silent — badge is non-critical */ }
}
