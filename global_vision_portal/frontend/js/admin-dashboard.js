/* Admin-only home (not mixed with employee dashboard) */

document.addEventListener('DOMContentLoaded', function() {
    checkAuth();
    if (!isManagerOrAdmin()) {
        window.location.replace('dashboard.html');
        return;
    }

    const user = getUser();
    const nameEl = document.getElementById('adminUserName');
    if (user && nameEl) nameEl.textContent = user.Name || 'Admin';

    loadAdminStats();
    loadEmployeeDropdown();    // calls setupEmployeeRecordsPanel inside
    loadLogsDropdown();
    setupAttendanceRecordsPanel();
    setupAttendanceUpload();
    setupLogsPanel();
    loadAdminAttendance();
});

async function loadAdminStats() {
    try {
        const [empRes, tasksRes, invRes, feedbackRes, annRes, attendRes] = await Promise.allSettled([
            apiCall('/admin/employees'),
            apiCall('/tasks?all=true'),
            apiCall('/inventory'),
            apiCall('/feedback'),
            apiCall('/admin/announcements'),
            apiCall('/attendance/today'),
        ]);

        const employees = empRes.status === 'fulfilled' ? (empRes.value?.employees || []) : [];
        const tasks     = tasksRes.status === 'fulfilled' ? (tasksRes.value?.tasks || []) : [];
        const items     = invRes.status === 'fulfilled' ? (invRes.value?.items || []) : [];
        const feedback  = feedbackRes.status === 'fulfilled' ? (feedbackRes.value?.items || []) : [];
        const announcements = annRes.status === 'fulfilled' ? (annRes.value?.announcements || []) : [];

        setStat('statEmployees', employees.length);
        setStat('statTasks', tasks.filter(t => t.Status === 'To Be Started' || t.Status === 'In Progress').length);
        setStat('statInventory', items.filter(i => i.Status === 'Issued').length);
        setStat('statFeedback', feedback.filter(f => f.status !== 'Resolved').length);
        setStat('statAnnouncements', announcements.filter(a => a.isActive).length);

        const localToday = (() => {
            const n = new Date();
            return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
        })();
        const attAllRes = await apiCall(`/admin/attendance/today-all?date=${localToday}`).catch(() => null);
        const todayAll  = attAllRes?.employees || [];
        const presentCount = todayAll.filter(e => e.LoginTime).length;
        const absentCount  = todayAll.filter(e => !e.LoginTime).length;
        const lateCount    = todayAll.filter(e => {
            if (!e.LoginTime || !e.ShiftStart) return false;
            const loginHHMM = e.LoginTime.substring(11, 16);
            return loginHHMM > e.ShiftStart;
        }).length;
        setStat('statPresent', presentCount);
        setStat('statAbsent',  absentCount);
        setStat('statLate',    lateCount);
    } catch (e) {
        console.warn('Admin stats:', e.message);
    }
}

function setStat(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value !== undefined && value !== null ? value : '—';
}

// ══ Employee Records panel ══════════════════════════════════════

let _allEmployees = [];  // cached list used by both modes

async function setupEmployeeRecordsPanel() {
    // Load employee list once (used by both Single + Attendance panels)
    try {
        const res = await apiCall('/admin/employees');
        _allEmployees = (res?.employees || []);
        _populateEmpDropdown('empDropdown');
        _populateEmpDropdown('attEmpSelect');
        renderAllEmployeesTable('');
    } catch (e) { console.warn('Employee list:', e.message); }

    // Mode tab wiring
    _modeTabs('empModeTabSingle', 'empModeTabAll', 'empModeSingle', 'empModeAll');

    // Single mode: dropdown change
    document.getElementById('empDropdown')?.addEventListener('change', function() {
        const id = parseInt(this.value, 10);
        const exportBtn = document.getElementById('exportSingleEmpBtn');
        if (id) { loadEmpDetail(id); if (exportBtn) exportBtn.style.display = ''; }
        else { document.getElementById('empDetailPanel').style.display = 'none'; if (exportBtn) exportBtn.style.display = 'none'; }
    });

    // Single export button
    document.getElementById('exportSingleEmpBtn')?.addEventListener('click', () => {
        const id = document.getElementById('empDropdown')?.value;
        if (id) downloadXlsx(`/admin/employees/export?employeeId=${id}`, 'exportSingleEmpMsg');
    });

    // All employees: search
    document.getElementById('empAllSearch')?.addEventListener('input', e => renderAllEmployeesTable(e.target.value));

    // All employees: export
    document.getElementById('exportAllEmpsBtn')?.addEventListener('click', () => {
        downloadXlsx('/admin/employees/export', 'exportAllEmpMsg');
    });
}

function _populateEmpDropdown(id) {
    const sel = document.getElementById(id);
    if (!sel) return;
    const existing = new Set([...sel.options].map(o => o.value));
    _allEmployees.forEach(emp => {
        if (existing.has(String(emp.EmployeeID))) return;
        const opt = document.createElement('option');
        opt.value = emp.EmployeeID;
        opt.textContent = `${emp.Name}  (${emp.Role || ''})`;
        sel.appendChild(opt);
    });
}

