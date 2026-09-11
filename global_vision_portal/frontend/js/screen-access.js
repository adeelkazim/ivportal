/* Role-based screen access — hide nav and block unauthorized pages */

const SCREEN_PATH_MAP = {
    'dashboard.html': 'dashboard',
    'profile.html': 'profile',
    'tasks.html': 'tasks',
    'inventory.html': 'inventory',
    'knowledge-base.html': 'knowledge-base',
    'medical-balance.html': 'medical-balance',
    'feedback.html': 'feedback',
    'job-announcements.html': 'jobs',
    'training.html': 'training',
    'chat.html': 'chat',
    'admin-employees.html': 'admin-employees',
    'admin-users.html': 'admin-users',
    'admin-roles.html': 'admin-roles',
    'admin-announcements.html': 'admin-announcements',
    'admin-jobs.html': 'admin-jobs',
    'admin-training.html': 'admin-training',
    'admin-dashboard.html': 'admin-dashboard',
    'admin-medical.html':      'admin-medical',
    'recommendations.html':    'recommendations',
    'task-log.html':           'task-log',
    'team-dashboard.html':      'team-dashboard',
    'admin-late-today.html':    'late-today',
    'admin-absent-today.html':  'absent-today',
};

const EMPLOYEE_ONLY_PAGES = ['dashboard.html', 'knowledge-base.html'];

// These pages are always accessible to every logged-in employee regardless of RBAC config
const EMPLOYEE_ALWAYS_ACCESSIBLE = new Set(['tasks', 'task-log', 'inventory', 'jobs', 'dashboard', 'profile', 'feedback']);
const ADMIN_ONLY_PAGES = [
    'admin-dashboard.html', 'admin-employees.html', 'admin-users.html',
    'admin-roles.html', 'admin-announcements.html', 'admin-jobs.html', 'admin-training.html',
];

const NAV_SCREEN_MAP = { ...SCREEN_PATH_MAP };

const ALLOWED_SCREENS_KEY = 'allowedScreens';

function getAllowedScreens() {
    const cached = localStorage.getItem(ALLOWED_SCREENS_KEY);
    if (!cached) return null;
    try {
        return JSON.parse(cached);
    } catch {
        return null;
    }
}

function getCurrentScreenKey() {
    const page = window.location.pathname.split('/').pop() || 'dashboard.html';
    return SCREEN_PATH_MAP[page] || null;
}

async function loadAllowedScreens() {
    if (!isValidJwt(getToken())) return [];
    try {
        const res = await apiCall('/me/screens');
        const screens = (res && res.screens) || [];
        const keys = screens.map(s => s.ScreenKey || s.screenKey || s.key);
        localStorage.setItem(ALLOWED_SCREENS_KEY, JSON.stringify(keys));
        return keys;
    } catch (e) {
        console.warn('Could not load screen permissions', e);
        const cached = localStorage.getItem(ALLOWED_SCREENS_KEY);
        try {
            return cached ? JSON.parse(cached) : null;
        } catch {
            return null;
        }
    }
}

function canAccessScreen(screenKey) {
    const allowed = getAllowedScreens();
    if (!allowed || !allowed.length) return true;
    return allowed.includes(screenKey);
}

function applyNavScreenAccess() {
    const allowed = getAllowedScreens();
    if (!allowed) return;

    if (typeof applySidebarScreenAccess === 'function') {
        applySidebarScreenAccess();
        return;
    }

    document.querySelectorAll('.nav-menu a.nav-link[href]').forEach(link => {
        const href = link.getAttribute('href');
        if (!href || href.startsWith('#')) return;
        const file = href.split('/').pop();
        const key = NAV_SCREEN_MAP[file];
        if (key && !allowed.includes(key)) {
            link.closest('li')?.remove();
        }
    });
}

async function enforcePageAccess() {
    const page = window.location.pathname.split('/').pop() || 'dashboard.html';

    // Admins cannot visit employee-only pages
    if (isAdmin() && EMPLOYEE_ONLY_PAGES.includes(page)) {
        window.location.replace('admin-dashboard.html');
        return;
    }

    // Load screens first so we can check RBAC-granted admin access for non-admins
    await loadAllowedScreens();
    applyNavScreenAccess();
    if (typeof renderSidebarNav === 'function') renderSidebarNav();
    if (typeof injectAdminSidebarLinks === 'function') injectAdminSidebarLinks();
    if (typeof markActiveSidebarLink === 'function') markActiveSidebarLink();

    // Admins always have access to admin pages
    if (isAdmin() && ADMIN_ONLY_PAGES.includes(page)) return;

    // Non-admins on admin pages: allowed only if their RBAC role grants that screen
    if (!isAdmin() && ADMIN_ONLY_PAGES.includes(page)) {
        const screenKey = SCREEN_PATH_MAP[page];
        if (!screenKey || !canAccessScreen(screenKey)) {
            window.location.replace('dashboard.html');
        }
        return;
    }

    const current = getCurrentScreenKey();
    if (!current) return;

    // Core employee pages are always accessible — skip RBAC redirect
    if (!isAdmin() && EMPLOYEE_ALWAYS_ACCESSIBLE.has(current)) return;

    if (!canAccessScreen(current)) {
        const allowed = getAllowedScreens() || [];
        let target = isAdmin() ? 'admin-dashboard.html' : 'dashboard.html';
        for (const [path, key] of Object.entries(NAV_SCREEN_MAP)) {
            if (allowed.includes(key)) {
                target = path;
                break;
            }
        }
        window.location.replace(target);
    }
}

document.addEventListener('DOMContentLoaded', function() {
    if (!isAuthenticated()) return;
    document.addEventListener('portal-layout-ready', () => {
        enforcePageAccess();
    }, { once: true });
    if (document.body.dataset.portalLayoutReady) {
        enforcePageAccess();
    }
});
