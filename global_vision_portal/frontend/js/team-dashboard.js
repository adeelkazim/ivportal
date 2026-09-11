/* Team Dashboard — TeamLead / Manager / Admin */

const TD_COLORS = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ef4444','#0ea5e9','#ec4899','#14b8a6','#84cc16','#f97316'];
function tdAvColor(id) { return TD_COLORS[Math.abs(id || 0) % TD_COLORS.length]; }
function tdInitials(name) {
    if (!name) return '?';
    const p = name.trim().split(' ');
    return (p.length >= 2 ? p[0][0] + p[p.length - 1][0] : name[0]).toUpperCase();
}

let _tdEmployees = [];
let _tdModal     = null; // { employeeId, date, remarkId|null, idx }

function localToday() {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
}

// "2026-07-08T09:34:00.000Z" → "9:34 AM"
function fmtTime(dt) {
    if (!dt) return '—';
    const d = new Date(dt);
    if (isNaN(d)) return String(dt).substring(11, 16) || dt;
    let h = d.getHours(), m = d.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2,'0')} ${ampm}`;
}

// "09:00" → "9:00 AM"
function fmtShift(t) {
    if (!t) return '—';
    const [hh, mm] = t.split(':').map(Number);
    const ampm = hh >= 12 ? 'PM' : 'AM';
    return `${hh % 12 || 12}:${String(mm).padStart(2,'0')} ${ampm}`;
}

// Returns minutes late (positive = late, ≤0 = on time)
function minsLate(shiftStart, loginDt) {
    if (!loginDt) return 0;
    const [sh, sm] = (shiftStart || '09:00').split(':').map(Number);
    const login = new Date(loginDt);
    const sched = sh * 60 + sm;
    const actual = login.getHours() * 60 + login.getMinutes();
    return actual - sched;
}

function lateByStr(mins) {
    if (mins <= 0) return '';
    const h = Math.floor(mins / 60), m = mins % 60;
    return h ? `${h}h ${m ? m + 'm ' : ''}late` : `${m}m late`;
}

function isTeamLeadOrManager() {
    const user = getUser();
    if (!user) return false;
    const r = (user.Role || '').toLowerCase();
    return r === 'teamlead' || r === 'manager' || r === 'admin';
}

document.addEventListener('DOMContentLoaded', async () => {
    checkAuth();
    if (!isTeamLeadOrManager()) { window.location.replace('dashboard.html'); return; }

    const picker = document.getElementById('tdDatePicker');
    picker.value = localToday();
    updateDateLabel(picker.value);

    // Load teams + modal dropdowns in parallel
    await Promise.all([loadTeams(), loadModalDropdowns()]);

    picker.addEventListener('change', () => { updateDateLabel(picker.value); loadDashboard(); });
    document.getElementById('tdTeamSelect').addEventListener('change', loadDashboard);
    document.getElementById('tdRefreshBtn').addEventListener('click', loadDashboard);

    // Modal wiring
    document.getElementById('tdModalCancel').addEventListener('click', closeRemarkModal);
    document.getElementById('tdModalSave').addEventListener('click', saveRemark);
    document.getElementById('tdRemarkModal').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeRemarkModal();
    });
});

function updateDateLabel(dateStr) {
    const el = document.getElementById('tdDateLabel');
    if (!el || !dateStr) return;
    const d = new Date(dateStr + 'T00:00:00');
    el.textContent = d.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

async function loadTeams() {
    try {
        const res = await apiCall('/team/my-teams');
        const teams = res?.teams || [];
        const sel = document.getElementById('tdTeamSelect');
        sel.innerHTML = '';

        if (!teams.length) {
            sel.innerHTML = '<option value="">No teams assigned</option>';
            return;
        }

        // If more than one team, show "All teams" option for Managers/Admins
        if (teams.length > 1) {
            sel.innerHTML = '<option value="">— All my teams —</option>';
        }
        teams.forEach(t => {
            const o = document.createElement('option');
            o.value = t.TeamID; o.textContent = t.TeamName;
            sel.appendChild(o);
        });

        // Auto-select if only one team (TeamLead)
        if (teams.length === 1) sel.value = String(teams[0].TeamID);

        // Load data for the auto-selected team
        loadDashboard();
    } catch (e) {
        console.warn('loadTeams:', e.message);
        document.getElementById('tdTeamSelect').innerHTML = '<option value="">Error loading teams</option>';
    }
}

async function loadModalDropdowns() {
    try {
        const [teamsRes, clientsRes] = await Promise.all([
            apiCall('/teams').catch(() => null),
            apiCall('/clients').catch(() => null),
        ]);

        const tSel = document.getElementById('tdModalTeam');
        (teamsRes?.teams || []).forEach(t => {
            const o = document.createElement('option');
            o.value = t.TeamID; o.textContent = t.TeamName;
            tSel.appendChild(o);
        });

        const cSel = document.getElementById('tdModalClient');
        (clientsRes?.clients || []).forEach(c => {
            const o = document.createElement('option');
            o.value = c.cliClientID; o.textContent = c.cliClientName;
            cSel.appendChild(o);
        });
    } catch (e) {
        console.warn('loadModalDropdowns:', e.message);
    }
}

async function loadDashboard() {
    const tbody  = document.getElementById('tdTableBody');
    const msgEl  = document.getElementById('tdMessage');
    const date   = document.getElementById('tdDatePicker').value || localToday();
    const teamId = document.getElementById('tdTeamSelect').value || '';

    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:48px;color:#94a3b8;">Loading…</td></tr>`;
    if (msgEl) msgEl.style.display = 'none';

    try {
        const qs = `date=${encodeURIComponent(date)}${teamId ? `&teamId=${teamId}` : ''}`;
        const res = await apiCall(`/team/dashboard?${qs}`);
        _tdEmployees = res?.employees || [];
        updateStats();
        renderTable();
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:#dc2626;">${esc(e.message)}</td></tr>`;
        if (msgEl) { msgEl.textContent = e.message; msgEl.className = 'message error'; msgEl.style.display = 'block'; }
    }
}