function renderAllEmployeesTable(q) {
    const wrap = document.getElementById('empAllTableWrap');
    if (!wrap) return;
    const filtered = q
        ? _allEmployees.filter(e => `${e.Name} ${e.Role} ${e.TeamName || ''}`.toLowerCase().includes(q.toLowerCase()))
        : _allEmployees;

    if (!filtered.length) { wrap.innerHTML = '<p class="text-muted" style="padding:16px;">No employees found.</p>'; return; }

    wrap.innerHTML = `
    <table class="adm-summary-table">
        <thead><tr>
            <th>#</th><th>Name</th><th>Employee ID</th><th>Role</th><th>Designation</th>
            <th>Email</th><th>Team</th><th>Status</th>
        </tr></thead>
        <tbody>${filtered.map((e, i) => `
        <tr>
            <td style="color:#94a3b8;">${i + 1}</td>
            <td style="font-weight:600;">${empEsc(e.Name)}</td>
            <td>#${e.EmployeeID}</td>
            <td>${empEsc(e.Role || '—')}</td>
            <td>${empEsc(e.Designation || '—')}</td>
            <td style="color:#2555c4;">${empEsc(e.Email || '—')}</td>
            <td>${empEsc(e.TeamName || '—')}</td>
            <td>${e.isActive ? '<span class="adm-badge-present">Active</span>' : '<span class="adm-badge-absent">Inactive</span>'}</td>
        </tr>`).join('')}
        </tbody>
    </table>`;
}

// Shared helper: load employee dropdown (legacy alias kept for loadLogsDropdown)
async function loadEmployeeDropdown() {
    await setupEmployeeRecordsPanel();
}

async function loadEmpDetail(employeeId) {
    const panel = document.getElementById('empDetailPanel');
    panel.style.display = 'block';
    panel.innerHTML = '<p class="text-center">Loading…</p>';
    try {
        const res = await apiCall(`/admin/employees/${employeeId}`);
        if (!res || !res.success) throw new Error('Failed to load employee');
        const e = res.employee;
        const attendance = res.attendance || [];
        const tasks = res.tasks || [];
        const inventory = res.inventory || [];

        panel.innerHTML = `
            <div class="admin-detail-header" style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:10px;">
                <div>
                    <h2>${empEsc(e.Name)} <small class="badge-muted">#${e.EmployeeID}</small></h2>
                    <p class="text-muted" style="margin-top:4px;">${empEsc(e.Email)} &nbsp;·&nbsp; ${empEsc(e.TeamName || 'No team')}</p>
                </div>
                <button class="btn-secondary" onclick="downloadXlsx('/admin/employees/export?employeeId=${e.EmployeeID}','exportSingleEmpMsg')">⬇ Export Profile</button>
            </div>

            <section class="admin-detail-section">
                <h3>Profile</h3>
                <dl class="admin-info-grid">
                    <dt>Name</dt>        <dd>${empEsc(e.Name)}</dd>
                    <dt>Employee ID</dt> <dd>${e.EmployeeID}</dd>
                    <dt>Email</dt>       <dd>${empEsc(e.Email)}</dd>
                    <dt>Username</dt>    <dd>${empEsc(e.Username || '—')}</dd>
                    <dt>Role</dt>        <dd>${empEsc(e.Role)}</dd>
                    <dt>Client</dt>      <dd>${empEsc(e.ClientName || e.clientName || '—')}</dd>
                    <dt>Designation</dt> <dd>${empEsc(e.Designation || '—')}</dd>
                    <dt>Contact</dt>     <dd>${empEsc(e.Contact || '—')}</dd>
                    <dt>Father's Name</dt><dd>${empEsc(e.FatherName || '—')}</dd>
                    <dt>Qualification</dt><dd>${empEsc(e.Qualification || '—')}</dd>
                    <dt>Certifications</dt><dd>${empEsc(e.Certifications || '—')}</dd>
                    <dt>Appointed On</dt><dd>${e.AppointedOn ? formatDate(e.AppointedOn) : '—'}</dd>
                    <dt>Team</dt>        <dd>${e.TeamID != null ? e.TeamID + (e.TeamName ? ' (' + empEsc(e.TeamName) + ')' : '') : '—'}</dd>
                    <dt>CV</dt>          <dd>${e.CVFile ? `<a href="${empEsc(e.CVFile)}" download>Download CV</a>` : '—'}</dd>
                </dl>
            </section>

            <section class="admin-detail-section">
                <h3>Attendance (recent)</h3>
                ${empAttendanceTable(attendance)}
            </section>

            <section class="admin-detail-section">
                <h3>Tasks</h3>
                ${empTasksTable(tasks)}
            </section>

            <section class="admin-detail-section">
                <h3>Issued inventory</h3>
                ${empInventoryTable(inventory)}
            </section>
        `;
    } catch (err) {
        panel.innerHTML = `<p class="text-center text-danger">${empEsc(err.message)}</p>`;
    }
}

