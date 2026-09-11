/* =============================================
   Global Vision Portal - Tasks Script
   ============================================= */

let currentTasks = [];
let employees = [];
let selectedTaskId = null;

document.addEventListener('DOMContentLoaded', function() {
    checkAuth();
    initAdminPanel();
    loadTasks();
    setupFilters();
    setupModal();
});

function initAdminPanel() {
    if (!isManagerOrAdmin()) return;

    const panel = document.getElementById('adminTasksPanel');
    const badge = document.getElementById('assignRoleBadge');
    if (panel) panel.style.display = 'block';
    if (badge) badge.textContent = getUser().Role;

    const deadline = document.getElementById('assignDeadline');
    if (deadline) {
        const d = new Date();
        d.setDate(d.getDate() + 7);
        deadline.value = d.toISOString().split('T')[0];
    }

    loadEmployeesForAssign();
    setupAssignForm();
}

async function loadEmployeesForAssign() {
    try {
        const response = await apiCall('/employees');
        employees = (response && response.employees) || [];
        const select = document.getElementById('assignEmployee');
        if (!select) return;

        select.innerHTML = '<option value="">Select employee...</option>' +
            employees
                .filter(e => e.Role === 'Employee' || e.Role === 'Manager')
                .map(e => `<option value="${e.EmployeeID}">${e.Name} (${e.Department})</option>`)
                .join('');
    } catch (error) {
        console.error('Error loading employees:', error);
    }
}

function setupAssignForm() {
    const form = document.getElementById('assignTaskForm');
    if (!form) return;

    form.addEventListener('submit', async function(e) {
        e.preventDefault();

        const body = {
            title: document.getElementById('assignTitle').value.trim(),
            description: document.getElementById('assignDescription').value.trim(),
            assignedTo: parseInt(document.getElementById('assignEmployee').value, 10),
            priority: document.getElementById('assignPriority').value,
            deadline: document.getElementById('assignDeadline').value
        };

        try {
            const response = await apiCall('/tasks', {
                method: 'POST',
                body: JSON.stringify(body)
            });

            if (response && response.success) {
                showMessage('Task assigned successfully', 'success', 'taskAssignMessage');
                form.reset();
                initAdminPanel();
                await loadTasks();
            }
        } catch (error) {
            showMessage(error.message, 'error', 'taskAssignMessage');
        }
    });
}

async function loadTasks() {
    try {
        const user = getUser();
        const url = isManagerOrAdmin()
            ? '/tasks?all=true'
            : `/tasks?assignedTo=${user.EmployeeID}`;

        const response = await apiCall(url);
        currentTasks = (response && response.tasks) || [];
        displayTasks(currentTasks);
    } catch (error) {
        console.error('Error loading tasks:', error);
        showMessage('Error loading tasks. Start the backend server.', 'error', 'taskMessage');
    }
}

function displayTasks(tasks) {
    const container = document.getElementById('tasksContainer');
    const showAssignee = isManagerOrAdmin();

    if (tasks.length === 0) {
        container.innerHTML = '<p class="text-center">No tasks found</p>';
        return;
    }

    container.innerHTML = tasks.map(task => `
        <div class="task-card" onclick="openTaskModal(${task.TaskID})">
            <h3>${task.Title}</h3>
            <p>${truncateString(task.Description || '', 100)}</p>
            ${showAssignee && task.AssignedToName ?
                `<p style="font-size: 13px; color: #7f8c8d;"><strong>Assigned to:</strong> ${task.AssignedToName}</p>` : ''}
            <div class="task-meta">
                <span class="task-status ${task.Status.toLowerCase().replace(' ', '-')}">${task.Status}</span>
                <span class="priority ${task.Priority.toLowerCase()}">${task.Priority}</span>
            </div>
            <div style="margin-top: 10px; color: #7f8c8d; font-size: 13px;">
                <strong>Deadline:</strong> ${formatDate(task.Deadline)}
            </div>
        </div>
    `).join('');
}

function setupFilters() {
    const statusFilter = document.getElementById('statusFilter');
    const priorityFilter = document.getElementById('priorityFilter');

    if (statusFilter) statusFilter.addEventListener('change', applyFilters);
    if (priorityFilter) priorityFilter.addEventListener('change', applyFilters);
}

function applyFilters() {
    const statusFilter = document.getElementById('statusFilter').value;
    const priorityFilter = document.getElementById('priorityFilter').value;

    let filtered = currentTasks;
    if (statusFilter) filtered = filtered.filter(task => task.Status === statusFilter);
    if (priorityFilter) filtered = filtered.filter(task => task.Priority === priorityFilter);

    displayTasks(filtered);
}

function openTaskModal(taskId) {
    const task = currentTasks.find(t => t.TaskID === taskId);
    if (!task) return;

    selectedTaskId = taskId;
    const user = getUser();
    const canEdit = task.AssignedTo === user.EmployeeID || isManagerOrAdmin();

    document.getElementById('modalTitle').innerHTML = `<h2 style="margin-bottom: 20px;">${task.Title}</h2>`;
    document.getElementById('modalDescription').textContent = task.Description || '';
    document.getElementById('modalStatus').value = task.Status;
    document.getElementById('modalStatus').disabled = !canEdit;
    document.getElementById('modalPriority').innerHTML =
        `<span class="priority ${task.Priority.toLowerCase()}">${task.Priority}</span>`;
    document.getElementById('modalDeadline').textContent = formatDateTime(task.Deadline);
    document.getElementById('modalUpdateBtn').style.display = canEdit ? 'inline-block' : 'none';

    openModal('taskModal');
}

function setupModal() {
    const updateBtn = document.getElementById('modalUpdateBtn');
    const closeBtn = document.getElementById('modalCloseBtn');

    if (updateBtn) updateBtn.addEventListener('click', updateTaskStatus);
    if (closeBtn) closeBtn.addEventListener('click', () => closeModal('taskModal'));
}

async function updateTaskStatus() {
    if (!selectedTaskId) return;

    const newStatus = document.getElementById('modalStatus').value;

    try {
        const response = await apiCall(`/tasks/${selectedTaskId}`, {
            method: 'PUT',
            body: JSON.stringify({ Status: newStatus })
        });

        if (response && response.success) {
            const task = currentTasks.find(t => t.TaskID === selectedTaskId);
            if (task) task.Status = newStatus;
            showMessage('Task status updated successfully!', 'success', 'taskMessage');
            closeModal('taskModal');
            displayTasks(currentTasks);
        }
    } catch (error) {
        showMessage(error.message, 'error', 'taskMessage');
    }
}