function updateStats() {
    let onTime = 0, late = 0, absent = 0;
    _tdEmployees.forEach(e => {
        if (!e.LoginTime) { absent++; return; }
        if (minsLate(e.ShiftStart, e.LoginTime) > 0) { late++; } else { onTime++; }
    });
    document.getElementById('tdStatTotal').textContent  = _tdEmployees.length;
    document.getElementById('tdStatOnTime').textContent = onTime;
    document.getElementById('tdStatLate').textContent   = late;
    document.getElementById('tdStatAbsent').textContent = absent;
}

function renderTable() {
    const tbody = document.getElementById('tdTableBody');
    if (!_tdEmployees.length) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:48px;color:#94a3b8;">No employees found for this team and date.</td></tr>`;
        return;
    }
    tbody.innerHTML = _tdEmployees.map(rowHtml).join('');
    tbody.querySelectorAll('[data-remark-btn]').forEach(btn => {
        btn.addEventListener('click', () => openRemarkModal(parseInt(btn.dataset.remarkBtn, 10)));
    });
}

function rowHtml(e, idx) {
    const av = e.ProfileImageUrl
        ? `<img src="${esc(e.ProfileImageUrl)}" alt="" style="width:34px;height:34px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:8px;">`
        : `<span class="td-av" style="background:${tdAvColor(e.EmployeeID)};">${tdInitials(e.Name)}</span>`;

    // Status
    const mins  = e.LoginTime ? minsLate(e.ShiftStart, e.LoginTime) : null;
    const isAbsent  = !e.LoginTime;
    const isLate    = !isAbsent && mins > 0;
    const isOnTime  = !isAbsent && !isLate;

    let statusHtml;
    if (isAbsent)      statusHtml = `<span class="status-badge s-absent">Absent</span>`;
    else if (isLate)   statusHtml = `<span class="status-badge s-late">Late</span><span class="late-by">${esc(lateByStr(mins))}</span>`;
    else               statusHtml = `<span class="status-badge s-ontime">On Time</span>`;

    // Shift display
    const shiftStart = e.ShiftStart || '09:00';
    const shiftEnd   = e.ShiftEnd   || '—';
    const shiftDisp  = `${fmtShift(shiftStart)} – ${e.ShiftEnd ? fmtShift(shiftEnd) : '—'}`;

    // Clock-in time
    const clockIn = e.LoginTime ? fmtTime(e.LoginTime) : '<span style="color:#94a3b8;">—</span>';

    // Remarks column
    let remarkHtml;
    if (e.RemarkID) {
        const preview = esc((e.Reason || '').substring(0, 70) + (e.Reason?.length > 70 ? '…' : ''));
        const meta    = [e.RemarkTeamName, e.RemarkClientName].filter(Boolean).map(esc).join(' · ');
        const by      = e.RecordedByName ? `by ${esc(e.RecordedByName)}` : '';
        remarkHtml = `
            <div class="remark-preview">${preview}</div>
            ${meta ? `<div class="remark-meta">${meta}</div>` : ''}
            ${by   ? `<div class="remark-by">${by}</div>`    : ''}`;
    } else {
        remarkHtml = `<span class="no-remark">No remark yet</span>`;
    }

    // Show action button only for late/absent employees
    const showBtn = isLate || isAbsent;
    const btnLabel = e.RemarkID ? 'Edit' : '+ Add Remark';
    const btnClass = e.RemarkID ? 'btn-remark-edit' : 'btn-remark-add';
    const actionHtml = showBtn
        ? `<button type="button" class="${btnClass}" data-remark-btn="${idx}">${btnLabel}</button>`
        : '';

    return `<tr>
        <td>
            <div class="td-name-cell">
                ${av}
                <div>
                    <div class="td-name">${esc(e.Name)}</div>
                    <div class="td-sub">${esc(e.Designation || e.Role || '')}${e.ClientName ? ' · ' + esc(e.ClientName) : ''}</div>
                </div>
            </div>
        </td>
        <td>
            <div class="td-time">${esc(shiftDisp)}</div>
        </td>
        <td>
            <div class="td-time">${clockIn}</div>
        </td>
        <td>${statusHtml}</td>
        <td>${remarkHtml}</td>
        <td style="white-space:nowrap;">${actionHtml}</td>
    </tr>`;
}

