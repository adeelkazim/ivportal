/* ── Admin Employee Overview ─────────────────────────────── */

let allEmployees = [];
let selectedEmployeeId = null;
let currentTaskView = 'card'; // card, timeline, or kanban
const AVATAR_COLORS = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ef4444','#0ea5e9','#ec4899','#14b8a6'];

document.addEventListener('DOMContentLoaded', function () {
    checkAuth();
    if (!isManagerOrAdmin()) { window.location.href = 'dashboard.html'; return; }
    loadEmployeeList();
    document.getElementById('employeeSearch')?.addEventListener('input', applyListFilters);
});

// ── Sidebar list ──────────────────────────────────────────

async function loadEmployeeList() {
    try {
        const res = await apiCall('/admin/employees');
        allEmployees = (res && res.employees) || [];
        renderEmployeeList(allEmployees);
    } catch (err) {
        document.getElementById('employeeList').innerHTML =
            `<li style="padding:16px;color:#ef4444;font-size:13px;">${ee(err.message)}</li>`;
    }
}

function applyListFilters() {
    const q = (document.getElementById('employeeSearch')?.value || '').toLowerCase();
    let filtered = allEmployees;
    if (q) filtered = filtered.filter(e =>
        (e.Name || '').toLowerCase().includes(q) ||
        (e.Email || '').toLowerCase().includes(q) ||
        String(e.EmployeeID).includes(q)
    );
    renderEmployeeList(filtered);
}

function renderEmployeeList(employees) {
    const listEl = document.getElementById('employeeList');
    if (!listEl) return;
    if (!employees.length) {
        listEl.innerHTML = '<li style="padding:20px;color:#94a3b8;font-size:13px;text-align:center;">No employees found</li>';
        return;
    }
    listEl.innerHTML = employees.map(emp => {
        const color     = avatarColor(emp.EmployeeID);
        const roleClass = emp.Role === 'Manager' ? 'role-manager' : emp.Role === 'Admin' ? 'role-admin' : 'role-employee';
        const isActive  = selectedEmployeeId === emp.EmployeeID;
        return `
        <li class="emp-list-item ${isActive ? 'active' : ''}" data-id="${emp.EmployeeID}">
            ${avatarHtml(emp.profileImageUrl || null, emp.Name, 'emp-avatar-sm', color)}
            <div class="emp-list-info">
                <div class="emp-list-name">${ee(emp.Name)}</div>
                <div class="emp-list-meta">${ee(emp.ClientName || emp.clientName || emp.Role || '')}</div>
            </div>
            <span class="emp-role-badge ${roleClass}">${ee(emp.Role)}</span>
        </li>`;
    }).join('');
    listEl.querySelectorAll('.emp-list-item').forEach(li => {
        li.addEventListener('click', () => loadEmployeeDetail(parseInt(li.dataset.id, 10)));
    });
}

// ── Detail panel ──────────────────────────────────────────