function empAttendanceTable(rows) {
    if (!rows.length) return '<p class="text-muted">No attendance records</p>';
    return `<table class="table"><thead><tr>
        <th>Date</th><th>Login</th><th>Logout</th><th>Hours</th>
    </tr></thead><tbody>${rows.map(r => `
        <tr>
            <td>${r.Date ? formatDate(r.Date) : '—'}</td>
            <td>${r.LoginTime ? formatDateTime(r.LoginTime) : '—'}</td>
            <td>${r.LogoutTime ? formatDateTime(r.LogoutTime) : '—'}</td>
            <td>${r.TotalHours != null ? r.TotalHours : '—'}</td>
        </tr>`).join('')}</tbody></table>`;
}

function empTasksTable(rows) {
    if (!rows.length) return '<p class="text-muted">No tasks assigned</p>';
    return `<table class="table"><thead><tr>
        <th>Title</th><th>Status</th><th>Priority</th><th>Deadline</th><th>Assigned by</th>
    </tr></thead><tbody>${rows.map(t => `
        <tr>
            <td>${empEsc(t.Title)}</td>
            <td><span class="task-status ${(t.Status||'').toLowerCase().replace(' ','-')}">${empEsc(t.Status)}</span></td>
            <td>${empEsc(t.Priority || '—')}</td>
            <td>${t.Deadline ? formatDate(t.Deadline) : '—'}</td>
            <td>${empEsc(t.AssignedByName || '—')}</td>
        </tr>`).join('')}</tbody></table>`;
}

function empInventoryTable(rows) {
    if (!rows.length) return '<p class="text-muted">No inventory issued</p>';
    return `<table class="table"><thead><tr>
        <th>Item</th><th>Status</th><th>Issued</th><th>Returned</th><th>Desk</th>
    </tr></thead><tbody>${rows.map(i => `
        <tr>
            <td>${empEsc(i.ItemName)}</td>
            <td>${empEsc(i.Status)}</td>
            <td>${i.IssueDate ? formatDate(i.IssueDate) : '—'}</td>
            <td>${i.ReturnDate ? formatDate(i.ReturnDate) : '—'}</td>
            <td>${empEsc(i.DeskNo || '—')}</td>
        </tr>`).join('')}</tbody></table>`;
}

