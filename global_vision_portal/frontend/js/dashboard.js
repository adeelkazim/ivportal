/* Employee dashboard only — admins use admin-dashboard.html */

// Task datasets
let _assignedToMe = [];   // tasks assigned TO this employee
let _iAssigned    = [];   // tasks assigned BY this employee to others
let _roleMap      = {};   // employeeId → role  (from /employees/directory)

document.addEventListener('DOMContentLoaded', function () {
    checkAuth();
    if (isAdmin()) { window.location.replace('admin-dashboard.html'); return; }
    initializeDashboard();
});

async function initializeDashboard() {
    const user = getUser();
    if (!user) { window.location.href = 'login.html'; return; }

    document.getElementById('employeeName').textContent = user.Name;
    document.getElementById('employeeRole').textContent = user.Role;

    await refreshDashboardData();

    const attendanceBtn = document.getElementById('attendanceBtn');
    if (attendanceBtn) attendanceBtn.addEventListener('click', handleAttendanceToggle);

    document.getElementById('filterRole').addEventListener('change', applyTaskFilters);
    document.getElementById('filterView').addEventListener('change', applyTaskFilters);
    document.getElementById('filterStatus').addEventListener('change', applyTaskFilters);
    document.getElementById('filterDate').addEventListener('change', applyTaskFilters);
    document.getElementById('btnClearFilters').addEventListener('click', clearTaskFilters);
    initActModal();

    // Re-fetch tasks whenever the employee returns to this tab
    // (e.g. after completing a task in task-log.html)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            loadTasksSummary(getUser().EmployeeID);
        }
    });
}

async function refreshDashboardData() {
    const id = getUser().EmployeeID;
    await Promise.all([
        loadAttendanceStatus(id),
        loadTasksSummary(id),
        loadInventorySummary(id),
        loadQuickStats(id)
    ]);
}

// ── Helpers ───────────────────────────────────────────────

