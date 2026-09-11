/* Admin — Late Employees page */

const LT_COLORS = ['#f97316','#8b5cf6','#0ea5e9','#ec4899','#14b8a6','#84cc16','#ef4444','#f59e0b','#3b82f6','#10b981'];
function ltAvColor(id) { return LT_COLORS[Math.abs(id || 0) % LT_COLORS.length]; }
function ltInitials(name) {
    if (!name) return '?';
    const p = name.trim().split(' ');
    return (p.length >= 2 ? p[0][0] + p[p.length - 1][0] : name[0]).toUpperCase();
}

let _ltEmployees = [];
// Tracks the current modal state: { employeeId, date, remarkId|null }
let _ltModal = null;

function localToday() {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
}

// Format "2026-07-08T09:34:00.000Z" or datetime string → "09:34 AM"
function fmtTime(dt) {
    if (!dt) return '—';
    const d = new Date(dt);
    if (isNaN(d)) return dt;
    let h = d.getHours(), m = d.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2,'0')} ${ampm}`;
}

// "09:00" → "9:00 AM"
function fmtShift(t) {
    if (!t) return '09:00 AM';
    const [hh, mm] = t.split(':').map(Number);
    const ampm = hh >= 12 ? 'PM' : 'AM';
    const h12 = hh % 12 || 12;
    return `${h12}:${String(mm).padStart(2,'0')} ${ampm}`;
}

// Returns "Xh Ym late" string given scheduled "HH:MM" and actual login datetime
function lateBy(shiftStart, loginDt) {
    if (!shiftStart || !loginDt) return '';
    const [sh, sm] = (shiftStart || '09:00').split(':').map(Number);
    const login = new Date(loginDt);
    const scheduledMs = sh * 60 * 60 * 1000 + sm * 60 * 1000;
    const loginMs = login.getHours() * 60 * 60 * 1000 + login.getMinutes() * 60 * 1000;
    const diffMins = Math.round((loginMs - scheduledMs) / 60000);
    if (diffMins <= 0) return '';
    const h = Math.floor(diffMins / 60), m = diffMins % 60;
    return h ? `${h}h ${m ? m + 'm ' : ''}late` : `${m}m late`;
}

document.addEventListener('DOMContentLoaded', async () => {
    checkAuth();
    if (!isTeamLead()) { window.location.replace('dashboard.html'); return; }

    const picker = document.getElementById('ltDatePicker');
    picker.value = localToday();
    updateDateLabel(picker.value);

    // Load teams & clients for the modal dropdowns in parallel with main data
    await Promise.all([loadTeamsAndClients(), loadLate()]);

    picker.addEventListener('change', () => { updateDateLabel(picker.value); loadLate(); });
    document.getElementById('ltRefreshBtn').addEventListener('click', loadLate);

    // Modal wiring
    document.getElementById('ltModalCancel').addEventListener('click', closeRemarkModal);
    document.getElementById('ltModalSave').addEventListener('click', saveRemark);
    document.getElementById('ltRemarkModal').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeRemarkModal();
    });
});

function updateDateLabel(dateStr) {
    const el = document.getElementById('ltDateLabel');
    if (!el || !dateStr) return;
    const d = new Date(dateStr + 'T00:00:00');
    el.textContent = d.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

async function loadTeamsAndClients() {
    try {
        const [teamsRes, clientsRes] = await Promise.all([
            apiCall('/teams').catch(() => null),
            apiCall('/clients').catch(() => null),
        ]);

        const teams   = teamsRes?.teams   || [];
        const clients = clientsRes?.clients || [];

        const tSel = document.getElementById('ltModalTeam');
        teams.forEach(t => {
            const o = document.createElement('option');
            o.value = t.TeamID; o.textContent = t.TeamName;
            tSel.appendChild(o);
        });

        const cSel = document.getElementById('ltModalClient');
        clients.forEach(c => {
            const o = document.createElement('option');
            o.value = c.cliClientID; o.textContent = c.cliClientName;
            cSel.appendChild(o);
        });
    } catch (e) {
        console.warn('Could not load teams/clients for modal:', e.message);
    }
}

async function loadLate() {
    const tbody = document.getElementById('ltTableBody');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:#94a3b8;">Loading…</td></tr>';
    const msgEl = document.getElementById('ltMessage');
    if (msgEl) msgEl.style.display = 'none';

    const date = document.getElementById('ltDatePicker').value || localToday();
    try {
        const res = await apiCall(`/admin/attendance/late-today?date=${encodeURIComponent(date)}`);
        _ltEmployees = res?.employees || [];
        document.getElementById('ltCount').textContent = _ltEmployees.length;
        renderTable();
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:#dc2626;">${escapeHtml(e.message)}</td></tr>`;
        if (msgEl) { msgEl.textContent = e.message; msgEl.className = 'message error'; msgEl.style.display = 'block'; }
    }
}

function renderTable() {
    const tbody = document.getElementById('ltTableBody');
    if (!_ltEmployees.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:#94a3b8;">No late employees for this date.</td></tr>';
        return;
    }

    tbody.innerHTML = _ltEmployees.map(rowHtml).join('');

    // Wire remark buttons after render
    tbody.querySelectorAll('[data-remark-btn]').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.remarkBtn, 10);
            openRemarkModal(idx);
        });
    });
}