async function loadEmployeeDetail(employeeId) {
    selectedEmployeeId = employeeId;
    applyListFilters();

    const panel = document.getElementById('employeeDetailPanel');
    panel.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;min-height:400px;color:#94a3b8;font-size:14px;">Loading…</div>`;

    try {
        const res = await apiCall(`/admin/employees/${employeeId}`);
        if (!res || !res.success) throw new Error('Failed to load employee');

        const e          = res.employee;
        const attendance = res.attendance  || [];
        const tasks      = res.tasks       || [];
        const inventory  = res.inventory   || [];

        const color = avatarColor(e.EmployeeID);

        // Quick stats
        const daysPresent  = attendance.filter(r => r.LoginTime).length;
        const totalHours   = attendance.reduce((s, r) => s + (parseFloat(r.TotalHours) || 0), 0);
        const pendingTasks = tasks.filter(t => t.Status === 'To Be Started' || t.Status === 'In Progress').length;
        const issuedItems  = inventory.filter(i => i.Status === 'Issued').length;

        const roleClass = e.Role === 'Manager' ? 'role-manager' : e.Role === 'Admin' ? 'role-admin' : 'role-employee';

        panel.innerHTML = `
        <!-- Profile header -->
        <div class="emp-profile-header">
            <div class="emp-profile-top">
                ${avatarHtml(e.profileImageUrl || null, e.Name, 'emp-avatar-lg', color, 'border:3px solid rgba(255,255,255,.3);box-shadow:0 8px 24px rgba(0,0,0,.2);')}
                <div class="emp-profile-info">
                    <div class="emp-profile-name">${ee(e.Name)}</div>
                    <div class="emp-profile-sub">${ee(e.Email)} · ID #${e.EmployeeID}</div>
                    <div class="emp-profile-badges">
                        <span class="emp-badge">${ee(e.ClientName || e.clientName || '—')}</span>
                        <span class="emp-badge">${ee(e.Designation || e.Role)}</span>
                        ${e.TeamName ? `<span class="emp-badge">Team: ${ee(e.TeamName)}</span>` : ''}
                        <span class="emp-role-badge ${roleClass}" style="margin-left:4px;">${ee(e.Role)}</span>
                    </div>
                </div>
            </div>
            <div class="emp-quick-stats">
                <div class="emp-quick-stat">
                    <div class="emp-quick-stat-val">${daysPresent}</div>
                    <div class="emp-quick-stat-lbl">Days Present</div>
                </div>
                <div class="emp-quick-stat">
                    <div class="emp-quick-stat-val">${totalHours.toFixed(1)}</div>
                    <div class="emp-quick-stat-lbl">Hours Logged</div>
                </div>
                <div class="emp-quick-stat">
                    <div class="emp-quick-stat-val">${pendingTasks}</div>
                    <div class="emp-quick-stat-lbl">Active Tasks</div>
                </div>
                <div class="emp-quick-stat">
                    <div class="emp-quick-stat-val">${issuedItems}</div>
                    <div class="emp-quick-stat-lbl">Items Issued</div>
                </div>
            </div>
        </div>

        <!-- Tabs -->
        <div class="emp-tabs">
            <div class="emp-tab active" data-tab="profile">Profile</div>
            <div class="emp-tab" data-tab="attendance">Attendance <span style="background:#dbeafe;color:#1d4ed8;font-size:10px;font-weight:700;padding:1px 6px;border-radius:10px;margin-left:4px;">${attendance.length}</span></div>
            <div class="emp-tab" data-tab="tasks">Tasks <span style="background:#dcfce7;color:#15803d;font-size:10px;font-weight:700;padding:1px 6px;border-radius:10px;margin-left:4px;">${tasks.length}</span></div>
            <div class="emp-tab" data-tab="inventory">Inventory <span style="background:#fef9c3;color:#a16207;font-size:10px;font-weight:700;padding:1px 6px;border-radius:10px;margin-left:4px;">${inventory.length}</span></div>
        </div>

        <!-- Tab: Profile -->
        <div class="emp-tab-content active" id="tab-profile">
            ${e.profileImageUrl ? `
            <div style="margin-bottom:24px;display:flex;align-items:center;gap:20px;">
                <img src="${ee(e.profileImageUrl)}" alt="${ee(e.Name)}"
                    style="width:96px;height:96px;border-radius:50%;object-fit:cover;border:3px solid #e2e8f0;box-shadow:0 4px 16px rgba(0,0,0,.1);flex-shrink:0;">
                <div>
                    <div style="font-size:18px;font-weight:700;color:#0f172a;">${ee(e.Name)}</div>
                    <div style="font-size:13px;color:#64748b;margin-top:2px;">${ee(e.Designation || e.Role)}</div>
                    ${e.TeamName ? `<div style="font-size:12px;color:#94a3b8;margin-top:2px;">Team: ${ee(e.TeamName)}</div>` : ''}
                </div>
            </div>` : ''}
            <p class="tab-section-title">Personal Information</p>
            <div class="info-grid-2">
                <div class="info-field"><label>Full Name</label><p>${ee(e.Name)}</p></div>
                <div class="info-field"><label>Employee ID</label><p>#${e.EmployeeID}</p></div>
                <div class="info-field"><label>Email</label><p>${ee(e.Email)}</p></div>
                <div class="info-field"><label>Username</label><p>${ee(e.Username || '—')}</p></div>
                <div class="info-field"><label>Contact</label><p>${ee(e.Contact || '—')}</p></div>
                <div class="info-field"><label>Father's Name</label><p>${ee(e.FatherName || '—')}</p></div>
            </div>
            <p class="tab-section-title">Employment Details</p>
            <div class="info-grid-2">
                <div class="info-field"><label>Client</label><p>${ee(e.ClientName || e.clientName || '—')}</p></div>
                <div class="info-field"><label>Designation</label><p>${ee(e.Designation || '—')}</p></div>
                <div class="info-field"><label>Role</label><p><span class="emp-role-badge ${roleClass}">${ee(e.Role)}</span></p></div>
                <div class="info-field"><label>Team</label><p>${e.TeamID != null ? `${e.TeamID}${e.TeamName ? ' — ' + ee(e.TeamName) : ''}` : '—'}</p></div>
                <div class="info-field"><label>Appointed On</label><p>${e.AppointedOn ? formatDate(e.AppointedOn) : '—'}</p></div>
                <div class="info-field"><label>Qualification</label><p>${ee(e.Qualification || '—')}</p></div>
            </div>
            ${e.Certifications ? `<p class="tab-section-title">Certifications</p><p style="font-size:14px;color:#374151;white-space:pre-wrap;">${ee(e.Certifications)}</p>` : ''}
            ${e.CVFile ? `<div style="margin-top:20px;"><a href="${ee(e.CVFile)}" download class="btn-primary" style="display:inline-flex;align-items:center;gap:8px;font-size:13px;padding:8px 18px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download CV</a></div>` : ''}
        </div>

        <!-- Tab: Attendance -->
        <div class="emp-tab-content" id="tab-attendance">
            ${renderAttSummary(attendance)}
            <p class="tab-section-title">Attendance Records (Recent 50)</p>
            ${renderAttendanceTable(attendance)}
        </div>

        <!-- Tab: Tasks -->
        <div class="emp-tab-content" id="tab-tasks">
            ${renderTasksSummary(tasks)}
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                <p class="tab-section-title" style="margin:0;">Tasks</p>
                <div class="task-view-toggle">
                    <button class="task-view-btn active" data-task-view="card">🏷 Cards</button>
                    <button class="task-view-btn" data-task-view="timeline">📅 Timeline</button>
                    <button class="task-view-btn" data-task-view="kanban">📊 Kanban</button>
                </div>
            </div>
            <div id="taskViewContainer">${renderTasksView(tasks, 'card')}</div>
        </div>

        <!-- Tab: Inventory -->
        <div class="emp-tab-content" id="tab-inventory">
            <p class="tab-section-title">Issued Items</p>
            ${renderInventoryTable(inventory)}
        </div>
        `;

        // Tab switching
        panel.querySelectorAll('.emp-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                panel.querySelectorAll('.emp-tab').forEach(t => t.classList.remove('active'));
                panel.querySelectorAll('.emp-tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                const tabPanel = panel.querySelector(`#tab-${tab.dataset.tab}`);
                if (tabPanel) {
                    tabPanel.classList.add('active');
                    // Reset task view when switching tabs
                    if (tab.dataset.tab === 'tasks') {
                        currentTaskView = 'card';
                        setupTaskViewToggle(tasks);
                    }
                }
            });
        });

        // Task view toggle
        if (tasks.length > 0) {
            setupTaskViewToggle(tasks);
        }

    } catch (err) {
        panel.innerHTML = `<div style="padding:40px;text-align:center;color:#ef4444;">${ee(err.message)}</div>`;
    }
}

