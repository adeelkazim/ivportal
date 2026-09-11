/* Admin links in left sidebar (works with app-layout.js sidebar menu) */

const ADMIN_NAV_ICONS = {
    'admin-dashboard':     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
    'admin-users':         '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    'admin-roles':         '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    'admin-announcements': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
    'admin-employees':     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    'admin-jobs':          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
    'admin-training':      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>',
};

const ADMIN_SIDEBAR_LINKS = [
    { href: 'admin-dashboard.html',     label: 'Dashboard',       key: 'admin-dashboard'     },
    { href: 'admin-users.html',         label: 'User Management', key: 'admin-users'         },
    { href: 'admin-roles.html',         label: 'Roles & Screens', key: 'admin-roles'         },
    { href: 'admin-announcements.html', label: 'Announcements',   key: 'admin-announcements' },
    { href: 'admin-employees.html',     label: 'Employee Records',key: 'admin-employees'     },
    { href: 'admin-jobs.html',          label: 'Job Postings',    key: 'admin-jobs'          },
    { href: 'admin-training.html',      label: 'Training Admin',  key: 'admin-training'      },
];

function injectAdminSidebarLinks() {
    if (!isValidJwt(getToken())) return;
    const allowed = typeof getAllowedScreens === 'function' ? getAllowedScreens() : null;
    const adminKeys = ADMIN_SIDEBAR_LINKS.map(l => l.key);
    const hasAdminAccess = isAdmin() || (allowed && allowed.some(k => adminKeys.includes(k)));
    if (!hasAdminAccess) return;

    const adminNav = document.getElementById('sidebarNavAdmin');
    if (!adminNav || document.getElementById('adminSidebarDivider')) return;

    const divider = document.createElement('div');
    divider.id = 'adminSidebarDivider';
    divider.className = 'portal-sidebar-divider';
    divider.textContent = 'Administration';
    adminNav.appendChild(divider);

    ADMIN_SIDEBAR_LINKS.forEach(item => {
        if (allowed && allowed.length && !allowed.includes(item.key)) return;
        if (document.querySelector(`.portal-sidebar-link[href="${item.href}"]`)) return;

        const link = document.createElement('a');
        link.href = item.href;
        link.className = 'portal-sidebar-link admin-sidebar-link sidebar-nav-link';
        link.setAttribute('data-screen-key', item.key);
        const icon = ADMIN_NAV_ICONS[item.key] || '';
        link.innerHTML = `<span class="nav-icon">${icon}</span><span class="nav-label">${item.label}</span>`;
        if (window.location.pathname.includes(item.href.replace('.html', ''))) {
            link.classList.add('active');
        }
        link.addEventListener('click', () => {
            if (typeof closeSidebar === 'function') closeSidebar();
        });
        adminNav.appendChild(link);
    });
}
