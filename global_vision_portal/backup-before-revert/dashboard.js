/* =============================================
   Global Vision Portal - Dashboard Script
   ============================================= */

document.addEventListener('DOMContentLoaded', function() {
    checkAuth();
    initializeDashboard();
});

async function initializeDashboard() {
    const user = getUser();

    if (!user) {
        window.location.href = 'login.html';
        return;
    }

    document.getElementById('employeeName').textContent = user.Name;
    document.getElementById('employeeRole').textContent = user.Role;

    await loadAttendanceStatus();
    await loadTasksSummary();
    await loadInventorySummary();
    await loadQuickStats();

    const attendanceBtn = document.getElementById('attendanceBtn');
    if (attendanceBtn) {
        attendanceBtn.addEventListener('click', handleAttendanceToggle);
    }
}

async function loadAttendanceStatus() {
    try {
        const response = await apiCall('/attendance/today');
        const record = response && response.record;

        const statusEl = document.getElementById('attendanceStatus');
        const timeEl = document.getElementById('attendanceTime');
        const todayStatusEl = document.getElementById('todayStatus');
        const attendanceBtn = document.getElementById('attendanceBtn');

        if (record) {
            if (record.LogoutTime) {
                statusEl.textContent = 'Logged Out';
                statusEl.style.color = '#e74c3c';
                timeEl.textContent = `Login: ${formatTime(record.LoginTime)} | Logout: ${formatTime(record.LogoutTime)}`;
                attendanceBtn.textContent = 'Login';
                todayStatusEl.textContent = 'Completed';
            } else {
                statusEl.textContent = 'Currently Logged In';
                statusEl.style.color = '#27ae60';
                timeEl.textContent = `Logged in at: ${formatTime(record.LoginTime)}`;
                attendanceBtn.textContent = 'Logout';
                todayStatusEl.textContent = 'Active';
            }
        } else {
            statusEl.textContent = 'Not logged in';
            statusEl.style.color = '';
            timeEl.textContent = '';
            attendanceBtn.textContent = 'Login';
            todayStatusEl.textContent = 'Not Started';
        }
    } catch (error) {
        console.error('Error loading attendance status:', error);
    }
}

async function handleAttendanceToggle() {
    try {
        const response = await apiCall('/attendance/toggle', { method: 'POST' });
        if (response && response.success) {
            await loadAttendanceStatus();
            await loadQuickStats();
            showMessage('Attendance recorded successfully', 'success', 'taskMessage');
        }
    } catch (error) {
        console.error('Error toggling attendance:', error);
        showMessage('Error recording attendance. Is the API server running?', 'error', 'taskMessage');
    }
}

async function loadTasksSummary() {
    try {
        const user = getUser();
        const response = await apiCall(`/tasks?assignedTo=${user.EmployeeID}`);
        const userTasks = (response && response.tasks) || [];

        const pendingCount = userTasks.filter(t =>
            t.Status === 'Pending' || t.Status === 'In Progress'
        ).length;

        document.getElementById('pendingTasks').textContent = pendingCount;

        const tasksBody = document.getElementById('tasksBody');
        if (userTasks.length > 0) {
            tasksBody.innerHTML = userTasks.slice(0, 3).map(task => `
                <tr>
                    <td>${task.Title}</td>
                    <td><span class="task-status ${task.Status.toLowerCase().replace(' ', '-')}">${task.Status}</span></td>
                    <td>${formatDate(task.Deadline)}</td>
                    <td><span class="priority ${task.Priority.toLowerCase()}">${task.Priority}</span></td>
                </tr>
            `).join('');
        } else {
            tasksBody.innerHTML = '<tr><td colspan="4" class="text-center">No tasks assigned</td></tr>';
        }
    } catch (error) {
        console.error('Error loading tasks:', error);
    }
}

async function loadInventorySummary() {
    try {
        const user = getUser();
        const response = await apiCall(`/inventory?issuedTo=${user.EmployeeID}`);
        const userItems = (response && response.items) || [];

        document.getElementById('itemsIssued').textContent = userItems.length;

        const inventoryBody = document.getElementById('inventoryBody');
        if (userItems.length > 0) {
            inventoryBody.innerHTML = userItems.slice(0, 3).map(item => `
                <tr>
                    <td>${item.ItemName}</td>
                    <td>${item.IssueDate ? formatDate(item.IssueDate) : 'N/A'}</td>
                    <td><span class="task-status pending">${item.Status}</span></td>
                </tr>
            `).join('');
        } else {
            inventoryBody.innerHTML = '<tr><td colspan="3" class="text-center">No items issued</td></tr>';
        }
    } catch (error) {
        console.error('Error loading inventory:', error);
    }
}

async function loadQuickStats() {
    try {
        const response = await apiCall('/attendance/stats');
        const hours = (response && response.monthlyHours) || 0;
        document.getElementById('monthlyHours').textContent = parseFloat(hours).toFixed(1) + ' hrs';
    } catch (error) {
        console.error('Error loading stats:', error);
        document.getElementById('monthlyHours').textContent = '0 hrs';
    }
}