// ── Render helpers ────────────────────────────────────────

function renderAttSummary(rows) {
    if (!rows.length) return '';
    const present = rows.filter(r => r.LoginTime).length;
    const total   = rows.reduce((s, r) => s + (parseFloat(r.TotalHours) || 0), 0);
    const avg     = present ? (total / present).toFixed(1) : '—';
    return `<div class="att-summary">
        <div class="att-summary-card"><div class="att-summary-val">${present}</div><div class="att-summary-lbl">Days Recorded</div></div>
        <div class="att-summary-card"><div class="att-summary-val">${total.toFixed(1)}</div><div class="att-summary-lbl">Total Hours</div></div>
        <div class="att-summary-card"><div class="att-summary-val">${avg}</div><div class="att-summary-lbl">Avg Hours/Day</div></div>
    </div>`;
}

function renderTasksSummary(rows) {
    if (!rows.length) return '';
    const pending  = rows.filter(t => t.Status === 'To Be Started').length;
    const inprog   = rows.filter(t => t.Status === 'In Progress').length;
    const done     = rows.filter(t => t.Status === 'Completed').length;
    return `<div class="att-summary">
        <div class="att-summary-card"><div class="att-summary-val" style="color:#a16207;">${pending}</div><div class="att-summary-lbl">To Be Started</div></div>
        <div class="att-summary-card"><div class="att-summary-val" style="color:#1d4ed8;">${inprog}</div><div class="att-summary-lbl">In Progress</div></div>
        <div class="att-summary-card"><div class="att-summary-val" style="color:#15803d;">${done}</div><div class="att-summary-lbl">Completed</div></div>
    </div>`;
}

