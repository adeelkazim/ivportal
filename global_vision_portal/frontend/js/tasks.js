/* =============================================
   Global Vision Portal - Tasks
   ============================================= */

let currentTasks = [];
let selectedTaskId = null;
let allEmployeesForTasks = [];
let allTeams = [];
let allClients = [];

document.addEventListener('DOMContentLoaded', function () {
    checkAuth();
    initTasksPage();
});

async function initTasksPage() {
    // All authenticated employees can assign tasks
    const panel = document.getElementById('adminTasksPanel');
    if (panel) panel.style.display = 'block';
    const badge = document.getElementById('assignRoleBadge');
    if (badge) badge.textContent = getUser().Role;

    // Employee filter visible only to managers/admins (they see all tasks)
    if (isManagerOrAdmin()) {
        const empFilter = document.getElementById('employeeFilter');
        if (empFilter) empFilter.style.display = 'block';
    }

    await loadEmployeesForTasks();
    await loadTeamsClients();
    setupAssignForm();
    await loadTasks();
    setupFilters();
    setupModal();
}

// ── Employee dropdown (admin/manager only) ────────────────────────

async function loadEmployeesForTasks() {
    try {
        const endpoint = isManagerOrAdmin() ? '/admin/employees' : '/employees/directory';
        const res = await apiCall(endpoint);
        allEmployeesForTasks = (res && res.employees) || [];

        // Populate assign-to select
        const sel = document.getElementById('assignEmployee');
        if (sel) {
            sel.innerHTML = '<option value="">— Select employee —</option>' +
                allEmployeesForTasks.map(e =>
                    `<option value="${e.EmployeeID}">${taskEsc(e.Name)} (${taskEsc(e.Role)})</option>`
                ).join('');
        }

        // Populate employee filter
        const empFilter = document.getElementById('employeeFilter');
        if (empFilter) {
            empFilter.innerHTML = '<option value="">All Employees</option>' +
                allEmployeesForTasks.map(e =>
                    `<option value="${e.EmployeeID}">${taskEsc(e.Name)}</option>`
                ).join('');
        }
    } catch (err) {
        console.warn('Could not load employees for tasks:', err.message);
    }
}

// ── Teams & Clients ───────────────────────────────────────────────

async function loadTeamsClients() {
    try {
        const [teamRes, clientRes] = await Promise.all([
            apiCall('/teams'),
            apiCall('/clients')
        ]);
        allTeams   = (teamRes   && teamRes.teams)     || [];
        allClients = (clientRes && clientRes.clients) || [];

        const teamSel = document.getElementById('assignTeam');
        if (teamSel) {
            teamSel.innerHTML = '<option value="">— No team —</option>' +
                allTeams.map(t => `<option value="${t.TeamID}">${taskEsc(t.TeamName)}</option>`).join('');
        }
        const clientSel = document.getElementById('assignClient');
        if (clientSel) {
            clientSel.innerHTML = '<option value="">— No client —</option>' +
                allClients.map(c => `<option value="${c.cliClientID}">${taskEsc(c.cliClientName)}</option>`).join('');
        }
    } catch (err) {
        console.warn('Could not load teams/clients:', err.message);
    }
}

// ── Assign task form ──────────────────────────────────────────────

function setupAssignForm() {
    const form = document.getElementById('assignTaskForm');
    if (form) form.addEventListener('submit', assignTask);
}

async function assignTask(e) {
    e.preventDefault();
    const title       = document.getElementById('assignTitle').value.trim();
    const assignedTo  = parseInt(document.getElementById('assignEmployee').value, 10);
    const priority    = document.getElementById('assignPriority').value;
    const deadline    = document.getElementById('assignDeadline').value;
    const description = document.getElementById('assignDescription').value.trim();
    const teamId      = document.getElementById('assignTeam')?.value   || null;
    const clientId    = document.getElementById('assignClient')?.value || null;
    const project     = document.getElementById('assignProject')?.value.trim() || null;
    const notes       = document.getElementById('assignNotes')?.value.trim()   || null;
    const startTime   = document.getElementById('assignStartTime')?.value || null;
    const endTime     = document.getElementById('assignEndTime')?.value   || null;

    if (!title || !assignedTo || !deadline) {
        showMessage('Title, employee and deadline are required.', 'error', 'taskAssignMessage');
        return;
    }

    try {
        const res = await apiCall('/tasks', {
            method: 'POST',
            body: JSON.stringify({
                title, description, assignedTo, priority, deadline,
                teamId:    teamId    || undefined,
                clientId:  clientId  || undefined,
                project:   project   || undefined,
                notes:     notes     || undefined,
                startTime: startTime || undefined,
                endTime:   endTime   || undefined,
            })
        });
        if (res && res.success) {
            showMessage(`Task "${title}" assigned successfully.`, 'success', 'taskAssignMessage');
            document.getElementById('assignTaskForm').reset();
            await loadTasks();
        }
    } catch (err) {
        showMessage(err.message, 'error', 'taskAssignMessage');
    }
}