function rowHtml(e, idx) {
    const esc = escapeHtml;
    const av  = e.ProfileImageUrl
        ? `<img src="${esc(e.ProfileImageUrl)}" alt="" style="width:34px;height:34px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:8px;">`
        : `<span class="lt-av" style="background:${ltAvColor(e.EmployeeID)};">${ltInitials(e.Name)}</span>`;

    const teamClient = [e.TeamName, e.ClientName].filter(Boolean).map(esc).join(' · ') || '—';
    const lateBadge  = lateBy(e.ShiftStart, e.LoginTime);
    const scheduled  = fmtShift(e.ShiftStart || '09:00');
    const clockedIn  = fmtTime(e.LoginTime);

    let remarkHtml;
    if (e.RemarkID) {
        const preview = esc((e.Reason || '').substring(0, 80) + (e.Reason?.length > 80 ? '…' : ''));
        const meta    = [e.RemarkTeamName, e.RemarkClientName].filter(Boolean).map(esc).join(' · ');
        const by      = e.RecordedByName ? `by ${esc(e.RecordedByName)}` : '';
        remarkHtml = `
            <div class="lt-remark-preview">${preview}</div>
            ${meta ? `<div class="lt-remark-meta">${meta}</div>` : ''}
            ${by   ? `<div class="lt-remark-meta" style="font-style:italic;">${by}</div>` : ''}`;
    } else {
        remarkHtml = `<span class="lt-no-remark">No remark yet</span>`;
    }

    const btnLabel = e.RemarkID ? 'Edit' : '+ Add Remark';
    const btnClass = e.RemarkID ? 'btn-remark-edit' : 'btn-remark-add';

    return `<tr>
        <td>
            <div class="lt-name-cell">
                ${av}
                <div>
                    <div class="lt-name">${esc(e.Name)}</div>
                    <div class="lt-sub">${esc(e.Designation || e.Role || '')}</div>
                </div>
            </div>
        </td>
        <td style="font-size:12.5px;color:#475569;">${teamClient}</td>
        <td>
            <div style="font-size:13px;color:#64748b;font-weight:600;">${esc(scheduled)}</div>
        </td>
        <td>
            <div class="lt-time">${esc(clockedIn)}</div>
            ${lateBadge ? `<div class="lt-late-by">${esc(lateBadge)}</div>` : ''}
        </td>
        <td>${remarkHtml}</td>
        <td style="white-space:nowrap;">
            <button type="button" class="${btnClass}" data-remark-btn="${idx}">${btnLabel}</button>
        </td>
    </tr>`;
}

function openRemarkModal(idx) {
    const e = _ltEmployees[idx];
    if (!e) return;

    const date = document.getElementById('ltDatePicker').value || localToday();
    _ltModal   = { employeeId: e.EmployeeID, date, remarkId: e.RemarkID || null, idx };

    document.getElementById('ltModalTitle').textContent    = e.RemarkID ? 'Edit Remark' : 'Add Remark';
    document.getElementById('ltModalSubtitle').textContent = `${e.Name} — ${fmtTime(e.LoginTime)} (${lateBy(e.ShiftStart, e.LoginTime) || 'late'})`;
    document.getElementById('ltModalTeam').value    = e.RemarkTeamID   || '';
    document.getElementById('ltModalClient').value  = e.RemarkClientID || '';
    document.getElementById('ltModalReason').value  = e.Reason          || '';
    document.getElementById('ltModalMsg').textContent = '';
    document.getElementById('ltModalMsg').className  = 'lt-modal-msg';

    document.getElementById('ltRemarkModal').classList.add('open');
    document.getElementById('ltModalReason').focus();
}

function closeRemarkModal() {
    document.getElementById('ltRemarkModal').classList.remove('open');
    _ltModal = null;
}

async function saveRemark() {
    if (!_ltModal) return;

    const reason   = document.getElementById('ltModalReason').value.trim();
    const teamId   = document.getElementById('ltModalTeam').value   || null;
    const clientId = document.getElementById('ltModalClient').value || null;
    const msgEl    = document.getElementById('ltModalMsg');

    if (!reason) {
        msgEl.textContent = 'Reason is required.';
        msgEl.className   = 'lt-modal-msg error';
        return;
    }

    const saveBtn = document.getElementById('ltModalSave');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    msgEl.textContent = '';

    try {
        if (_ltModal.remarkId) {
            // Update existing remark via PUT
            await apiCall(`/admin/attendance/late-remarks/${_ltModal.remarkId}`, {
                method: 'PUT',
                body: JSON.stringify({ teamId, clientId, reason }),
            });
        } else {
            // Upsert via POST (server handles insert-or-update automatically)
            const res = await apiCall('/admin/attendance/late-remarks', {
                method: 'POST',
                body: JSON.stringify({ employeeId: _ltModal.employeeId, date: _ltModal.date, teamId, clientId, reason }),
            });
            if (res?.remarkId) _ltModal.remarkId = res.remarkId;
        }

        // Optimistically update local data so the table reflects changes immediately
        const emp = _ltEmployees[_ltModal.idx];
        if (emp) {
            emp.Reason          = reason;
            emp.RemarkTeamID    = teamId   ? parseInt(teamId,   10) : null;
            emp.RemarkClientID  = clientId ? parseInt(clientId, 10) : null;

            // Resolve names from the dropdowns for the preview
            const tSel = document.getElementById('ltModalTeam');
            const cSel = document.getElementById('ltModalClient');
            emp.RemarkTeamName   = teamId   ? (tSel.options[tSel.selectedIndex]?.text || '') : null;
            emp.RemarkClientName = clientId ? (cSel.options[cSel.selectedIndex]?.text || '') : null;

            // If it was a new remark we don't have RemarkID yet — reload to get it
            if (!emp.RemarkID) {
                closeRemarkModal();
                await loadLate();
                return;
            }
        }

        closeRemarkModal();
        renderTable();
    } catch (e) {
        msgEl.textContent = e.message || 'Could not save remark.';
        msgEl.className   = 'lt-modal-msg error';
    } finally {
        saveBtn.disabled    = false;
        saveBtn.textContent = 'Save Remark';
    }
}

function escapeHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