function renderAttendanceTable(rows) {
    if (!rows.length) return emptyState('No attendance records found');
    return `<div style="overflow-x:auto;"><table class="table"><thead><tr>
        <th>Date</th><th>Login</th><th>Logout</th><th>Total Hours</th>
    </tr></thead><tbody>${rows.map(r => `<tr>
        <td><strong>${r.Date ? formatDate(r.Date) : '—'}</strong></td>
        <td>${r.LoginTime  ? formatDateTime(r.LoginTime)  : '<span style="color:#94a3b8;">—</span>'}</td>
        <td>${r.LogoutTime ? formatDateTime(r.LogoutTime) : '<span style="color:#94a3b8;">—</span>'}</td>
        <td>${r.TotalHours != null ? `<strong>${parseFloat(r.TotalHours).toFixed(2)}</strong> hrs` : '—'}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

function renderTasksTable(rows) {
    if (!rows.length) return emptyState('No tasks assigned');
    return `<div style="overflow-x:auto;"><table class="table"><thead><tr>
        <th>Title</th><th>Status</th><th>Priority</th><th>Deadline</th><th>Assigned By</th>
    </tr></thead><tbody>${rows.map(t => {
        const sc = (t.Status || '').toLowerCase().replace(/\s+/g, '-');
        const pc = (t.Priority || '').toLowerCase();
        return `<tr>
            <td><strong>${ee(t.Title)}</strong></td>
            <td><span class="task-status ${sc}">${ee(t.Status)}</span></td>
            <td><span class="priority ${pc}">${ee(t.Priority || '—')}</span></td>
            <td>${t.Deadline ? formatDate(t.Deadline) : '—'}</td>
            <td>${ee(t.AssignedByName || '—')}</td>
        </tr>`;
    }).join('')}</tbody></table></div>`;
}

function renderTasksView(rows, view) {
    if (!rows.length) return emptyState('No tasks assigned');
    if (view === 'card') return renderTasksCardView(rows);
    else if (view === 'timeline') return renderTasksTimelineView(rows);
    else if (view === 'kanban') return renderTasksKanbanView(rows);
    return renderTasksCardView(rows);
}

function renderTasksCardView(rows) {
    return `<div class="task-cards-grid">${rows.map(t => {
        const priClass = (t.Priority || 'Medium').toLowerCase();
        const statClass = (t.Status || 'To Be Started').toLowerCase().replace(/\s+/g, '-');
        return `
            <div class="task-card">
                <div class="task-card-header">
                    <div class="task-card-title">${ee(t.Title)}</div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
                        ${t.Priority ? `<span class="task-card-priority ${priClass}">${ee(t.Priority)}</span>` : ''}
                        <span class="task-card-status ${statClass}">
                            ${t.Status === 'Completed' ? '✓' : t.Status === 'In Progress' ? '⏳' : '●'}
                            ${ee(t.Status || 'To Be Started')}
                        </span>
                    </div>
                </div>
                <div class="task-card-meta">
                    ${t.AssignedByName ? `<div class="task-meta-item"><div class="task-meta-label">Assigned By</div><div class="task-meta-value">${ee(t.AssignedByName)}</div></div>` : ''}
                    ${t.Deadline ? `<div class="task-meta-item"><div class="task-meta-label">Deadline</div><div class="task-meta-value">${formatDate(t.Deadline)}</div></div>` : ''}
                </div>
            </div>`;
    }).join('')}</div>`;
}

function renderTasksTimelineView(rows) {
    const sorted = [...rows].sort((a, b) => {
        const dateA = new Date(a.Deadline || '2099-12-31');
        const dateB = new Date(b.Deadline || '2099-12-31');
        return dateA - dateB;
    });
    
    return `<div class="task-timeline">${sorted.map(t => {
        const statClass = (t.Status || 'To Be Started').toLowerCase().replace(/\s+/g, '-');
        return `
            <div class="task-timeline-item">
                <div class="task-timeline-dot"></div>
                <div class="task-timeline-content">
                    <div class="task-timeline-deadline">📅 ${t.Deadline ? formatDate(t.Deadline) : 'No deadline'}</div>
                    <div class="task-timeline-title">${ee(t.Title)}</div>
                    <div class="task-timeline-info">
                        <strong>Status:</strong> ${ee(t.Status || 'To Be Started')} |
                        <strong>Priority:</strong> ${ee(t.Priority || '—')} | 
                        <strong>Assigned By:</strong> ${ee(t.AssignedByName || '—')}
                    </div>
                </div>
            </div>`;
    }).join('')}</div>`;
}

function renderTasksKanbanView(rows) {
    const statuses = ['To Be Started', 'In Progress', 'Completed'];
    const grouped = {};
    statuses.forEach(s => grouped[s] = []);
    rows.forEach(t => {
        if (grouped[t.Status]) grouped[t.Status].push(t);
    });

    return `<div class="task-kanban">${statuses.map(status => {
        const tasks = grouped[status] || [];
        const statClass = status.toLowerCase().replace(/\s+/g, '-');
        const icon = status === 'Completed' ? '✓' : status === 'In Progress' ? '⏳' : '●';
        return `
            <div class="kanban-task-column">
                <div class="kanban-task-header">
                    <span>${icon} ${status}</span>
                    <span class="kanban-task-count">${tasks.length}</span>
                </div>
                <div class="kanban-task-cards">
                    ${tasks.map(t => `
                        <div class="kanban-task-card">
                            <div class="kanban-task-card-title">${ee(t.Title)}</div>
                            ${t.AssignedByName ? `<div class="kanban-task-card-info">👤 ${ee(t.AssignedByName)}</div>` : ''}
                            ${t.Priority ? `<div class="kanban-task-card-info">🎯 ${ee(t.Priority)}</div>` : ''}
                            ${t.Deadline ? `<div class="kanban-task-card-deadline">📅 ${formatDate(t.Deadline)}</div>` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>`;
    }).join('')}</div>`;
}

function setupTaskViewToggle(tasks) {
    const container = document.getElementById('taskViewContainer');
    if (!container) return;
    
    const toggleBtns = document.querySelectorAll('.task-view-btn');
    toggleBtns.forEach(btn => {
        btn.onclick = () => {
            toggleBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentTaskView = btn.dataset.taskView;
            container.innerHTML = renderTasksView(tasks, currentTaskView);
        };
    });
}

function renderInventoryTable(rows) {
    if (!rows.length) return emptyState('No inventory items issued');
    return `<div style="overflow-x:auto;"><table class="table"><thead><tr>
        <th>Item</th><th>Status</th><th>Issued Date</th><th>Return Date</th><th>Desk</th>
    </tr></thead><tbody>${rows.map(i => `<tr>
        <td><strong>${ee(i.ItemName)}</strong></td>
        <td><span class="task-status ${i.Status === 'Issued' ? 'in-progress' : 'completed'}">${ee(i.Status)}</span></td>
        <td>${i.IssueDate  ? formatDate(i.IssueDate)  : '—'}</td>
        <td>${i.ReturnDate ? formatDate(i.ReturnDate) : '<span style="color:#94a3b8;">Not returned</span>'}</td>
        <td>${ee(i.DeskNo || '—')}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

function emptyState(msg) {
    return `<div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <p>${ee(msg)}</p>
    </div>`;
}

// ── Utils ─────────────────────────────────────────────────

function getInitials(name) {
    if (!name) return '?';
    return name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function avatarColor(id) {
    return AVATAR_COLORS[(parseInt(id, 10) || 0) % AVATAR_COLORS.length];
}

function avatarHtml(imageUrl, name, cssClass, bgColor, extraStyle) {
    const base = `background:${bgColor};${extraStyle || ''}`;
    if (imageUrl) {
        return `<div class="${cssClass}" style="${base}overflow:hidden;padding:0;">` +
            `<img src="${ee(imageUrl)}" alt="${ee(name)}" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:50%;">` +
            `</div>`;
    }
    return `<div class="${cssClass}" style="${base}">${getInitials(name)}</div>`;
}

function ee(str) {
    if (str == null) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