// ── Load tasks ────────────────────────────────────────────────────

async function loadTasks() {
    const container = document.getElementById('tasksContainer');
    if (container) container.innerHTML = '<p class="text-center text-muted">Loading tasks…</p>';

    try {
        const url = isManagerOrAdmin() ? '/tasks?all=true' : '/tasks';
        const res = await apiCall(url);
        currentTasks = (res && res.tasks) || [];
        applyFilters();
    } catch (err) {
        if (container) container.innerHTML = `<p class="text-center text-danger">${taskEsc(err.message)}</p>`;
    }
}

// ── Display ───────────────────────────────────────────────────────

function displayTasks(tasks) {
    const container = document.getElementById('tasksContainer');
    const admin = isManagerOrAdmin();

    if (!tasks.length) {
        container.innerHTML = '<p class="text-center text-muted">No tasks found.</p>';
        return;
    }

    container.innerHTML = tasks.map(task => {
        // Treat legacy 'Pending' the same as 'To Be Started'
        const displayStatus = (task.Status === 'Pending') ? 'To Be Started' : (task.Status || '');
        const statusClass   = displayStatus.toLowerCase().replace(/\s+/g, '-');
        const priorityClass = (task.Priority || '').toLowerCase();
        const isToBeStarted = displayStatus === 'To Be Started';

        const assignedLine = admin && task.AssignedToName
            ? `<div class="task-deadline"><strong>Assigned to:</strong> ${taskEsc(task.AssignedToName)}</div>`
            : (task.AssignedByName
                ? `<div class="task-deadline"><strong>From:</strong> ${taskEsc(task.AssignedByName)}</div>`
                : '');
        const teamTag   = task.TeamName   ? `<span style="font-size:11px;background:#eff6ff;color:#1d4ed8;border-radius:4px;padding:2px 7px;font-weight:600;">${taskEsc(task.TeamName)}</span>` : '';
        const clientTag = task.ClientName ? `<span style="font-size:11px;background:#f0fdf4;color:#15803d;border-radius:4px;padding:2px 7px;font-weight:600;">${taskEsc(task.ClientName)}</span>` : '';
        const tagsLine  = (teamTag || clientTag) ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">${teamTag}${clientTag}</div>` : '';

        const taskLogUrl = `task-log.html?taskId=${task.TaskID}&taskTitle=${encodeURIComponent(task.Title)}`;

        const cardActions = `
            <div class="task-card-actions">
                ${isToBeStarted ? `
                <a class="task-play-btn" href="${taskLogUrl}" onclick="event.stopPropagation()" title="Go to Daily Task Log to start working">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                    Start Working
                </a>` : ''}
                <button class="task-details-btn" onclick="event.stopPropagation();openTaskModal(${task.TaskID})" title="View / update task details">
                    Details ›
                </button>
            </div>`;

        return `
        <div class="task-card${isToBeStarted ? ' task-card-tbs' : ''}"
             onclick="window.location.href='${taskLogUrl}'"
             style="cursor:pointer;">
            <h3>${taskEsc(task.Title)}</h3>
            <p>${taskEsc(truncateString(task.Description || '', 100))}</p>
            <div class="task-meta">
                <span class="task-status ${statusClass}">${taskEsc(displayStatus)}</span>
                <span class="priority ${priorityClass}">${taskEsc(task.Priority)}</span>
            </div>
            ${tagsLine}
            ${assignedLine}
            <div class="task-deadline"><strong>Deadline:</strong> ${formatDate(task.Deadline)}</div>
            ${cardActions}
        </div>`;
    }).join('');
}

// ── Filters ───────────────────────────────────────────────────────

function setupFilters() {
    document.getElementById('statusFilter')?.addEventListener('change', applyFilters);
    document.getElementById('priorityFilter')?.addEventListener('change', applyFilters);
    document.getElementById('employeeFilter')?.addEventListener('change', applyFilters);
}

function applyFilters() {
    const status = document.getElementById('statusFilter')?.value || '';
    const priority = document.getElementById('priorityFilter')?.value || '';
    const empId = parseInt(document.getElementById('employeeFilter')?.value || '0', 10);

    let filtered = currentTasks;
    if (status) filtered = filtered.filter(t => t.Status === status);
    if (priority) filtered = filtered.filter(t => t.Priority === priority);
    if (empId) filtered = filtered.filter(t => parseInt(t.AssignedTo, 10) === empId);

    displayTasks(filtered);
}

// ── Task modal ────────────────────────────────────────────────────

