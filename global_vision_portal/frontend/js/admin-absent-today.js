/* Admin — Absent Today page */

const AT_COLORS = ['#ef4444','#f97316','#8b5cf6','#0ea5e9','#ec4899','#14b8a6','#84cc16','#f59e0b','#3b82f6','#10b981'];
function atAvColor(id) { return AT_COLORS[Math.abs(id || 0) % AT_COLORS.length]; }
function atInitials(name) {
    if (!name) return '?';
    const p = name.trim().split(' ');
    return (p.length >= 2 ? p[0][0] + p[p.length - 1][0] : name[0]).toUpperCase();
}

let _atEmployees = [];

function localToday() {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
}

document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    if (!isTeamLead()) { window.location.replace('dashboard.html'); return; }

    const picker = document.getElementById('atDatePicker');
    picker.value = localToday();
    updateDateLabel(picker.value);

    loadAbsent();

    picker.addEventListener('change', () => { updateDateLabel(picker.value); loadAbsent(); });
    document.getElementById('atRefreshBtn').addEventListener('click', loadAbsent);
    document.getElementById('atSearch').addEventListener('input', e => renderCards(e.target.value.trim()));
});

function updateDateLabel(dateStr) {
    const el = document.getElementById('atDateLabel');
    if (!el || !dateStr) return;
    const d = new Date(dateStr + 'T00:00:00');
    el.textContent = d.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

async function loadAbsent() {
    document.getElementById('atContainer').innerHTML = '<div style="text-align:center;padding:48px;color:#94a3b8;">Loading…</div>';
    const msgEl = document.getElementById('atMessage');
    if (msgEl) msgEl.style.display = 'none';

    const date = document.getElementById('atDatePicker').value || localToday();
    try {
        const res = await apiCall(`/admin/attendance/absent-today?date=${encodeURIComponent(date)}`);
        _atEmployees = res?.employees || [];
        document.getElementById('atCount').textContent = _atEmployees.length;
        renderCards(document.getElementById('atSearch').value.trim());
    } catch (e) {
        document.getElementById('atContainer').innerHTML = '';
        if (msgEl) { msgEl.textContent = e.message; msgEl.className = 'message error'; msgEl.style.display = 'block'; }
    }
}

function renderCards(q) {
    const container = document.getElementById('atContainer');
    const list = q
        ? _atEmployees.filter(e => e.Name?.toLowerCase().includes(q.toLowerCase()))
        : _atEmployees;

    if (!list.length) {
        const msg = q ? 'No employees match your search.' : 'No absences recorded for this date.';
        container.innerHTML = `<div style="text-align:center;padding:48px;color:#94a3b8;">${msg}</div>`;
        return;
    }

    container.innerHTML = `<div class="at-grid">${list.map(cardHtml).join('')}</div>`;
}

function cardHtml(e) {
    const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const img = e.ProfileImageUrl
        ? `<img src="${esc(e.ProfileImageUrl)}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`
        : atInitials(e.Name);

    const meta = [e.TeamName, e.ClientName].filter(Boolean).map(s => esc(s)).join(' · ');

    return `
    <div class="at-card">
        <div class="at-avatar" style="background:${atAvColor(e.EmployeeID)};">${img}</div>
        <div class="at-info">
            <div class="at-name">${esc(e.Name)}</div>
            <div class="at-role">${esc(e.Designation || e.Role || '')}</div>
            ${meta ? `<div class="at-meta">${meta}</div>` : ''}
        </div>
        <span class="at-badge">Absent</span>
    </div>`;
}