/* ── Remarks modal ── */

function openRemarkModal(idx) {
    const e    = _tdEmployees[idx];
    if (!e) return;
    const date = document.getElementById('tdDatePicker').value || localToday();

    _tdModal = { employeeId: e.EmployeeID, date, remarkId: e.RemarkID || null, idx };

    document.getElementById('tdModalTitle').textContent    = e.RemarkID ? 'Edit Remark' : 'Add Remark';
    document.getElementById('tdModalSubtitle').textContent = `${e.Name} — ${e.LoginTime ? fmtTime(e.LoginTime) : 'Absent'}`;
    document.getElementById('tdModalTeam').value    = e.RemarkTeamID   || e.TeamID || '';
    document.getElementById('tdModalClient').value  = e.RemarkClientID || '';
    document.getElementById('tdModalReason').value  = e.Reason          || '';
    document.getElementById('tdModalMsg').textContent = '';
    document.getElementById('tdModalMsg').className  = 'td-modal-msg';

    document.getElementById('tdRemarkModal').classList.add('open');
    document.getElementById('tdModalReason').focus();
}

function closeRemarkModal() {
    document.getElementById('tdRemarkModal').classList.remove('open');
    _tdModal = null;
}

async function saveRemark() {
    if (!_tdModal) return;
    const reason   = document.getElementById('tdModalReason').value.trim();
    const teamId   = document.getElementById('tdModalTeam').value   || null;
    const clientId = document.getElementById('tdModalClient').value || null;
    const msgEl    = document.getElementById('tdModalMsg');

    if (!reason) {
        msgEl.textContent = 'Reason is required.';
        msgEl.className   = 'td-modal-msg error';
        return;
    }

    const btn = document.getElementById('tdModalSave');
    btn.disabled = true; btn.textContent = 'Saving…';
    msgEl.textContent = '';

    try {
        if (_tdModal.remarkId) {
            await apiCall(`/admin/attendance/late-remarks/${_tdModal.remarkId}`, {
                method: 'PUT',
                body: JSON.stringify({ teamId, clientId, reason }),
            });
        } else {
            const res = await apiCall('/admin/attendance/late-remarks', {
                method: 'POST',
                body: JSON.stringify({
                    employeeId: _tdModal.employeeId,
                    date: _tdModal.date,
                    teamId, clientId, reason,
                }),
            });
            if (res?.remarkId) _tdModal.remarkId = res.remarkId;
        }

        // Optimistically update local state
        const emp = _tdEmployees[_tdModal.idx];
        if (emp) {
            emp.Reason          = reason;
            emp.RemarkID        = _tdModal.remarkId || emp.RemarkID;
            emp.RemarkTeamID    = teamId   ? parseInt(teamId,   10) : null;
            emp.RemarkClientID  = clientId ? parseInt(clientId, 10) : null;

            const tSel = document.getElementById('tdModalTeam');
            const cSel = document.getElementById('tdModalClient');
            emp.RemarkTeamName   = teamId   ? (tSel.options[tSel.selectedIndex]?.text || '') : null;
            emp.RemarkClientName = clientId ? (cSel.options[cSel.selectedIndex]?.text || '') : null;

            // RecordedByName = current user
            const user = getUser();
            emp.RecordedByName = user?.Name || null;
        }

        if (!emp?.RemarkID) {
            closeRemarkModal();
            await loadDashboard();
            return;
        }

        closeRemarkModal();
        renderTable();
    } catch (e) {
        msgEl.textContent = e.message || 'Could not save remark.';
        msgEl.className   = 'td-modal-msg error';
    } finally {
        btn.disabled = false; btn.textContent = 'Save Remark';
    }
}

function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