function localISODate(val) {
    if (!val) return null;
    const d = new Date(val);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Attendance ────────────────────────────────────────────

async function loadAttendanceStatus(employeeId) {
    try {
        if (isValidJwt(getToken())) {
            const res = await apiCall('/attendance/today');
            if (res) { renderAttendance(res.record); return; }
        }
    } catch (e) { console.warn('Attendance API:', e.message); }

    const attendance = JSON.parse(localStorage.getItem('attendance') || '[]');
    const today = new Date().toISOString().split('T')[0];
    renderAttendance(attendance.find(a => a.EmployeeID === employeeId && a.Date === today));
}

function renderAttendance(rec) {
    const statusEl = document.getElementById('attendanceStatus');
    const timeEl   = document.getElementById('attendanceTime');
    const statEl   = document.getElementById('todayStatus');
    const btn      = document.getElementById('attendanceBtn');

    if (rec) {
        if (rec.LogoutTime) {
            statusEl.textContent = 'Logged Out'; statusEl.className = 'text-danger';
            timeEl.textContent = `Login: ${formatTime(rec.LoginTime)} | Logout: ${formatTime(rec.LogoutTime)}`;
            if (btn) btn.textContent = 'Login';
            statEl.textContent = 'Completed';
        } else {
            statusEl.textContent = 'Currently Logged In'; statusEl.className = 'text-success';
            timeEl.textContent = `Logged in at: ${formatTime(rec.LoginTime)}`;
            if (btn) btn.textContent = 'Logout';
            statEl.textContent = 'Active';
        }
    } else {
        statusEl.textContent = 'Not logged in'; statusEl.className = '';
        timeEl.textContent = '';
        if (btn) btn.textContent = 'Login';
        statEl.textContent = 'Not Started';
    }
}

function clientDateTimeBody() {
    const now = new Date();
    // Local date string YYYY-MM-DD (avoids UTC midnight date mismatch on server)
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return { clientDate: `${y}-${m}-${d}`, clientTime: now.toISOString() };
}

async function handleAttendanceToggle() {
    try {
        if (isValidJwt(getToken())) {
            const res = await apiCall('/attendance/toggle', { method: 'POST', body: JSON.stringify(clientDateTimeBody()) });
            if (res && res.success) { await refreshDashboardData(); return; }
        }
    } catch (e) { console.warn('Attendance toggle:', e.message); }

    const user       = getUser();
    const attendance = JSON.parse(localStorage.getItem('attendance') || '[]');
    const today      = new Date().toISOString().split('T')[0];
    let rec = attendance.find(a => a.EmployeeID === user.EmployeeID && a.Date === today);
    if (!rec) {
        attendance.push({ EmployeeID: user.EmployeeID, Date: today, LoginTime: new Date().toISOString() });
    } else if (!rec.LogoutTime) {
        rec.LogoutTime = new Date().toISOString();
    }
    localStorage.setItem('attendance', JSON.stringify(attendance));
    await refreshDashboardData();
}

// ── Tasks ─────────────────────────────────────────────────

async function loadTasksSummary(employeeId) {
    if (!isValidJwt(getToken())) return;

    const id = employeeId || getUser().EmployeeID;

    // 1. Build employee → role map for reliable role lookup
    try {
        const dirRes = await apiCall('/employees/directory');
        (dirRes && dirRes.employees || []).forEach(e => {
            _roleMap[e.EmployeeID] = e.Role || '';
        });
    } catch (e) { console.warn('Employee directory:', e.message); }

    // 2. Fetch "assigned to me" — separate catch so it never blocks the other
    try {
        const res = await apiCall(`/tasks?assignedTo=${id}`);
        _assignedToMe = enrichRoles((res && res.tasks) || []);
    } catch (e) {
        console.warn('Tasks (assignedTo):', e.message);
        _assignedToMe = [];
    }

    // 3. Fetch "I assigned to someone else"
    try {
        const res = await apiCall(`/tasks?assignedBy=${id}`);
        _iAssigned = enrichRoles((res && res.tasks) || []);
    } catch (e) {
        console.warn('Tasks (assignedBy):', e.message);
        _iAssigned = [];
    }

    // Active task count (not yet complete) — includes legacy 'Pending'
    const pendingCount = _assignedToMe.filter(t =>
        t.Status === 'To Be Started' || t.Status === 'Pending' || t.Status === 'In Progress'
    ).length;
    document.getElementById('pendingTasks').textContent = pendingCount;

    renderAssignSummary(_assignedToMe);
    buildRoleFilterOptions();   // built from both datasets
    renderTaskTable(_assignedToMe);
}

// Fill AssignedByRole from our local role map when backend didn't send it
function enrichRoles(tasks) {
    return tasks.map(t => {
        if (!t.AssignedByRole && t.AssignedBy && _roleMap[t.AssignedBy]) {
            t.AssignedByRole = _roleMap[t.AssignedBy];
        }
        return t;
    });
}

// Build role dropdown from combined task data — only real values
function buildRoleFilterOptions() {
    const allRoles = new Set();
    [..._assignedToMe, ..._iAssigned].forEach(t => {
        if (t.AssignedByRole) allRoles.add(t.AssignedByRole.trim());
    });

    const current = document.getElementById('filterRole').value;
    const options = ['<option value="">All Roles</option>'];
    [...allRoles].sort().forEach(r => {
        options.push(`<option value="${r}"${r === current ? ' selected' : ''}>${r}</option>`);
    });
    document.getElementById('filterRole').innerHTML = options.join('');
}

function activeDataset() {
    return document.getElementById('filterView').value === 'i-assigned'
        ? _iAssigned
        : _assignedToMe;
}

function applyTaskFilters() {
    const roleFilter   = document.getElementById('filterRole').value.trim();
    const viewFilter   = document.getElementById('filterView').value;
    const statusFilter = document.getElementById('filterStatus').value;
    const dateFilter   = document.getElementById('filterDate').value;

    let filtered = activeDataset().slice();

    if (roleFilter) {
        filtered = filtered.filter(t =>
            (t.AssignedByRole || '').trim().toLowerCase() === roleFilter.toLowerCase()
        );
    }

    if (statusFilter) {
        filtered = filtered.filter(t => {
            const s = t.Status === 'Pending' ? 'To Be Started' : (t.Status || '');
            // "Running" = tasks currently In Progress (activity log is running)
            if (statusFilter === 'Running') return s === 'In Progress';
            return s === statusFilter;
        });
    }

    if (dateFilter) {
        filtered = filtered.filter(t => localISODate(t.CreatedAt) === dateFilter);
    }

    const hasFilter = roleFilter || statusFilter || dateFilter || viewFilter === 'i-assigned';
    const countEl   = document.getElementById('filterResultCount');
    const clearBtn  = document.getElementById('btnClearFilters');
    if (hasFilter) {
        document.getElementById('filterCount').textContent = filtered.length;
        countEl.style.display = '';
        if (clearBtn) clearBtn.style.display = '';
    } else {
        countEl.style.display = 'none';
        if (clearBtn) clearBtn.style.display = 'none';
    }

    renderTaskTable(filtered);
}

function clearTaskFilters() {
    document.getElementById('filterRole').value   = '';
    document.getElementById('filterView').value   = 'assigned-to-me';
    document.getElementById('filterStatus').value = '';
    document.getElementById('filterDate').value   = '';
    document.getElementById('filterResultCount').style.display = 'none';
    document.getElementById('btnClearFilters').style.display   = 'none';
    renderTaskTable(_assignedToMe);
}

function renderAssignSummary(tasks) {
    const summaryEl     = document.getElementById('taskAssignSummary');
    const totalBadge    = document.getElementById('taskTotalBadge');
    const assignersList = document.getElementById('taskAssignersList');

    // Only count active tasks (not completed or on-hold)
    const active = tasks.filter(t =>
        t.Status === 'In Progress' || t.Status === 'To Be Started' || t.Status === 'Pending'
    );

    if (!active.length) { summaryEl.style.display = 'none'; return; }

    const byAssigner = {};
    active.forEach(t => {
        const name = t.AssignedByName || 'Unknown';
        byAssigner[name] = (byAssigner[name] || 0) + 1;
    });

    totalBadge.textContent = active.length + (active.length === 1 ? ' task' : ' tasks');
    assignersList.innerHTML = Object.entries(byAssigner)
        .map(([name, count]) =>
            `<span style="background:#e0f2fe;color:#0369a1;font-size:12px;font-weight:600;
                          padding:3px 10px;border-radius:20px;white-space:nowrap;">
                ${name}: ${count}
             </span>`)
        .join('');
    summaryEl.style.display = '';
}

const PRIORITY_ORDER  = { 'High': 1, 'Medium': 2, 'Low': 3 };
const SEEN_TASKS_KEY  = 'gvp_seenTaskIds';

function getSeenTaskIds() {
    try { return new Set(JSON.parse(localStorage.getItem(SEEN_TASKS_KEY) || '[]')); }
    catch { return new Set(); }
}

function markTasksSeen(ids) {
    try {
        const seen = getSeenTaskIds();
        ids.forEach(id => seen.add(id));
        localStorage.setItem(SEEN_TASKS_KEY, JSON.stringify([...seen]));
    } catch {}
}

function sortTasks(tasks) {
    return [...tasks].sort((a, b) => {
        const pa = PRIORITY_ORDER[a.Priority] || 4;
        const pb = PRIORITY_ORDER[b.Priority] || 4;
        if (pa !== pb) return pa - pb;
        const da = a.Deadline ? new Date(a.Deadline) : new Date('2099-12-31');
        const db = b.Deadline ? new Date(b.Deadline) : new Date('2099-12-31');
        return da - db;
    });
}

function renderTaskTable(tasks) {
    const tasksBody = document.getElementById('tasksBody');
    const view      = document.getElementById('filterView').value;

    if (!tasks.length) {
        const msg = view === 'i-assigned'
            ? 'You have not assigned any tasks to others yet'
            : 'No tasks match the selected filters';
        tasksBody.innerHTML = `<tr><td colspan="7" class="text-center"
            style="color:#94a3b8;padding:28px;">${msg}</td></tr>`;
        return;
    }

    const sorted   = sortTasks(tasks);
    const seenIds  = getSeenTaskIds();
    const freshIds = []; // task IDs that are new to this employee

    tasksBody.innerHTML = sorted.map(task => {
        const displayStatus = task.Status === 'Pending' ? 'To Be Started' : (task.Status || '');
        const statusClass   = displayStatus.toLowerCase().replace(/\s+/g, '-');
        const priorityClass = (task.Priority || '').toLowerCase();

        // NEW = task ID not yet in seen list (first time employee sees it)
        const isNew = !seenIds.has(task.TaskID);
        if (isNew) freshIds.push(task.TaskID);

        const nameCol = view === 'i-assigned'
            ? (task.AssignedToName || '—')
            : (task.AssignedByName || '—');

        const roleLabel = task.AssignedByRole
            ? `<small style="display:block;margin-top:2px;font-size:11px;color:#64748b;">
                   ${task.AssignedByRole}
               </small>`
            : '';

        const newBadge   = isNew ? `<span class="task-new-badge">NEW</span>` : '';
        const assignedDate = task.CreatedAt ? formatDate(task.CreatedAt) : '—';
        const rowClass     = isNew ? ' class="task-row-new"' : '';
        const isCompleted  = task.Status === 'Completed';
        const isInProgress = task.Status === 'In Progress';
        let playBtn;
        if (view === 'i-assigned' || isCompleted) {
            playBtn = `<a href="task-log.html?taskId=${task.TaskID}&taskTitle=${encodeURIComponent(task.Title)}" class="row-play-btn" title="View in Daily Task Log">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg> Log
            </a>`;
        } else if (isInProgress) {
            playBtn = `<button class="row-play-btn row-act-start" style="background:linear-gradient(135deg,#f59e0b,#d97706);" data-task-id="${task.TaskID}" data-task-title="${task.Title.replace(/"/g,'&quot;')}" title="Add another activity for this task">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg> Resume
            </button>`;
        } else {
            playBtn = `<button class="row-play-btn row-act-start" data-task-id="${task.TaskID}" data-task-title="${task.Title.replace(/"/g,'&quot;')}" title="Start activity for this task">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg> Start
            </button>`;
        }

        return `<tr${rowClass} data-task-id="${task.TaskID}">
            <td style="font-weight:600;color:#1e293b;">${task.Title} ${newBadge}</td>
            <td><span class="task-status ${statusClass}" data-status-cell="${task.TaskID}">${displayStatus}</span></td>
            <td>
                <span style="font-weight:600;color:#1e293b;">${nameCol}</span>
                ${view !== 'i-assigned' ? roleLabel : ''}
            </td>
            <td style="color:#475569;">${assignedDate}</td>
            <td style="color:#475569;">${formatDate(task.Deadline)}</td>
            <td><span class="priority ${priorityClass}">${task.Priority || '—'}</span></td>
            <td style="text-align:center;">${playBtn}</td>
        </tr>`;
    }).join('');

    // After 4 s: fade out badges and mark tasks as seen in localStorage
    if (freshIds.length) {
        const newRows = tasksBody.querySelectorAll('.task-row-new');
        setTimeout(() => {
            markTasksSeen(freshIds);
            newRows.forEach(row => {
                row.style.transition = 'background 1s ease';
                row.classList.remove('task-row-new');
                const badge = row.querySelector('.task-new-badge');
                if (badge) {
                    badge.style.transition = 'opacity .8s ease';
                    badge.style.opacity    = '0';
                    setTimeout(() => badge.remove(), 800);
                }
            });
        }, 4000);
    }
}

// ── Inventory ─────────────────────────────────────────────

async function loadInventorySummary(employeeId) {
    let userItems = [];
    try {
        if (isValidJwt(getToken())) {
            const res = await apiCall('/inventory');
            userItems = (res && res.items) || [];
        }
    } catch (e) { console.warn('Inventory API:', e.message); }

    document.getElementById('itemsIssued').textContent = userItems.length;
    const inventoryBody = document.getElementById('inventoryBody');

    if (userItems.length > 0) {
        inventoryBody.innerHTML = userItems.slice(0, 5).map(item => `
            <tr>
                <td>${item.ItemName}</td>
                <td>${item.IssueDate ? formatDate(item.IssueDate) : 'N/A'}</td>
                <td><span class="task-status pending">${item.Status}</span></td>
            </tr>
        `).join('');
    } else {
        inventoryBody.innerHTML = '<tr><td colspan="3" class="text-center">No items issued</td></tr>';
    }
}

// ── Quick stats ───────────────────────────────────────────

async function loadQuickStats(employeeId) {
    try {
        if (isValidJwt(getToken())) {
            const res = await apiCall('/attendance/stats');
            if (res && res.monthlyHours !== undefined) {
                document.getElementById('monthlyHours').textContent =
                    parseFloat(res.monthlyHours).toFixed(1) + ' hrs';
                return;
            }
        }
    } catch (e) { console.warn('Stats API:', e.message); }

    const user       = getUser();
    const attendance = JSON.parse(localStorage.getItem('attendance') || '[]');
    const month      = new Date().getMonth();
    const year       = new Date().getFullYear();
    let total = 0;

    attendance.forEach(r => {
        const d = new Date(r.Date);
        if (d.getMonth() === month && d.getFullYear() === year &&
            r.EmployeeID === user.EmployeeID && r.LogoutTime) {
            total += (new Date(r.LogoutTime) - new Date(r.LoginTime)) / 3600000;
        }
    });

    document.getElementById('monthlyHours').textContent = total.toFixed(1) + ' hrs';
}

// ── Activity starter modal ─────────────────────────────────────────

let _actModalTaskId    = null;
let _actModalTaskTitle = null;

function openActModal(taskId, taskTitle) {
    _actModalTaskId    = taskId || null;
    _actModalTaskTitle = taskTitle || null;

    const modal    = document.getElementById('actStartModal');
    const title    = document.getElementById('actModalTitle');
    const subtitle = document.getElementById('actModalSubtitle');
    const desc     = document.getElementById('actModalDesc');
    const startBtn = document.getElementById('actModalStart');

    if (taskId && taskTitle) {
        title.textContent    = 'Start Activity';
        subtitle.textContent = taskTitle;
        desc.value           = taskTitle;
    } else {
        title.textContent    = 'Start New Activity';
        subtitle.textContent = 'This activity will be tracked in your Daily Log';
        desc.value           = '';
        desc.placeholder     = 'What are you working on?';
    }

    startBtn.disabled = false;
    startBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" style="width:13px;height:13px;flex-shrink:0;"><polygon points="5 3 19 12 5 21"/></svg> Start Activity`;
    modal.classList.add('open');
    setTimeout(() => desc.focus(), 80);
}

function closeActModal() {
    document.getElementById('actStartModal').classList.remove('open');
    _actModalTaskId    = null;
    _actModalTaskTitle = null;
}

async function submitActModal() {
    const descEl  = document.getElementById('actModalDesc');
    const desc    = (descEl ? descEl.value.trim() : '') || 'PERSONAL WORK';
    const startBtn = document.getElementById('actModalStart');
    if (startBtn) { startBtn.disabled = true; startBtn.textContent = 'Creating…'; }

    try {
        // Step 1 — create a blank activity slot
        const created = await apiCall('/task-logs/new-activity', { method: 'POST' });
        const logId   = created.log.LogID;

        // Step 2 — save description and link task (works even if server is old)
        if (startBtn) startBtn.textContent = 'Linking…';
        const descBody = { activity: desc };
        if (_actModalTaskId) descBody.taskId = _actModalTaskId;
        await apiCall(`/task-logs/${logId}/description`, {
            method: 'POST',
            body: JSON.stringify(descBody)
        });

        // Step 3 — start activity
        if (startBtn) startBtn.textContent = 'Starting…';
        await apiCall(`/task-logs/${logId}/start`, { method: 'POST' });

        // Step 4 — directly update task status (reliable regardless of TaskID linking)
        if (_actModalTaskId) {
            // Persist so task-log.html can update task status even if navigated directly later
            sessionStorage.setItem('gvp_activeTaskId', String(_actModalTaskId));

            try {
                await apiCall(`/tasks/${_actModalTaskId}`, {
                    method: 'PUT',
                    body: JSON.stringify({ Status: 'In Progress' })
                });
            } catch (e) { console.warn('Task status sync:', e.message); }

            // Update task row live in the DOM
            const cell = document.querySelector(`[data-status-cell="${_actModalTaskId}"]`);
            if (cell) {
                cell.textContent = 'In Progress';
                cell.className   = 'task-status in-progress';
            }
            // Update local data so re-render/filters stay consistent
            const task = _assignedToMe.find(t => t.TaskID === _actModalTaskId);
            if (task) task.Status = 'In Progress';
            // Re-render the row so the button changes from "Start" → "Resume"
            renderTaskTable(activeDataset());
        }

        closeActModal();
        const dest = _actModalTaskId
            ? `task-log.html?taskId=${_actModalTaskId}&taskTitle=${encodeURIComponent(_actModalTaskTitle || '')}`
            : 'task-log.html';
        window.location.href = dest;
    } catch (e) {
        if (startBtn) {
            startBtn.disabled = false;
            startBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" style="width:13px;height:13px;flex-shrink:0;"><polygon points="5 3 19 12 5 21"/></svg> Start Activity`;
        }
        alert('Could not start activity: ' + (e.message || 'Unknown error'));
    }
}

function initActModal() {
    document.getElementById('actModalCancel')?.addEventListener('click', closeActModal);
    document.getElementById('actModalStart')?.addEventListener('click', submitActModal);
    document.getElementById('actStartModal')?.addEventListener('click', e => {
        if (e.target === document.getElementById('actStartModal')) closeActModal();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeActModal();
    });

    // Section-level "New Activity" button
    document.getElementById('btnDashNewActivity')?.addEventListener('click', () => openActModal(null, null));

    // Per-row play buttons (delegated — rows are rendered dynamically)
    document.getElementById('tasksBody')?.addEventListener('click', e => {
        const btn = e.target.closest('.row-act-start');
        if (!btn) return;
        const taskId    = parseInt(btn.dataset.taskId, 10);
        const taskTitle = btn.dataset.taskTitle;
        openActModal(taskId, taskTitle);
    });
}
