/* Admin — Present Today page */

const AV_COLORS_PT = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ef4444','#0ea5e9','#ec4899','#14b8a6','#84cc16','#f97316'];
function ptAvColor(id) { return AV_COLORS_PT[Math.abs(id || 0) % AV_COLORS_PT.length]; }
function ptInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    return parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : name[0].toUpperCase();
}

let _ptEmployees = [];

document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    if (!isManagerOrAdmin()) { window.location.replace('dashboard.html'); return; }

    const now = new Date();
    const label = now.toLocaleDateString('en-US', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    document.getElementById('ptDateLabel').textContent = label;

    loadPresent();
    document.getElementById('ptRefreshBtn')?.addEventListener('click', loadPresent);
    document.getElementById('ptSearch')?.addEventListener('input', e => renderCards(e.target.value.trim()));
});

function localToday() {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
}

async function loadPresent() {
    document.getElementById('ptContainer').innerHTML = '<div style="text-align:center;padding:48px;color:#94a3b8;">Loading…</div>';
    const msgEl = document.getElementById('ptMessage');
    if (msgEl) msgEl.style.display = 'none';

    try {
        const res = await apiCall(`/admin/attendance/today-all?date=${localToday()}`);
        _ptEmployees = res?.employees || [];
        updateStats();
        renderCards(document.getElementById('ptSearch')?.value.trim() || '');
    } catch (e) {
        document.getElementById('ptContainer').innerHTML = '';
        if (msgEl) { msgEl.textContent = e.message; msgEl.className = 'message error'; msgEl.style.display = 'block'; }
    }
}

function updateStats() {
    const present = _ptEmployees.filter(e => e.LoginTime);
    const active  = present.filter(e => e.StillIn === 1);
    const absent  = _ptEmployees.filter(e => !e.LoginTime);
    document.getElementById('ptTotal').textContent  = present.length;
    document.getElementById('ptActive').textContent = active.length;
    document.getElementById('ptAbsent').textContent = absent.length;
}

function renderCards(q) {
    const container = document.getElementById('ptContainer');
    const filtered = q
        ? _ptEmployees.filter(e => e.Name?.toLowerCase().includes(q.toLowerCase()))
        : _ptEmployees;

    if (!filtered.length) {
        container.innerHTML = '<div style="text-align:center;padding:48px;color:#94a3b8;">No employees found.</div>';
        return;
    }

    const present = filtered.filter(e => e.LoginTime);
    const absent  = filtered.filter(e => !e.LoginTime);

    let html = '';

    if (present.length) {
        html += `<div class="pt-section-title">Present (${present.length})</div><div class="pt-grid">`;
        html += present.map(e => cardHtml(e)).join('');
        html += '</div>';
    }

    if (absent.length) {
        html += `<div class="pt-section-title">Not Marked (${absent.length})</div><div class="pt-grid">`;
        html += absent.map(e => cardHtml(e)).join('');
        html += '</div>';
    }

    container.innerHTML = html;
}

function cardHtml(e) {
    const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const isActive  = e.LoginTime && e.StillIn === 1;
    const isPresent = e.LoginTime && e.StillIn !== 1;
    const isAbsent  = !e.LoginTime;

    let badgeHtml, timeHtml;
    if (isActive) {
        badgeHtml = '<span class="pt-badge badge-active">● Active</span>';
        timeHtml  = `<div class="pt-time">In: ${formatTime(e.LoginTime)}</div>`;
    } else if (isPresent) {
        badgeHtml = '<span class="pt-badge badge-present">Present</span>';
        timeHtml  = `<div class="pt-time">Was in: ${formatTime(e.LoginTime)}</div>`;
    } else {
        badgeHtml = '<span class="pt-badge badge-absent">Absent</span>';
        timeHtml  = '';
    }

    const img = e.ProfileImageUrl
        ? `<img src="${esc(e.ProfileImageUrl)}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`
        : ptInitials(e.Name);

    return `
    <div class="pt-card">
        <div class="pt-avatar" style="background:${ptAvColor(e.EmployeeID)};">${img}</div>
        <div class="pt-info">
            <div class="pt-name">${esc(e.Name)}</div>
            <div class="pt-role">${esc(e.Designation || e.Role || '')}${e.TeamName ? ' · ' + esc(e.TeamName) : ''}</div>
            ${timeHtml}
        </div>
        ${badgeHtml}
    </div>`;
}