function empEsc(str) {
    if (str == null) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Employee Daily Task Logs ──────────────────────────────────────

// Time formatting helper
function formatTaskTime(timeValue) {
    if (!timeValue) return '';
    let timeStr = '';
    
    // ISO string
    if (typeof timeValue === 'string' && timeValue.includes('T')) {
        const dt = new Date(timeValue);
        if (!isNaN(dt)) {
            timeStr = dt.toISOString().slice(11, 16);
        }
    } else {
        // Already "HH:MM" or "HH:MM:SS"
        const m = String(timeValue).match(/(\d{2}:\d{2})/);
        timeStr = m ? m[1] : '';
    }
    
    // Convert to 12-hour format
    if (!timeStr || !timeStr.includes(':')) return '';
    const [hours, minutes] = timeStr.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const hours12 = hours % 12 || 12;
    return `${hours12}:${String(minutes).padStart(2, '0')} ${period}`;
}

async function loadLogsDropdown() {
    // Reuse the shared _allEmployees list if already loaded; otherwise fetch
    const sel = document.getElementById('logsEmpFilter');
    if (!sel) return;
    const populate = (emps) => {
        emps.forEach(e => {
            const opt = document.createElement('option');
            opt.value = e.EmployeeID;
            opt.textContent = `${e.Name}  (${e.Role || ''})`;
            sel.appendChild(opt);
        });
    };
    if (_allEmployees.length) { populate(_allEmployees); return; }
    try {
        const res = await apiCall('/admin/employees');
        populate(res?.employees || []);
    } catch (e) { console.warn('Logs dropdown:', e.message); }
}

function setupLogsPanel() {
    const tabToday   = document.getElementById('logsTabToday');
    const tabHistory = document.getElementById('logsTabHistory');
    const histFilters = document.getElementById('logsHistoryFilters');
    const dateInput  = document.getElementById('logsDateFilter');

    function activateTab(tab) {
        const isToday = tab === 'today';
        // Tab styles
        tabToday.style.color        = isToday ? '#2555c4' : '#64748b';
        tabToday.style.borderBottom = isToday ? '2px solid #2555c4' : '2px solid transparent';
        tabToday.style.fontWeight   = isToday ? '700' : '600';
        tabHistory.style.color        = !isToday ? '#2555c4' : '#64748b';
        tabHistory.style.borderBottom = !isToday ? '2px solid #2555c4' : '2px solid transparent';
        tabHistory.style.fontWeight   = !isToday ? '700' : '600';
        // Show/hide history filters
        histFilters.style.display = isToday ? 'none' : 'flex';
        if (isToday) {
            // Clear filters and load today
            if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
            const empSel = document.getElementById('logsEmpFilter');
            if (empSel) empSel.value = '';
            loadAdminLogs();
        }
    }

    tabToday?.addEventListener('click',   () => activateTab('today'));
    tabHistory?.addEventListener('click', () => activateTab('history'));

    document.getElementById('logsFilterBtn')?.addEventListener('click', loadAdminLogs);

    // Default: yesterday in history filter so date picker has a sensible value
    if (dateInput) {
        const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
        dateInput.value = yesterday.toISOString().split('T')[0];
    }

    // Load today on init
    activateTab('today');
}

async function loadAdminLogs() {
    const container = document.getElementById('logsAdminContainer');
    const tabToday  = document.getElementById('logsTabToday');
    const isToday   = tabToday && tabToday.style.fontWeight === '700';
    const date  = isToday
        ? new Date().toISOString().split('T')[0]
        : (document.getElementById('logsDateFilter')?.value || '');
    const empId = document.getElementById('logsEmpFilter')?.value || '';
    const params = new URLSearchParams();
    if (date)  params.set('date', date);
    if (empId) params.set('employeeId', empId);

    container.innerHTML = `<div style="text-align:center;padding:40px;color:#94a3b8;">⏳ Loading task logs...</div>`;

    try {
        const res  = await apiCall(`/admin/task-logs?${params}`);
        const logs = res?.logs || [];

        if (!logs.length) {
            container.innerHTML = `<div style="text-align:center;padding:40px;color:#94a3b8;">
                No task logs found for the selected filters.</div>`;
            return;
        }

        function statusClass(status) {
            if (!status) return 'status-pending';
            const s = status.toLowerCase();
            if (s === 'completed') return 'status-completed';
            if (s === 'in progress') return 'status-in-progress';
            if (s === 'on hold' || s === 'paused') return 'status-on-hold';
            if (s === 'delayed') return 'status-delayed';
            return 'status-pending';
        }

        // Group by employee
        const byEmp = {};
        logs.forEach(l => {
            if (!byEmp[l.EmployeeID]) byEmp[l.EmployeeID] = { name: l.EmployeeName, id: l.EmployeeID, logs: [] };
            byEmp[l.EmployeeID].logs.push(l);
        });

        container.innerHTML = Object.values(byEmp).map(emp => {
            const total   = emp.logs.length;
            const running = emp.logs.filter(l => l.Status === 'In Progress').length;
            const done    = emp.logs.filter(l => l.Status === 'Completed').length;
            const pending = emp.logs.filter(l => !l.Status || l.Status === 'To Be Started' || l.Status === 'Pending').length;
            const initials = (emp.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

            const chips = [
                `<span class="emp-chip chip-total">${total} task${total !== 1 ? 's' : ''}</span>`,
                running ? `<span class="emp-chip chip-running">▶ ${running} running</span>` : '',
                done    ? `<span class="emp-chip chip-done">✓ ${done} done</span>`           : '',
                pending ? `<span class="emp-chip chip-pending">○ ${pending} pending</span>`  : '',
            ].filter(Boolean).join('');

            const rows = emp.logs.map((l, i) => {
                const start = formatTaskTime(l.StartTime);
                const end   = formatTaskTime(l.EndTime);
                const dur   = (start && end) ? calcDuration(l.StartTime, l.EndTime) : null;
                const durHtml = dur
                    ? (dur.valid
                        ? `<span class="dur-badge">${dur.display}</span>`
                        : `<span style="color:#f59e0b;font-size:11px;">⏱ ${dur.display}</span>`)
                    : (l.Status === 'In Progress'
                        ? `<span style="color:#10b981;font-size:11px;font-weight:700;">● Live</span>`
                        : '—');
                const sClass = statusClass(l.Status);
                const sLabel = l.Status || 'To Be Started';
                const sIcon  = ({ Completed: '✓', 'In Progress': '▶', 'On Hold': '⏸', Paused: '⏸' })[l.Status] || '○';
                return `<tr>
                    <td style="color:#94a3b8;font-size:12px;font-weight:600;">${i + 1}</td>
                    <td>
                        <div class="task-activity-text">${empEsc(l.Activity || 'Personal Work')}</div>
                        ${l.Project ? `<div class="task-notes-text">📁 ${empEsc(l.Project)}</div>` : ''}
                        ${l.Client  ? `<div class="task-notes-text">🏢 ${empEsc(l.Client)}</div>`  : ''}
                        ${l.Notes   ? `<div class="task-notes-text">📝 ${empEsc(l.Notes)}</div>`   : ''}
                    </td>
                    <td><span class="status-pill ${sClass}">${sIcon} ${sLabel}</span></td>
                    <td class="time-cell">${start || '—'}</td>
                    <td class="time-cell">${end || (l.Status === 'In Progress' ? '<span style="color:#10b981;">ongoing</span>' : '—')}</td>
                    <td>${durHtml}</td>
                </tr>`;
            }).join('');

            return `<div class="emp-log-card">
                <div class="emp-log-head">
                    <div style="display:flex;align-items:center;gap:12px;">
                        <div class="emp-log-avatar">${initials}</div>
                        <div>
                            <div class="emp-log-name">${empEsc(emp.name || 'Unknown')}</div>
                            <div class="emp-log-meta">Employee #${emp.id}</div>
                        </div>
                    </div>
                    <div class="emp-log-chips">${chips}</div>
                </div>
                <table class="emp-task-table">
                    <thead><tr>
                        <th style="width:32px;">#</th>
                        <th>Activity / Project / Notes</th>
                        <th style="width:120px;">Status</th>
                        <th style="width:76px;">Start</th>
                        <th style="width:76px;">End</th>
                        <th style="width:76px;">Duration</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
        }).join('');

    } catch (e) {
        console.error('Failed to load admin logs:', e);
        container.innerHTML = `<div style="text-align:center;padding:20px;background:#fee2e2;border-radius:8px;color:#991b1b;">
            <div style="font-weight:bold;margin-bottom:8px;">❌ Error Loading Task Logs</div>
            <div style="font-size:13px;line-height:1.6;">${empEsc(e.message)}</div>
        </div>`;
    }
}

function calcDuration(startTime, endTime) {
    if (!startTime || !endTime) return { valid: false, display: 'Missing times' };
    
    try {
        let startStr = '';
        let endStr = '';
        
        // Extract HH:MM from various formats
        if (typeof startTime === 'string') {
            if (startTime.includes('T')) {
                // ISO format: "1970-01-01T09:30:00.000Z"
                const dt = new Date(startTime);
                if (!isNaN(dt)) startStr = dt.toISOString().slice(11, 16);
            } else {
                // Direct time format: "09:30:00" or "09:30"
                const match = startTime.match(/(\d{2}):(\d{2})/);
                if (match) startStr = match[0];
            }
        }
        
        if (typeof endTime === 'string') {
            if (endTime.includes('T')) {
                // ISO format: "1970-01-01T11:30:00.000Z"
                const dt = new Date(endTime);
                if (!isNaN(dt)) endStr = dt.toISOString().slice(11, 16);
            } else {
                // Direct time format: "11:30:00" or "11:30"
                const match = endTime.match(/(\d{2}):(\d{2})/);
                if (match) endStr = match[0];
            }
        }
        
        if (!startStr || !endStr) {
            console.warn('Duration calc: Could not parse times', { startTime, endTime, startStr, endStr });
            return { valid: false, display: 'Invalid time format' };
        }
        
        const [sh, sm] = startStr.split(':').map(Number);
        const [eh, em] = endStr.split(':').map(Number);
        const diff = (eh * 60 + em) - (sh * 60 + sm);
        
        // If same-day times are backwards
        if (diff < 0) {
            // Could be overnight task - if end time < start time by a lot, likely overnight
            // Example: 11 PM (23:00) to 2 AM (02:00) = -1260 minutes = ~21 hours overnight
            const absDiff = Math.abs(diff);
            const hrs = Math.floor(absDiff / 60);
            const mins = absDiff % 60;
            
            // If the difference is small (< 2 hours), it's likely data entry error
            if (absDiff < 120) {
                return { valid: false, isOvernight: false, display: 'End time is before start time' };
            }
            // If difference is large (likely overnight), calculate it as overnight
            return {
                valid: true,
                isOvernight: true,
                display: hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`
            };
        }
        
        // Diff is 0 or positive - same day
        if (diff === 0) {
            return { valid: false, isOvernight: false, display: 'Start and end times are the same' };
        }
        
        const hrs = Math.floor(diff / 60);
        const mins = diff % 60;
        return {
            valid: true,
            isOvernight: false,
            display: hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`
        };
    } catch (err) {
        console.error('Error calculating duration:', err, { startTime, endTime });
        return { valid: false, display: 'Error calculating duration' };
    }
}

function setupAttendanceUpload() {
    const form = document.getElementById('attendanceUploadForm');
    if (!form) return;

    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        const fileInput = document.getElementById('attendanceFile');
        if (!fileInput.files.length) {
            showMessage('Choose a CSV or Excel file', 'error', 'dashboardAdminMessage');
            return;
        }

        const formData = new FormData();
        formData.append('file', fileInput.files[0]);

        try {
            const response = await apiUpload('/attendance/upload', formData);
            if (response && response.success) {
                let msg = response.message;
                if (response.errors && response.errors.length) {
                    msg += ' ' + response.errors.slice(0, 3).join('; ');
                }
                showMessage(msg, 'success', 'dashboardAdminMessage');
                fileInput.value = '';
            }
        } catch (error) {
            showMessage(error.message, 'error', 'dashboardAdminMessage');
        }
    });
}

// ══ Attendance Records panel ════════════════════════════════════

function setupExportPanel() { /* replaced by setupAttendanceRecordsPanel — noop kept for compat */ }
function setupEmployeeExport() { /* replaced by setupEmployeeRecordsPanel — noop kept for compat */ }

function setupAttendanceRecordsPanel() {
    const now = new Date();
    const todayLocal  = localDateStr(now);
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

    // Set defaults
    const el = id => document.getElementById(id);
    if (el('attMonth'))    el('attMonth').value    = currentMonth;
    if (el('attAllDate'))  el('attAllDate').value  = todayLocal;
    if (el('attAllMonth')) el('attAllMonth').value = currentMonth;

    // Mode tabs
    _modeTabs('attModeTabSingle', 'attModeTabAll', 'attModeSingle', 'attModeAll');

    // All: sub-tabs (Day-wise / Monthly Summary)
    _expSubTabs('attAllTabDay', 'attAllTabMonth', 'attAllPanelDay', 'attAllPanelMonth');

    // Single: View
    el('attViewBtn')?.addEventListener('click', loadSingleAttendance);

    // Single: Export
    el('attExportSingleBtn')?.addEventListener('click', () => {
        const empId = el('attEmpSelect')?.value;
        const month = el('attMonth')?.value;
        if (!empId) { showMsg('attSingleMsg', 'Select an employee first.', 'error'); return; }
        if (!month) { showMsg('attSingleMsg', 'Select a month first.', 'error'); return; }
        downloadXlsx(`/admin/attendance/export?employeeId=${empId}&month=${month}`, 'attSingleMsg');
    });

    // All Day-wise: View
    el('attAllDayViewBtn')?.addEventListener('click', loadAllDayAttendance);

    // All Day-wise: Export
    el('attAllDayExportBtn')?.addEventListener('click', () => {
        const date = el('attAllDate')?.value;
        if (!date) { showMsg('attMsg', 'Select a date first.', 'error'); return; }
        downloadXlsx(`/admin/attendance/export?date=${date}`, 'attMsg');
    });

    // All Monthly: View summary
    el('attAllMonthViewBtn')?.addEventListener('click', loadAllMonthSummary);

    // All Monthly: Export full
    el('attAllMonthExportBtn')?.addEventListener('click', () => {
        const month = el('attAllMonth')?.value;
        if (!month) { showMsg('attMsg', 'Select a month first.', 'error'); return; }
        downloadXlsx(`/admin/attendance/export?month=${month}`, 'attMsg');
    });
}

async function loadSingleAttendance() {
    const empId = document.getElementById('attEmpSelect')?.value;
    const month = document.getElementById('attMonth')?.value;
    const wrap  = document.getElementById('attSingleTable');
    if (!wrap) return;
    if (!empId) { showMsg('attSingleMsg', 'Select an employee first.', 'error'); return; }
    if (!month) { showMsg('attSingleMsg', 'Select a month first.', 'error'); return; }

    wrap.innerHTML = '<p style="color:#94a3b8;padding:12px;">Loading…</p>';
    try {
        const res = await apiCall(`/admin/attendance/records?employeeId=${empId}&month=${month}`);
        const records = res?.records || [];
        if (!records.length) { wrap.innerHTML = '<p class="text-muted" style="padding:12px;">No attendance records for this month.</p>'; return; }

        const totalHours  = res.totalHours || '0.00';
        const daysPresent = res.daysPresent || 0;

        wrap.innerHTML = `
        <div style="display:flex;gap:16px;margin-bottom:12px;flex-wrap:wrap;">
            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:10px 18px;text-align:center;">
                <div style="font-size:22px;font-weight:900;color:#16a34a;">${daysPresent}</div>
                <div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;">Days Present</div>
            </div>
            <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:10px 18px;text-align:center;">
                <div style="font-size:22px;font-weight:900;color:#1d4ed8;">${totalHours}</div>
                <div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;">Total Hours</div>
            </div>
        </div>
        <table class="adm-summary-table">
            <thead><tr><th>Date</th><th>Login</th><th>Logout</th><th>Hours</th><th>Type</th><th>Status</th></tr></thead>
            <tbody>${records.map(r => {
                const isActive = r.LoginTime && !r.LogoutTime;
                const statusBadge = !r.LoginTime ? '<span class="adm-badge-absent">Absent</span>'
                    : isActive ? '<span class="adm-badge-present">Active</span>'
                    : '<span class="adm-badge-partial">Done</span>';
                return `<tr>
                    <td>${r.Date ? formatDate(r.Date) : '—'}</td>
                    <td class="time-cell">${r.LoginTime ? formatTime(r.LoginTime) : '—'}</td>
                    <td class="time-cell">${r.LogoutTime ? formatTime(r.LogoutTime) : '—'}</td>
                    <td>${r.TotalHours != null ? parseFloat(r.TotalHours).toFixed(2) + ' h' : '—'}</td>
                    <td>${empEsc(r.LoginType || (r.LoginTime ? 'Office' : '—'))}</td>
                    <td>${statusBadge}</td>
                </tr>`;
            }).join('')}</tbody>
        </table>`;
    } catch (e) {
        wrap.innerHTML = `<p class="text-danger" style="padding:12px;">${empEsc(e.message)}</p>`;
    }
}

async function loadAllDayAttendance() {
    const date = document.getElementById('attAllDate')?.value;
    const wrap = document.getElementById('attAllDayTable');
    if (!wrap) return;
    if (!date) { showMsg('attMsg', 'Select a date first.', 'error'); return; }

    wrap.innerHTML = '<p style="color:#94a3b8;padding:12px;">Loading…</p>';
    try {
        const res = await apiCall(`/admin/attendance/today-all?date=${date}`);
        const employees = res?.employees || [];
        if (!employees.length) { wrap.innerHTML = '<p class="text-muted" style="padding:12px;">No records found.</p>'; return; }

        const present = employees.filter(e => e.LoginTime).length;
        const absent  = employees.length - present;

        wrap.innerHTML = `
        <div style="display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap;">
            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:8px 16px;text-align:center;">
                <div style="font-size:20px;font-weight:900;color:#16a34a;">${present}</div>
                <div style="font-size:11px;color:#64748b;font-weight:600;">Present</div>
            </div>
            <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:8px 16px;text-align:center;">
                <div style="font-size:20px;font-weight:900;color:#dc2626;">${absent}</div>
                <div style="font-size:11px;color:#64748b;font-weight:600;">Absent</div>
            </div>
        </div>
        <table class="adm-summary-table">
            <thead><tr><th>Name</th><th>Role</th><th>Login</th><th>Logout</th><th>Hours</th><th>Type</th><th>Status</th></tr></thead>
            <tbody>${employees.map(e => {
                const statusBadge = !e.LoginTime ? '<span class="adm-badge-absent">Absent</span>'
                    : !e.LogoutTime ? '<span class="adm-badge-present">Active</span>'
                    : '<span class="adm-badge-partial">Done</span>';
                return `<tr>
                    <td style="font-weight:600;">${empEsc(e.Name)}</td>
                    <td>${empEsc(e.Role || '—')}</td>
                    <td class="time-cell">${e.LoginTime ? formatTime(e.LoginTime) : '—'}</td>
                    <td class="time-cell">${e.LogoutTime ? formatTime(e.LogoutTime) : '—'}</td>
                    <td>${e.TotalHours != null ? parseFloat(e.TotalHours).toFixed(2) + ' h' : '—'}</td>
                    <td>${empEsc(e.LoginType || (e.LoginTime ? 'Office' : '—'))}</td>
                    <td>${statusBadge}</td>
                </tr>`;
            }).join('')}</tbody>
        </table>`;
    } catch (e) {
        wrap.innerHTML = `<p class="text-danger" style="padding:12px;">${empEsc(e.message)}</p>`;
    }
}

async function loadAllMonthSummary() {
    const month = document.getElementById('attAllMonth')?.value;
    const wrap  = document.getElementById('attAllMonthTable');
    if (!wrap) return;
    if (!month) { showMsg('attMsg', 'Select a month first.', 'error'); return; }

    wrap.innerHTML = '<p style="color:#94a3b8;padding:12px;">Loading…</p>';
    try {
        const res = await apiCall(`/admin/attendance/summary?month=${month}`);
        const employees = res?.employees || [];
        if (!employees.length) { wrap.innerHTML = '<p class="text-muted" style="padding:12px;">No records found.</p>'; return; }

        const totalDays = employees.reduce((s, e) => s + (e.DaysPresent || 0), 0);
        const totalHrs  = employees.reduce((s, e) => s + (parseFloat(e.TotalHours) || 0), 0);

        wrap.innerHTML = `
        <div style="display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap;">
            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:8px 16px;text-align:center;">
                <div style="font-size:20px;font-weight:900;color:#16a34a;">${employees.filter(e=>e.DaysPresent>0).length}</div>
                <div style="font-size:11px;color:#64748b;font-weight:600;">Employees Present</div>
            </div>
            <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:8px 16px;text-align:center;">
                <div style="font-size:20px;font-weight:900;color:#1d4ed8;">${totalHrs.toFixed(1)}</div>
                <div style="font-size:11px;color:#64748b;font-weight:600;">Total Hours</div>
            </div>
        </div>
        <table class="adm-summary-table">
            <thead><tr><th>Name</th><th>Role / Designation</th><th>Team</th><th>Days Present</th><th>Total Hours</th><th>Status</th></tr></thead>
            <tbody>${employees.map(e => {
                const days = e.DaysPresent || 0;
                const badge = days === 0 ? '<span class="adm-badge-absent">No records</span>'
                    : '<span class="adm-badge-present">Active</span>';
                return `<tr>
                    <td style="font-weight:600;">${empEsc(e.Name)}</td>
                    <td>${empEsc(e.Designation || e.Role || '—')}</td>
                    <td>${empEsc(e.TeamName || '—')}</td>
                    <td style="font-weight:700;color:#1d4ed8;">${days}</td>
                    <td>${parseFloat(e.TotalHours || 0).toFixed(2)} h</td>
                    <td>${badge}</td>
                </tr>`;
            }).join('')}</tbody>
        </table>`;
    } catch (e) {
        wrap.innerHTML = `<p class="text-danger" style="padding:12px;">${empEsc(e.message)}</p>`;
    }
}

// ── Shared utilities ─────────────────────────────────────────────

function localDateStr(d) {
    d = d || new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function showMsg(elId, text, type) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = text; el.className = `message ${type}`; el.style.display = 'block';
    if (type === 'success') setTimeout(() => { el.style.display = 'none'; }, 4000);
}

async function downloadXlsx(endpoint, msgElId, fallbackFilename) {
    const msgEl = document.getElementById(msgElId);
    if (msgEl) msgEl.style.display = 'none';
    try {
        const url = `${resolveApiBaseUrl()}${endpoint}`;
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) { const e = await response.json().catch(() => ({})); throw new Error(e.error || `Server error ${response.status}`); }
        const disp = response.headers.get('Content-Disposition') || '';
        const match = disp.match(/filename="?([^"]+)"?/);
        const filename = match ? match[1] : (fallbackFilename || 'export.xlsx');
        const blob = await response.blob();
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
        if (msgEl) showMsg(msgElId, `Downloaded: ${filename}`, 'success');
    } catch (err) {
        if (msgEl) showMsg(msgElId, err.message, 'error');
        else alert(err.message);
    }
}

function _modeTabs(tabSingleId, tabAllId, panSingleId, panAllId) {
    const ts = document.getElementById(tabSingleId);
    const ta = document.getElementById(tabAllId);
    const ps = document.getElementById(panSingleId);
    const pa = document.getElementById(panAllId);
    if (!ts || !ta) return;
    ts.addEventListener('click', () => { ts.classList.add('adm-mode-active'); ta.classList.remove('adm-mode-active'); ps.style.display = ''; pa.style.display = 'none'; });
    ta.addEventListener('click', () => { ta.classList.add('adm-mode-active'); ts.classList.remove('adm-mode-active'); pa.style.display = ''; ps.style.display = 'none'; });
}

function _expSubTabs(t1Id, t2Id, p1Id, p2Id) {
    const t1 = document.getElementById(t1Id), t2 = document.getElementById(t2Id);
    const p1 = document.getElementById(p1Id), p2 = document.getElementById(p2Id);
    if (!t1 || !t2) return;
    t1.addEventListener('click', () => { t1.classList.add('exp-tab-active'); t2.classList.remove('exp-tab-active'); p1.style.display = ''; p2.style.display = 'none'; });
    t2.addEventListener('click', () => { t2.classList.add('exp-tab-active'); t1.classList.remove('exp-tab-active'); p2.style.display = ''; p1.style.display = 'none'; });
}

// ── Admin attendance widget ───────────────────────────────────────

async function loadAdminAttendance() {
    const btn    = document.getElementById('adminAttBtn');
    const status = document.getElementById('adminAttStatus');
    const timeEl = document.getElementById('adminAttTime');
    if (!btn) return;

    try {
        const res = await apiCall('/attendance/today');
        const rec = res?.record || null;
        renderAdminAttendance(rec);
        btn.disabled = false;
        btn.onclick = handleAdminAttendanceToggle;
    } catch (e) {
        if (status) { status.textContent = 'Unavailable'; status.style.color = '#ef4444'; }
        btn.textContent = 'Retry';
        btn.disabled = false;
        btn.onclick = loadAdminAttendance;
    }
}

function renderAdminAttendance(rec) {
    const status = document.getElementById('adminAttStatus');
    const timeEl = document.getElementById('adminAttTime');
    const btn    = document.getElementById('adminAttBtn');
    if (!status || !btn) return;

    if (!rec) {
        status.textContent = 'Not clocked in'; status.style.color = '#64748b';
        timeEl.textContent = '';
        btn.textContent = 'Clock In';
    } else if (!rec.LogoutTime) {
        status.textContent = 'Clocked In'; status.style.color = '#16a34a';
        timeEl.textContent = `Since ${formatTime(rec.LoginTime)}`;
        btn.textContent = 'Clock Out';
    } else {
        status.textContent = 'Done for today'; status.style.color = '#64748b';
        timeEl.textContent = `${formatTime(rec.LoginTime)} – ${formatTime(rec.LogoutTime)}`;
        btn.textContent = 'Clock In Again';
    }
}

async function handleAdminAttendanceToggle() {
    const btn  = document.getElementById('adminAttBtn');
    const msgEl = document.getElementById('adminAttMsg');
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = '…';
    if (msgEl) msgEl.style.display = 'none';

    const now = new Date();
    const y = now.getFullYear(), m = String(now.getMonth()+1).padStart(2,'0'), d = String(now.getDate()).padStart(2,'0');
    const body = { clientDate: `${y}-${m}-${d}`, clientTime: now.toISOString() };

    try {
        const res = await apiCall('/attendance/toggle', { method: 'POST', body: JSON.stringify(body) });
        if (res?.success) {
            renderAdminAttendance(res.record);
            loadAdminStats();
        } else {
            throw new Error(res?.error || 'Toggle failed');
        }
    } catch (e) {
        if (msgEl) { msgEl.textContent = e.message; msgEl.className = 'message error'; msgEl.style.display = 'block'; }
        btn.textContent = orig;
    } finally {
        btn.disabled = false;
        btn.onclick = handleAdminAttendanceToggle;
    }
}