function openTaskModal(taskId) {
    const task = currentTasks.find(t => t.TaskID === taskId);
    if (!task) return;

    selectedTaskId = taskId;
    const admin = isManagerOrAdmin();

    document.getElementById('modalTitle').textContent     = task.Title;
    document.getElementById('modalDescription').textContent = task.Description || '—';
    document.getElementById('modalStatus').value          = task.Status;
    document.getElementById('modalPriority').innerHTML    =
        `<span class="priority ${(task.Priority || '').toLowerCase()}">${taskEsc(task.Priority)}</span>`;
    document.getElementById('modalDeadline').textContent  = formatDateTime(task.Deadline);

    // Project row
    const projectWrap = document.getElementById('modalProjectWrap');
    const projectEl   = document.getElementById('modalProject');
    if (projectWrap && projectEl) {
        if (task.Project) {
            projectEl.textContent = task.Project;
            projectWrap.style.display = 'block';
        } else {
            projectWrap.style.display = 'none';
        }
    }

    // Start / End Time rows
    const startWrap = document.getElementById('modalStartTimeWrap');
    const startEl   = document.getElementById('modalStartTime');
    const endWrap   = document.getElementById('modalEndTimeWrap');
    const endEl     = document.getElementById('modalEndTime');
    const formatTime = dt => {
        if (!dt) return null;
        const d = new Date(dt);
        if (isNaN(d)) return null;
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };
    if (startWrap && startEl) {
        const t = formatTime(task.StartTime);
        if (t) { startEl.textContent = t; startWrap.style.display = 'block'; }
        else { startWrap.style.display = 'none'; }
    }
    if (endWrap && endEl) {
        const t = formatTime(task.EndTime);
        if (t) { endEl.textContent = t; endWrap.style.display = 'block'; }
        else { endWrap.style.display = 'none'; }
    }

    // Assigned-to row (admin view)
    const assignedWrap = document.getElementById('modalAssignedToWrap');
    const assignedEl   = document.getElementById('modalAssignedTo');
    if (assignedWrap && assignedEl) {
        if (admin && task.AssignedToName) {
            assignedEl.textContent = task.AssignedToName;
            assignedWrap.style.display = 'block';
        } else {
            assignedWrap.style.display = 'none';
        }
    }

    // Team row
    const teamWrap = document.getElementById('modalTeamWrap');
    const teamEl   = document.getElementById('modalTeam');
    if (teamWrap && teamEl) {
        if (task.TeamName) {
            teamEl.textContent = task.TeamName;
            teamWrap.style.display = 'block';
        } else {
            teamWrap.style.display = 'none';
        }
    }

    // Client row
    const clientWrap = document.getElementById('modalClientWrap');
    const clientEl   = document.getElementById('modalClient');
    if (clientWrap && clientEl) {
        if (task.ClientName) {
            clientEl.textContent = task.ClientName;
            clientWrap.style.display = 'block';
        } else {
            clientWrap.style.display = 'none';
        }
    }

    // Notes row
    const notesWrap = document.getElementById('modalNotesWrap');
    const notesEl   = document.getElementById('modalNotes');
    if (notesWrap && notesEl) {
        if (task.Notes) {
            notesEl.textContent = task.Notes;
            notesWrap.style.display = 'block';
        } else {
            notesWrap.style.display = 'none';
        }
    }

    // Delete button (admin/manager only)
    const delBtn = document.getElementById('modalDeleteBtn');
    if (delBtn) delBtn.style.display = admin ? 'inline-block' : 'none';

    openModal('taskModal');
}

function setupModal() {
    document.getElementById('modalUpdateBtn')?.addEventListener('click', updateTaskStatus);
    document.getElementById('modalDeleteBtn')?.addEventListener('click', deleteTask);
    document.getElementById('modalCloseBtn')?.addEventListener('click', () => closeModal('taskModal'));
}

async function updateTaskStatus() {
    if (!selectedTaskId) return;
    const newStatus = document.getElementById('modalStatus').value;
    const btn = document.getElementById('modalUpdateBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
        await apiCall(`/tasks/${selectedTaskId}`, {
            method: 'PUT',
            body: JSON.stringify({ Status: newStatus })
        });
        closeModal('taskModal');
        await loadTasks();
        showMessage('Status updated.', 'success', 'taskMessage');
    } catch (err) {
        if (btn) { btn.disabled = false; btn.textContent = 'Update Status'; }
        alert('Could not update status: ' + err.message);
    }
}

async function deleteTask() {
    if (!selectedTaskId) return;
    const task = currentTasks.find(t => t.TaskID === selectedTaskId);
    if (!confirm(`Delete task "${task?.Title}"? This cannot be undone.`)) return;
    try {
        const res = await apiCall(`/tasks/${selectedTaskId}`, { method: 'DELETE' });
        if (res && res.success) {
            closeModal('taskModal');
            showMessage('Task deleted.', 'success', 'taskMessage');
            await loadTasks();
        }
    } catch (err) {
        showMessage(err.message, 'error', 'taskMessage');
        closeModal('taskModal');
    }
}

// ── Util ──────────────────────────────────────────────────────────

function taskEsc(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
