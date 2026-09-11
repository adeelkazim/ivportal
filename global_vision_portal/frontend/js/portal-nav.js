/* Navigation is handled by app-layout.js (sidebar). This file only guards page access. */

document.addEventListener('DOMContentLoaded', function() {
    if (!getUser() && !isValidJwt(getToken())) return;

    const page = window.location.pathname.split('/').pop() || 'dashboard.html';
    const employeeOnly = ['dashboard.html', 'tasks.html', 'inventory.html', 'knowledge-base.html'];
    const adminOnly = [
        'admin-dashboard.html', 'admin-employees.html', 'admin-users.html',
        'admin-roles.html', 'admin-announcements.html', 'admin-jobs.html', 'admin-training.html',
    ];

    if (isAdmin() && employeeOnly.includes(page)) {
        window.location.replace('admin-dashboard.html');
        return;
    }
    if (!isAdmin() && adminOnly.includes(page)) {
        window.location.replace('dashboard.html');
    }

    document.getElementById('portalNavModal')?.remove();
});
