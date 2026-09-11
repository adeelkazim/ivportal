/* ── Daily Task Log — Employee View ──────────────────────────── */

let currentDate  = null; // null = all-history mode
let allLogs      = [];
let clientsList  = [];
let currentView  = 'card'; // card, timeline, or kanban

// Activity Tracker state
let todayActivities = [];
let descSaveTimers  = {};  // debounce timers keyed by LogID

document.addEventListener('DOMContentLoaded', () => {
    checkAuth();

    const dateInput = document.getElementById('logDate');
    if (dateInput) { dateInput.max = todayStr(); }

    document.getElementById('btnAddLog')?.addEventListener('click', () => openLogModal());
    document.getElementById('btnCancelLog')?.addEventListener('click', closeLogModal);
    document.getElementById('logModal')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeLogModal(); });
    document.getElementById('logForm')?.addEventListener('submit', saveLog);

    // Keep End Date >= Start Date: auto-advance end date when start date changes
    document.getElementById('formDate')?.addEventListener('change', e => {
        const endDateEl = document.getElementById('formEndDate');
        if (endDateEl && (!endDateEl.value || endDateEl.value < e.target.value)) {
            endDateEl.value = e.target.value;
        }
    });

    document.getElementById('btnPrevDay')?.addEventListener('click', () => shiftDay(-1));
    document.getElementById('btnNextDay')?.addEventListener('click', () => shiftDay(+1));
    document.getElementById('btnToday')?.addEventListener('click', () => setDate(todayStr()));
    document.getElementById('btnAllHistory')?.addEventListener('click', () => setDate(null));
    document.getElementById('logDate')?.addEventListener('change', e => setDate(e.target.value));

    // View toggle
    document.querySelectorAll('.view-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.view-toggle-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentView = btn.dataset.view;
            renderLogs();
        });
    });

    document.getElementById('btnNewActivity')?.addEventListener('click', newActivity);

    // Set today label in activity tracker header
    const lbl = document.getElementById('activityDateLabel');
    if (lbl) lbl.textContent = fmtDate(todayStr());

    loadClients();
    loadTodayActivities();
    setDate(todayStr()); // default to today — click "All History" to see full log

    // If navigated from task list, highlight that task's entries
    const urlParams  = new URLSearchParams(window.location.search);
    const hlTaskId   = urlParams.get('taskId');
    const hlTaskTitle = urlParams.get('taskTitle');
    if (hlTaskId) {
        // Wait for both sections to render, then highlight
        setTimeout(() => highlightTaskEntry(parseInt(hlTaskId, 10), hlTaskTitle), 800);
    }
});


function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function shiftDay(delta) {
    const base = currentDate || todayStr();
    const d = new Date(base + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    const next = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if (next <= todayStr()) setDate(next);
}

function setDate(dateStr) {
    currentDate = dateStr || null;
    const dateInput = document.getElementById('logDate');
    if (dateInput) dateInput.value = currentDate || '';
    const allBtn = document.getElementById('btnAllHistory');
    if (allBtn) {
        allBtn.style.background = currentDate ? '' : '#6366f1';
        allBtn.style.color = currentDate ? '' : '#fff';
        allBtn.style.borderColor = currentDate ? '' : '#6366f1';
    }
    loadLogs();
}

/* ── Load & Render ── */

async function loadLogs() {
    const loadingHtml = `<div style="text-align:center;padding:40px;color:#94a3b8;">⏳ Loading task logs...</div>`;
    document.getElementById('logCardsContainer').innerHTML = loadingHtml;
    document.getElementById('logTimelineContainer').innerHTML = loadingHtml;
    document.getElementById('logKanbanContainer').innerHTML = loadingHtml;

    try {
        const url = currentDate ? `/task-logs?date=${currentDate}` : `/task-logs?all=true`;
        const res = await apiCall(url);
        allLogs = res.logs || [];
        renderLogs();
        renderSummary();
    } catch (e) {
        console.error('Failed to load task logs:', e);
        const errorMsg = `<div style="text-align:center;padding:20px;background:#fee2e2;border-radius:8px;color:#991b1b;">
            <div style="font-weight:bold;margin-bottom:8px;">❌ Error Loading Tasks</div>
            <div style="font-size:13px;line-height:1.6;">${esc(e.message)}</div>
            <button onclick="location.reload()" style="margin-top:12px;padding:8px 16px;background:#dc2626;color:white;border:none;border-radius:4px;cursor:pointer;font-size:12px;">Reload Page</button>
        </div>`;
        document.getElementById('logCardsContainer').innerHTML = errorMsg;
        document.getElementById('logTimelineContainer').innerHTML = errorMsg;
        document.getElementById('logKanbanContainer').innerHTML = errorMsg;
    }
}

function renderLogs() {
    if (currentView === 'card') renderCardView();
    else if (currentView === 'timeline') renderTimelineView();
    else if (currentView === 'kanban') renderKanbanView();
}

function getStatusIcon(status) {
    const icons = {
        'Completed': '✓',
        'In Progress': '⏳',
        'On Hold': '⏸',
        'Delayed': '⚠',
        'To Be Started': '●'
    };
    return icons[status] || '•';
}

function buildLifecycle(status) {
    const order = { 'To Be Started': 0, 'In Progress': 1, 'Paused': 1, 'Postponed': 1, 'Delayed': 1, 'Completed': 2 };
    const cur = order[status] ?? 0;
    const steps = [
        { label: 'To Be Started', order: 0 },
        { label: 'In Progress',   order: 1 },
        { label: 'Completed',     order: 2 },
    ];
    let html = '<div class="act-lifecycle">';
    steps.forEach((step, i) => {
        if (i > 0) html += '<span class="lc-arrow">›</span>';
        const isActive = step.order === cur && status !== 'Paused' && status !== 'Postponed' && status !== 'Delayed';
        const isDone   = step.order < cur;
        const cls = isActive ? 'lc-active' : isDone ? 'lc-done' : '';
        html += `<span class="lc-step ${cls}">${isDone ? '✓ ' : ''}${step.label}</span>`;
    });
    if (status === 'Paused')    html += '<span class="lc-arrow" style="color:#f59e0b;">›</span><span class="lc-step lc-active" style="background:#fef3c7;color:#92400e;border-color:#fde68a;box-shadow:none;">⏸ Paused</span>';
    if (status === 'Postponed') html += '<span class="lc-arrow" style="color:#a855f7;">›</span><span class="lc-step lc-active" style="background:#f3e8ff;color:#7e22ce;border-color:#e9d5ff;box-shadow:none;">⏭ Postponed</span>';
    if (status === 'Delayed')   html += '<span class="lc-arrow" style="color:#ef4444;">›</span><span class="lc-step" style="background:#fee2e2;color:#991b1b;border-color:#fecaca;">⚠ Delayed</span>';
    html += '</div>';
    return html;
}

function calcElapsedTime(startTime) {
    if (!startTime) return '00:00';
    const start = new Date(startTime);
    const diffMs = Date.now() - start.getTime();
    if (diffMs < 0) return '00:00';
    const s = Math.floor(diffMs / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const p = n => String(n).padStart(2, '0');
    return h > 0 ? `${p(h)}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}

function calcTaskDuration(startTime, endTime, startDateStr, endDateStr) {
    const start24 = extractTime24(startTime);
    const end24   = extractTime24(endTime);
    if (!start24 || !end24) return null;

    // Cross-day: use full datetime if end date differs from start date
    const sd = startDateStr ? startDateStr.split('T')[0] : null;
    const ed = endDateStr   ? endDateStr.split('T')[0]   : null;
    if (sd && ed && ed !== sd) {
        const startDT = new Date(`${sd}T${start24}`);
        const endDT   = new Date(`${ed}T${end24}`);
        const diffMs  = endDT - startDT;
        if (diffMs <= 0) return null;
        const totalMins = Math.floor(diffMs / 60000);
        const hrs  = Math.floor(totalMins / 60);
        const mins = totalMins % 60;
        return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
    }

    // Same-day: time-only comparison
    const [sh, sm] = start24.split(':').map(Number);
    const [eh, em] = end24.split(':').map(Number);
    const diff = (eh * 60 + em) - (sh * 60 + sm);
    if (diff <= 0) return null;
    const hrs  = Math.floor(diff / 60);
    const mins = diff % 60;
    return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
}

function buildLogCard(l) {
    const duration     = calcTaskDuration(l.StartTime, l.EndTime, l.LogDate, l.EndDate || l.LogDate);
    const projectName  = l.Project || 'Untitled Task';
    const isCompleted  = l.Status === 'Completed';
    const hasStartTime = !!fmtTime(l.StartTime);
    const hasEndTime   = !!fmtTime(l.EndTime);
    const isMissingTimes = isCompleted && (!hasStartTime || !hasEndTime);
    const displayStatus  = l.IsOverdue ? 'Delayed' : l.Status;
    const deadlineLabel  = l.TaskDeadline
        ? `<span style="font-size:11px;color:#dc2626;font-weight:600;margin-left:6px;">⏰ Due ${fmtDate(l.TaskDeadline.split('T')[0])}</span>`
        : '';

    const cardStyle = isMissingTimes
        ? 'border-left:4px solid #dc2626;'
        : l.IsOverdue
            ? 'border-left:4px solid #dc2626;'
            : '';

    const timeHeaderHtml = (hasStartTime || hasEndTime) ? `
        <div class="log-card-time-header">
            ${hasStartTime ? `<span class="thr-start">▶ ${fmtTime(l.StartTime)}</span>` : ''}
            ${hasStartTime && hasEndTime ? `<span class="thr-sep">──────</span>` : ''}
            ${hasEndTime
                ? `<span class="thr-end">■ ${fmtTime(l.EndTime)}</span>`
                : `<span style="font-size:11px;color:#10b981;font-style:italic;">● ongoing</span>`}
            ${duration ? `<span class="thr-dur">⏱ ${duration}</span>` : ''}
        </div>` : '';

    return `
        <div class="log-card" style="${cardStyle}" data-log-id="${l.LogID}" data-task-id="${l.TaskID || ''}">
            <div class="log-card-header">
                <div class="log-card-title-section">
                    <div class="log-card-project-title">${esc(projectName)}${deadlineLabel}</div>
                    ${l.Client ? `<div class="log-card-client">👤 ${esc(l.Client)}</div>` : ''}
                </div>
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
                    ${isMissingTimes ? `<span style="background:#fee2e2;color:#991b1b;font-size:10px;font-weight:700;padding:4px 10px;border-radius:6px;">⚠️ Incomplete</span>` : ''}
                    <span class="log-card-status-badge ${statusClass(displayStatus)}">
                        <span>${getStatusIcon(displayStatus)}</span>
                        <span>${esc(displayStatus)}</span>
                    </span>
                    ${duration ? `<span class="log-card-time-badge">⏱ ${duration}</span>` : ''}
                </div>
            </div>
            ${timeHeaderHtml}
            <div class="log-card-meta">
                ${l.Client  ? `<div class="log-meta-item"><div class="log-meta-label">Client</div><div class="log-meta-value">${esc(l.Client)}</div></div>` : ''}
                ${l.Project ? `<div class="log-meta-item"><div class="log-meta-label">Project</div><div class="log-meta-value">${esc(l.Project)}</div></div>` : ''}
            </div>
            <div class="log-card-activity">
                <div class="log-activity-label">📝 Activity</div>
                <div class="log-activity-text">${esc(l.Activity)}</div>
            </div>
            ${l.Notes ? `<div class="log-card-notes expanded"><div class="log-notes-label">📌 Notes</div><div class="log-notes-text">${esc(l.Notes)}</div></div>` : ''}
            <div class="log-card-actions" style="margin-top:auto;padding-top:12px;border-top:1px solid #f1f5f9;">
                <button class="log-action-btn" data-edit="${l.LogID}">✏️ Edit</button>
                <button class="log-action-btn danger" data-del="${l.LogID}">🗑️ Delete</button>
            </div>
        </div>`;
}

function renderCardView() {
    const container = document.getElementById('logCardsContainer');
    if (!allLogs.length) {
        const label = currentDate ? fmtDate(currentDate) : 'the last 30 days';
        container.innerHTML = `
            <div style="grid-column:1/-1;">
                <div class="empty-log">
                    <svg viewBox="0 0 24 24" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                        <polyline points="10 9 9 9 8 9"/>
                    </svg>
                    <h3>No entries for ${label}</h3>
                    <p>Click "Add Entry" to log your work.</p>
                </div>
            </div>`;
        return;
    }

    let html = '';
    if (!currentDate) {
        // Group assigned-task entries by TaskID, standalone entries by date
        const taskGroups = {};  // taskId → { title, entries }
        const dateGroups = {};  // date → [entries without TaskID]

        allLogs.forEach(l => {
            if (l.TaskID) {
                if (!taskGroups[l.TaskID]) {
                    taskGroups[l.TaskID] = {
                        title: l.Project || (l.Activity || '').split('\n')[0].trim() || 'Task',
                        latestStatus: l.Status,
                        entries: []
                    };
                }
                taskGroups[l.TaskID].entries.push(l);
            } else {
                const d = (l.LogDate || '').split('T')[0];
                if (!dateGroups[d]) dateGroups[d] = [];
                dateGroups[d].push(l);
            }
        });

        // Task groups: each task's full history in a collapsible block
        Object.values(taskGroups).forEach(group => {
            let totalMins = 0;
            group.entries.forEach(e => {
                const dur = calcTaskDuration(e.StartTime, e.EndTime, e.LogDate, e.EndDate || e.LogDate);
                if (dur) {
                    const m = dur.match(/(?:(\d+)h)?\s*(?:(\d+)m)?/);
                    if (m) totalMins += (parseInt(m[1]) || 0) * 60 + (parseInt(m[2]) || 0);
                }
            });
            const totalDur = totalMins ? `${Math.floor(totalMins / 60)}h ${totalMins % 60}m` : null;
            const latest   = group.entries[0] || {};
            const ls       = latest.IsOverdue ? 'Delayed' : (latest.Status || '');

            html += `
                <div class="task-history-group">
                    <div class="task-history-group-header">
                        <span class="thg-icon">📋</span>
                        <span class="thg-title">${esc(group.title)}</span>
                        <span class="thg-count">${group.entries.length} ${group.entries.length === 1 ? 'entry' : 'entries'}</span>
                        ${totalDur ? `<span class="thg-dur">⏱ ${totalDur} total</span>` : ''}
                        ${ls ? `<span class="log-card-status-badge ${statusClass(ls)}" style="font-size:11px;padding:4px 10px;">${getStatusIcon(ls)} ${esc(ls)}</span>` : ''}
                    </div>
                    <div class="thg-entries">${group.entries.map(buildLogCard).join('')}</div>
                </div>`;
        });

        // Standalone entries grouped by date
        Object.keys(dateGroups).sort((a, b) => b.localeCompare(a)).forEach(date => {
            html += `<div style="padding:10px 0 4px;border-bottom:2px solid #e2e8f0;margin-bottom:4px;">
                <span style="font-size:13px;font-weight:700;color:#475569;">📅 ${fmtDate(date)}</span>
                <span style="font-size:12px;color:#94a3b8;margin-left:8px;">${dateGroups[date].length} ${dateGroups[date].length===1?'entry':'entries'}</span>
            </div>`;
            html += dateGroups[date].map(buildLogCard).join('');
        });
    } else {
        html = allLogs.map(buildLogCard).join('');
    }

    container.innerHTML = html;
    container.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openLogModal(allLogs.find(x => x.LogID === parseInt(b.dataset.edit, 10)))));
    container.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteLog(parseInt(b.dataset.del, 10))));
}

function renderTimelineView() {
    const container = document.getElementById('logTimelineContainer');
    if (!allLogs.length) {
        container.innerHTML = `
            <div class="empty-log">
                <svg viewBox="0 0 24 24" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                <h3>No entries for ${currentDate ? fmtDate(currentDate) : 'the last 30 days'}</h3>
                <p>Click "Add Entry" to log your work.</p>
            </div>`;
        return;
    }

    // Sort by date desc then start time

    const sorted = [...allLogs].sort((a, b) => {
        const timeA = extractTime24(a.StartTime) || '00:00';
        const timeB = extractTime24(b.StartTime) || '00:00';
        return timeA.localeCompare(timeB);
    });

    container.innerHTML = `
        <div class="log-timeline active">
            ${sorted.map((l) => {
                const startTime = fmtTime(l.StartTime) || 'No time';
                const endTime = fmtTime(l.EndTime) || '';
                const timeRange = endTime ? `${startTime} – ${endTime}` : startTime;
                const projectName = l.Project || 'Untitled Task';
                
                return `
                    <div class="log-timeline-item">
                        <div class="log-timeline-dot"></div>
                        <div class="log-timeline-content">
                            <div class="log-timeline-time">🕐 ${timeRange}</div>
                            <div class="log-timeline-title">${esc(projectName)}</div>
                            <div class="log-timeline-desc">
                                ${l.Client ? `<strong>Client:</strong> ${esc(l.Client)} | ` : ''}
                                <strong>Status:</strong> ${esc(l.Status)}
                            </div>
                            <div style="margin-top:8px;font-size:12px;color:#1e293b;line-height:1.5;">
                                ${esc(l.Activity)}
                            </div>
                            ${l.Notes ? `<div style="margin-top:6px;padding:8px;background:#fef8f0;border-radius:4px;font-size:11px;color:#92400e;">📌 ${esc(l.Notes)}</div>` : ''}
                            <div style="margin-top:8px;display:flex;gap:6px;">
                                <button class="log-action-btn" data-edit="${l.LogID}" style="font-size:11px;">✏️ Edit</button>
                                <button class="log-action-btn danger" data-del="${l.LogID}" style="font-size:11px;">🗑️ Delete</button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>`;

    container.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openLogModal(allLogs.find(x => x.LogID === parseInt(b.dataset.edit, 10)))));
    container.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteLog(parseInt(b.dataset.del, 10))));
}

function renderKanbanView() {
    const container = document.getElementById('logKanbanContainer');
    if (!allLogs.length) {
        container.innerHTML = `
            <div class="empty-log">
                <svg viewBox="0 0 24 24" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                    <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
                </svg>
                <h3>No entries for ${currentDate ? fmtDate(currentDate) : 'the last 30 days'}</h3>
                <p>Click "Add Entry" to log your work.</p>
            </div>`;
        return;
    }

    const statuses = ['To Be Started', 'In Progress', 'On Hold', 'Completed', 'Delayed'];
    const statusColors = {
        'To Be Started': '#f1f5f9',
        'In Progress': '#dbeafe',
        'On Hold': '#fef3c7',
        'Completed': '#dcfce7',
        'Delayed': '#fee2e2'
    };

    const grouped = {};
    statuses.forEach(s => grouped[s] = []);
    allLogs.forEach(l => {
        if (grouped[l.Status]) grouped[l.Status].push(l);
    });

    container.innerHTML = `
        <div class="log-kanban active">
            ${statuses.map(status => {
                const tasks = grouped[status] || [];
                return `
                    <div class="kanban-column">
                        <div class="kanban-column-header">
                            <span>${status}</span>
                            <span class="kanban-count">${tasks.length}</span>
                        </div>
                        <div class="kanban-cards" data-status="${status}">
                            ${tasks.map(l => {
                                const duration = calcTaskDuration(l.StartTime, l.EndTime, l.LogDate, l.EndDate || l.LogDate);
                                const projectName = l.Project || 'Untitled Task';
                                return `
                                    <div class="kanban-card" data-id="${l.LogID}" draggable="true">
                                        <div class="kanban-card-title">${esc(projectName)}</div>
                                        ${l.Client ? `<div class="kanban-card-client">${esc(l.Client)}</div>` : ''}
                                        <div class="kanban-card-info">${esc(l.Activity.substring(0, 60))}${l.Activity.length > 60 ? '...' : ''}</div>
                                        ${duration ? `<div class="kanban-card-info">⏱ ${duration}</div>` : ''}
                                        <div style="display:flex;gap:6px;margin-top:8px;">
                                            <button class="log-action-btn" data-edit="${l.LogID}" style="flex:1;font-size:10px;padding:4px 6px;">✏️ Edit</button>
                                            <button class="log-action-btn danger" data-del="${l.LogID}" style="flex:1;font-size:10px;padding:4px 6px;">🗑️ Delete</button>
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `;
            }).join('')}
        </div>`;

    container.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openLogModal(allLogs.find(x => x.LogID === parseInt(b.dataset.edit, 10)))));
    container.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteLog(parseInt(b.dataset.del, 10))));

    // Simple drag-and-drop for Kanban
    setupKanbanDragDrop();
}

function setupKanbanDragDrop() {
    const cards = document.querySelectorAll('.kanban-card');
    const columns = document.querySelectorAll('.kanban-cards');

    cards.forEach(card => {
        card.addEventListener('dragstart', (e) => {
            card.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));
    });

    columns.forEach(col => {
        col.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            col.style.background = '#e0f2fe';
        });
        col.addEventListener('dragleave', () => col.style.background = '');
        col.addEventListener('drop', (e) => {
            e.preventDefault();
            col.style.background = '';
            const draggingCard = document.querySelector('.kanban-card.dragging');
            if (draggingCard) {
                const newStatus = col.dataset.status;
                const logId = parseInt(draggingCard.dataset.id, 10);
                updateLogStatus(logId, newStatus);
            }
        });
    });
}

async function updateLogStatus(logId, newStatus) {
    try {
        const log = allLogs.find(l => l.LogID === logId);
        if (!log) return;
        
        const payload = {
            logDate: log.LogDate,
            client: log.Client || '',
            project: log.Project || '',
            activity: log.Activity,
            startTime: fmtTime(log.StartTime) || '',
            endTime: fmtTime(log.EndTime) || '',
            status: newStatus,
            notes: log.Notes || ''
        };
        
        await apiCall(`/task-logs/${logId}`, { method: 'PUT', body: JSON.stringify(payload) });
        loadLogs();
        showLogMsg(`Task moved to "${newStatus}"`, 'success');
    } catch (e) {
        showLogMsg(e.message, 'error');
    }
}


function renderSummary() {
    const el = document.getElementById('logSummary');
    if (!allLogs.length) { el.style.display = 'none'; return; }
    el.style.display = 'flex';

    const total     = allLogs.length;
    const completed = allLogs.filter(l => l.Status === 'Completed').length;
    const inProg    = allLogs.filter(l => l.Status === 'In Progress').length;
    const onHold    = allLogs.filter(l => l.Status === 'On Hold').length;

    let minutes = 0;
    allLogs.forEach(l => {
        const duration = calcTaskDuration(l.StartTime, l.EndTime, l.LogDate, l.EndDate || l.LogDate);
        if (duration) {
            const parts = duration.match(/(\d+)h?\s*(\d+)?m?/);
            if (parts) {
                const h = parseInt(parts[1]) || 0;
                const m = parseInt(parts[2]) || 0;
                minutes += h * 60 + m;
            }
        }
    });
    const hrsLogged = minutes ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : '—';

    el.innerHTML = `
        <div class="log-summary-card"><div class="log-summary-val">${total}</div><div class="log-summary-lbl">📋 Total Entries</div></div>
        <div class="log-summary-card"><div class="log-summary-val" style="color:#166534;">${completed}</div><div class="log-summary-lbl">✓ Completed</div></div>
        <div class="log-summary-card"><div class="log-summary-val" style="color:#1e40af;">${inProg}</div><div class="log-summary-lbl">⏳ In Progress</div></div>
        <div class="log-summary-card"><div class="log-summary-val" style="color:#92400e;">${onHold}</div><div class="log-summary-lbl">⏸ On Hold</div></div>
        <div class="log-summary-card"><div class="log-summary-val">${hrsLogged}</div><div class="log-summary-lbl">⏱ Hours Logged</div></div>
    `;
}

/* ── Clients dropdown ── */

async function loadClients() {
    try {
        const res = await apiCall('/clients');
        clientsList = res.clients || [];
        populateClientDropdown();
    } catch (e) {
        console.error('Failed to load clients:', e);
    }
}

function populateClientDropdown() {
    const sel = document.getElementById('formClient');
    if (!sel) return;
    // Keep the first placeholder option, remove the rest
    sel.innerHTML = '<option value="">— Select Client —</option>';
    clientsList.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.cliClientName;
        opt.textContent = c.cliClientName;
        sel.appendChild(opt);
    });
}

/* ── Modal ── */

function openLogModal(item) {
    document.getElementById('logModalTitle').textContent = item ? 'Edit Entry' : 'Add Log Entry';
    document.getElementById('logFormId').value    = item ? item.LogID : '';
    const startDateVal = item ? (item.LogDate ? item.LogDate.split('T')[0] : (currentDate || todayStr())) : (currentDate || todayStr());
    document.getElementById('formDate').value     = startDateVal;
    document.getElementById('formEndDate').value  = item ? (item.EndDate ? item.EndDate.split('T')[0] : startDateVal) : startDateVal;
    document.getElementById('formProject').value  = item ? (item.Project   || '') : '';
    document.getElementById('formActivity').value = item ? (item.Activity  || '') : '';
    // Use extractTime24 for form inputs (needs 24-hour format)
    document.getElementById('formStartTime').value= item ? (extractTime24(item.StartTime) || '') : '';
    document.getElementById('formEndTime').value  = item ? (extractTime24(item.EndTime)   || '') : '';
    document.getElementById('formStatus').value   = item ? (item.Status    || 'In Progress') : 'In Progress';
    document.getElementById('formNotes').value    = item ? (item.Notes     || '') : '';

    // Set client dropdown value — match by name
    const clientSel = document.getElementById('formClient');
    if (clientSel) {
        const clientName = item ? (item.Client || '') : '';
        clientSel.value = clientName;
        // If the value didn't match any option (e.g., old freetext entry), add it temporarily
        if (clientSel.value !== clientName && clientName) {
            const opt = document.createElement('option');
            opt.value = clientName;
            opt.textContent = clientName + ' (legacy)';
            clientSel.appendChild(opt);
            clientSel.value = clientName;
        }
    }

    const msgEl = document.getElementById('logMsg');
    if (msgEl) msgEl.style.display = 'none';

    document.getElementById('logModal').style.display = 'flex';
    document.getElementById('formActivity').focus();
}

function closeLogModal() {
    document.getElementById('logModal').style.display = 'none';
    document.getElementById('logForm').reset();
}

/* ── Validation & Helpers ── */

function checkTimeOverlap(logs, date, startTime, endTime, excludeId = null) {
    /**
     * Checks if proposed time overlaps with other tasks on the same day
     * Returns overlapping task or null
     */
    for (const log of logs) {
        if (excludeId && log.LogID === parseInt(excludeId, 10)) continue; // Skip current task
        if (log.LogDate !== date) continue; // Different date
        if (!log.StartTime || !log.EndTime) continue; // No times to compare
        
        const logStart = log.StartTime;
        const logEnd = log.EndTime;
        
        // Check overlap: start < other.end AND end > other.start
        if (startTime < logEnd && endTime > logStart) {
            return log; // Overlap found
        }
    }
    return null;
}

async function saveLog(e) {
    e.preventDefault();
    const id        = document.getElementById('logFormId').value;
    const logDate   = document.getElementById('formDate').value;
    const endDate   = document.getElementById('formEndDate').value || logDate;
    const startTime = document.getElementById('formStartTime').value;
    const endTime   = document.getElementById('formEndTime').value;
    const status    = document.getElementById('formStatus').value;
    const activity  = document.getElementById('formActivity').value.trim();

    // Validation: Activity required
    if (!activity) {
        showLogMsg('Activity is required', 'error');
        return;
    }

    // Validation: Status-based timestamp requirements
    if (status === 'Completed') {
        if (!startTime || !endTime) {
            showLogMsg('✓ Completed tasks must have both start and end times', 'error');
            return;
        }
    }

    // Validation: Full datetime comparison (supports overnight/cross-day)
    if (startTime && endTime) {
        if (endDate < logDate) {
            showLogMsg('❌ End date cannot be before start date', 'error');
            return;
        }
        const startDT = new Date(`${logDate}T${startTime}`);
        const endDT   = new Date(`${endDate}T${endTime}`);
        if (endDT <= startDT) {
            if (endDate === logDate) {
                showLogMsg('⏱ End time must be after start time for same-day entries', 'error');
            } else {
                showLogMsg('⏱ End date/time must be after start date/time', 'error');
            }
            return;
        }

        // Overlap check (same-day only)
        if (endDate === logDate) {
            const overlap = checkTimeOverlap(allLogs, logDate, startTime, endTime, id);
            if (overlap) {
                if (!confirm(`⚠️ This overlaps with "${overlap.Project}". Continue anyway (multitasking)?`)) {
                    return;
                }
            }
        }
    }

    const payload = {
        logDate,
        endDate:   endDate !== logDate ? endDate : undefined,
        client:    document.getElementById('formClient').value.trim(),
        project:   document.getElementById('formProject').value.trim(),
        activity,
        startTime: startTime || '',
        endTime:   endTime || '',
        status,
        notes:     document.getElementById('formNotes').value.trim(),
    };

    const btn = document.getElementById('logSubmitBtn');
    btn.disabled = true; btn.textContent = 'Saving…';

    try {
        if (id) {
            await apiCall(`/task-logs/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
        } else {
            await apiCall('/task-logs', { method: 'POST', body: JSON.stringify(payload) });
        }

        // Sync status to the linked Task row on every save
        const existingLog = allLogs.find(l => String(l.LogID) === String(id))
                         || todayActivities.find(a => String(a.LogID) === String(id));
        const taskId = existingLog?.TaskID
                    || new URLSearchParams(window.location.search).get('taskId');
        if (taskId) {
            try {
                await apiCall(`/tasks/${taskId}`, {
                    method: 'PUT',
                    body: JSON.stringify({ Status: status })
                });
            } catch (_) { /* non-fatal */ }
        }

        closeLogModal();
        setDate(payload.logDate);
    } catch (err) {
        showLogMsg(err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Save Entry';
    }
}

async function deleteLog(id) {
    if (!confirm('Delete this log entry?')) return;
    try {
        await apiCall(`/task-logs/${id}`, { method: 'DELETE' });
        await loadLogs();
    } catch (e) {
        showLogMsg(e.message, 'error');
    }
}

/* ── Helpers ── */

function showLogMsg(text, type) {
    const el = document.getElementById('logMsg');
    if (!el) return;
    el.textContent = text;
    el.className   = `message ${type}`;
    el.style.display = 'block';
    if (type === 'success') setTimeout(() => { el.style.display = 'none'; }, 3000);
}

function statusClass(s) {
    const map = {
        'Completed':   'status-completed',
        'In Progress': 'status-in-progress',
        'On Hold':     'status-on-hold',
        'Delayed':     'status-delayed',
        'To Be Started': 'status-pending',
    };
    return map[s] || 'status-pending';
}

function fmtDate(d) {
    if (!d) return '—';
    const dt = new Date(d);
    return dt.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric', year:'numeric' });
}

function esc(s) {
    if (s == null) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function fmtTime(t) {
    if (!t) return '';
    let timeStr = '';
    
    // SQL TIME comes as ISO string like "1970-01-01T09:30:00.000Z" or "09:30:00"
    if (typeof t === 'string' && t.includes('T')) {
        const dt = new Date(t);
        if (!isNaN(dt)) {
            timeStr = dt.toISOString().slice(11, 16); // "HH:MM"
        }
    } else {
        // Already "HH:MM" or "HH:MM:SS"
        const m = String(t).match(/(\d{2}:\d{2})/);
        timeStr = m ? m[1] : '';
    }
    
    // Convert to 12-hour AM/PM format
    return convert24to12(timeStr);
}

function convert24to12(time24) {
    if (!time24 || !time24.includes(':')) return '';
    const [hours, minutes] = time24.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const hours12 = hours % 12 || 12;
    return `${hours12}:${String(minutes).padStart(2, '0')} ${period}`;
}

function convert12to24(time12) {
    if (!time12) return '';
    const match = String(time12).match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!match) return '';
    let [, h, m, period] = match;
    h = parseInt(h, 10);
    const p = period.toUpperCase();
    if (p === 'PM' && h < 12) h += 12;
    if (p === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${m}`;
}

function extractTime24(timeValue) {
    /**
     * Extract 24-hour time (HH:MM) from stored value
     * For use in HTML time input fields
     */
    if (!timeValue) return '';
    
    // ISO string with T (from database)
    if (typeof timeValue === 'string' && timeValue.includes('T')) {
        const dt = new Date(timeValue);
        if (!isNaN(dt)) {
            return dt.toISOString().slice(11, 16); // "HH:MM"
        }
    }
    
    // Already HH:MM or HH:MM:SS format
    const match = String(timeValue).match(/(\d{2}):(\d{2})/);
    return match ? match[1] : '';
}

/* ══════════════════════════════════════════════════════════════
   ACTIVITY TRACKER
   ══════════════════════════════════════════════════════════════ */

async function loadTodayActivities() {
    try {
        const res = await apiCall(`/task-logs?date=${todayStr()}`);
        todayActivities = res.logs || [];
        renderActivityList();
    } catch (e) {
        showActivityMsg('Could not load activities: ' + e.message, 'error');
    }
}

function renderActivityList() {
    const container = document.getElementById('activityList');
    if (!container) return;

    if (!todayActivities.length) {
        container.innerHTML = `<div class="activity-empty">
            No activities yet for today. Click <strong>+ New Activity</strong> to start tracking.
        </div>`;
        return;
    }

    // Show all activities, newest on top
    const toShow = [...todayActivities].reverse();

    container.innerHTML = toShow.map(a => buildActivityRow(a, todayActivities.indexOf(a))).join('');

    // Wire up buttons and description textarea
    toShow.forEach(a => {
        const row = container.querySelector(`[data-act-id="${a.LogID}"]`);
        if (!row) return;

        const textarea = row.querySelector('.activity-desc');
        if (textarea) {
            textarea.addEventListener('input', () => scheduleDescSave(a.LogID, textarea.value));
        }

        row.querySelector('[data-act-start]')?.addEventListener('click',    () => actStart(a.LogID));
        row.querySelector('[data-act-pause]')?.addEventListener('click',    () => actPause(a.LogID));
        row.querySelector('[data-act-resume]')?.addEventListener('click',   () => actResume(a.LogID));
        row.querySelector('[data-act-postpone]')?.addEventListener('click', () => actPostpone(a.LogID));
        row.querySelector('[data-act-complete]')?.addEventListener('click', () => actComplete(a.LogID));
        row.querySelector('[data-act-unassign]')?.addEventListener('click', () => actUnassign(a.LogID));
        row.querySelector('[data-act-delete]')?.addEventListener('click',   () => actDelete(a.LogID));
    });

    // Live ticking clock for running activities
    clearInterval(window._actTimerTick);
    const timerEls = container.querySelectorAll('.act-live-timer');
    if (timerEls.length) {
        window._actTimerTick = setInterval(() => {
            timerEls.forEach(el => {
                const el2 = el.querySelector('.act-live-elapsed');
                if (el2) el2.textContent = calcElapsedTime(el.dataset.startTime);
            });
        }, 1000);
    }
}

function buildActivityRow(a, index) {
    const status = (a.Status === 'Pending' || !a.Status) ? 'To Be Started' : a.Status;
    const isAssigned = !!a.TaskID;
    const isOverdue  = !!a.IsOverdue;
    const displayStatus = isOverdue ? 'Delayed' : status;
    const rowClass = {
        'In Progress':   'status-running',
        'Paused':        'status-paused',
        'Postponed':     'status-postponed',
        'Completed':     'status-done',
        'Delayed':       'status-delayed',
        'To Be Started': 'status-pending',
    }[displayStatus] || 'status-pending';

    const badge = buildBadge(displayStatus);
    const btns  = buildButtons(a);

    // Task title: prefer Project, then first line of Activity
    const taskTitle = (a.Project || (a.Activity || '').split('\n')[0].trim()).slice(0, 80);

    // Duration if both times exist
    const duration = calcTaskDuration(a.StartTime, a.EndTime, a.LogDate, a.EndDate || a.LogDate);

    // Time range — only shown below when activity has ended (paused/completed)
    const isRunning = status === 'In Progress' && !a.EndTime;
    let timeRangeHtml = '';
    if (a.StartTime && !isRunning) {
        const startFmt = fmtTime(a.StartTime);
        const endFmt   = a.EndTime ? fmtTime(a.EndTime) : null;
        timeRangeHtml = `
            <div class="act-time-range">
                <span>▶ ${startFmt}</span>
                ${endFmt
                    ? `<span style="color:#cbd5e1;">→</span><span style="color:#166534;">■ ${endFmt}</span>`
                    : ''}
                ${duration ? `<span class="dur-pill">${duration}</span>` : ''}
            </div>`;
    }

    // Live timer shown on right side of header when running
    const liveTimerHtml = isRunning
        ? `<div class="act-live-timer" data-start-time="${a.StartTime}">
               <span class="act-live-dot">●</span>
               <span class="act-live-elapsed">${calcElapsedTime(a.StartTime)}</span>
           </div>`
        : '';

    // Meta line (assigned-by + deadline)
    let metaHtml = '';
    if (isAssigned) {
        const match = (a.Notes || '').match(/Assigned by ([^·\n]+)/);
        const assignedBy = match ? match[1].trim() : '';
        const deadlinePart = a.TaskDeadline
            ? `<span style="font-size:11px;color:${isOverdue ? '#dc2626' : '#64748b'};">${isOverdue ? '⏰ Overdue — ' : '📅 '}Due ${fmtDate(a.TaskDeadline.split('T')[0])}</span>`
            : '';
        if (assignedBy || deadlinePart) {
            metaHtml = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
                ${assignedBy ? `<span style="font-size:11px;color:#64748b;">by ${esc(assignedBy)}</span>` : ''}
                ${deadlinePart}
            </div>`;
        }
    }

    const descPlaceholder = status === 'To Be Started'
        ? (isAssigned ? 'Add notes about this task…' : 'Describe your activity, then click Start Activity…')
        : 'Activity description';

    return `
        <div class="activity-row ${rowClass}" data-act-id="${a.LogID}" data-task-id="${a.TaskID || ''}"
             style="${isOverdue ? 'border-left:4px solid #dc2626;background:#fff5f5;' : isAssigned ? 'border-left:4px solid #3b82f6;' + (status === 'To Be Started' ? 'background:#f0f9ff;' : '') : ''}">

            <div class="act-row-head">
                <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
                    <span class="act-num">#${(index ?? 0) + 1}</span>
                    ${taskTitle ? `<span class="act-head-title" title="${esc(a.Project || '')}">${esc(taskTitle)}</span>` : ''}
                    ${isAssigned ? `<span class="act-tag act-tag-assigned">📋 Assigned</span>` : ''}
                    ${isOverdue  ? `<span class="act-tag act-tag-overdue">⚠️ Overdue</span>`  : ''}
                </div>
                <div style="flex-shrink:0;">${badge}</div>
            </div>

            ${timeRangeHtml}

            <div class="activity-desc-wrap">
                ${metaHtml}
                <textarea class="activity-desc" rows="3"
                    placeholder="${descPlaceholder}"
                    ${status === 'Completed' ? 'readonly' : ''}
                >${esc(a.Activity || '')}</textarea>
                ${status === 'To Be Started' && !isAssigned ? '<div class="activity-desc-hint">Description is optional before starting; you can type and save automatically.</div>' : ''}
            </div>

            <div class="act-row-footer">${btns}</div>
        </div>`;
}

function buildBadge(status) {
    const cfg = {
        'To Be Started': { cls: 'badge-pending', icon: '○',  label: 'To Be Started' },
        'Pending':       { cls: 'badge-pending', icon: '○',  label: 'To Be Started' },
        'In Progress':   { cls: 'badge-running', icon: '▶',  label: 'Running' },
        'Paused':        { cls: 'badge-paused',  icon: '⏸',  label: 'Paused' },
        'Postponed':     { cls: 'badge-postponed', icon: '⏭', label: 'Postponed' },
        'Completed':     { cls: 'badge-done',    icon: '✓',  label: 'Completed' },
        'Delayed':       { cls: 'badge-delayed', icon: '⚠',  label: 'Delayed' },
    };
    const c = cfg[status] || cfg['To Be Started'];
    return `<span class="activity-status-badge ${c.cls}">${c.icon} ${c.label}</span>`;
}

function buildTimes(a) {
    const parts = [];
    if (a.StartTime) parts.push(`<span>▶ Start: ${fmtTime(a.StartTime)}</span>`);
    if (a.EndTime)   parts.push(`<span>■ End: ${fmtTime(a.EndTime)}</span>`);
    if (!parts.length) return '';
    return `<div class="activity-times">${parts.join('')}</div>`;
}

function buildButtons(a) {
    const s = (a.Status === 'Pending' || !a.Status) ? 'To Be Started' : a.Status;
    const isRunning   = s === 'In Progress';
    const isPaused    = s === 'Paused';
    const isPostponed = s === 'Postponed';
    const isPending   = s === 'To Be Started';
    const isDone      = s === 'Completed';

    if (isDone) {
        return `<button class="act-btn act-btn-delete" data-act-delete title="Remove log">✕</button>`;
    }

    let html = '';

    if (isPending) {
        html += `<button class="act-btn act-btn-start" data-act-start>▶ Start Activity</button>`;
    }

    if (isRunning) {
        html += `<button class="act-btn act-btn-pause"     data-act-pause>⏸ Pause</button>`;
        html += `<button class="act-btn act-btn-postpone"  data-act-postpone>⏭ Postpone</button>`;
        html += `<button class="act-btn act-btn-complete"  data-act-complete>✓ Complete</button>`;
        html += `<button class="act-btn act-btn-unassign"  data-act-unassign title="Reset to To Be Started">↺ Unassign</button>`;
    }

    if (isPaused || isPostponed) {
        html += `<button class="act-btn act-btn-resume"    data-act-resume>▶ Resume</button>`;
        html += `<button class="act-btn act-btn-complete"  data-act-complete disabled title="Resume first">✓ Complete</button>`;
        html += `<button class="act-btn act-btn-unassign"  data-act-unassign title="Reset to To Be Started">↺ Unassign</button>`;
    }

    html += `<button class="act-btn act-btn-delete" data-act-delete title="Delete activity">✕</button>`;
    return html;
}

/* ── Actions ── */

async function newActivity() {
    try {
        const res = await apiCall('/task-logs/new-activity', { method: 'POST' });
        todayActivities.push(res.log);
        renderActivityList();
        // Focus the new textarea
        const rows = document.querySelectorAll('[data-act-id]');
        const last = rows[rows.length - 1];
        last?.querySelector('.activity-desc')?.focus();
    } catch (e) {
        showActivityMsg('Could not add activity: ' + e.message, 'error');
    }
}

function scheduleDescSave(logId, value) {
    clearTimeout(descSaveTimers[logId]);
    descSaveTimers[logId] = setTimeout(() => saveDescription(logId, value), 900);
}

async function saveDescription(logId, value) {
    try {
        const res = await apiCall(`/task-logs/${logId}/description`, {
            method: 'POST',
            body: JSON.stringify({ activity: value }),
        });
        updateLocalActivity(res.log);
    } catch (e) {
        console.warn('Description auto-save failed:', e.message);
    }
}

async function actStart(logId) {
    clearTimeout(descSaveTimers[logId]);
    const textarea = document.querySelector(`[data-act-id="${logId}"] .activity-desc`);
    const value = (textarea?.value || '').trim() || 'PERSONAL WORK';
    if (textarea && !textarea.value.trim()) textarea.value = value;
    await saveDescription(logId, value);
    await actAction(logId, 'start');
}

async function actPause(logId)    { await actAction(logId, 'pause'); }
async function actResume(logId)   { await actAction(logId, 'resume'); }
async function actPostpone(logId) { await actAction(logId, 'postpone'); }
async function actUnassign(logId) {
    if (!confirm('Reset this activity to Pending? The start time will be cleared.')) return;
    await actAction(logId, 'unassign');
}

async function actComplete(logId) {
    // 1. Mark completed on server (EndTime auto-set)
    let log;
    try {
        const res = await apiCall(`/task-logs/${logId}/complete`, { method: 'POST' });
        log = res.log;
        updateLocalActivity(log);
        renderActivityList();
    } catch (e) {
        showActivityMsg(e.message, 'error');
        return;
    }

    // 2. Push Completed status to the Tasks table
    await pushTaskStatus(log, 'complete');

    // 3. Open Daily Log form pre-filled so employee can add Client/Project/Notes
    openLogModal(log);

    // Reload log history for the current date view when modal closes
    const origClose = window._origCloseLogModal;
    if (!origClose) {
        window._origCloseLogModal = closeLogModal;
        window.closeLogModal = function () {
            window._origCloseLogModal();
            loadTodayActivities();
            if (!currentDate || currentDate === todayStr()) loadLogs();
        };
    }
}

async function actDelete(logId) {
    if (!confirm('Delete this activity entry?')) return;
    try {
        await apiCall(`/task-logs/${logId}`, { method: 'DELETE' });
        todayActivities = todayActivities.filter(a => a.LogID !== logId);
        renderActivityList();
        if (!currentDate || currentDate === todayStr()) loadLogs();
    } catch (e) {
        showActivityMsg(e.message, 'error');
    }
}

/* ── Task highlight (navigated from task list) ────────────── */

function highlightTaskEntry(taskId, taskTitle) {
    // Look in activity tracker first (today's activities)
    const actRow = document.querySelector(`.activity-row[data-task-id="${taskId}"]`);
    if (actRow) {
        actRow.classList.add('task-entry-highlight');
        actRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        showTaskBanner(taskTitle, true);
        return;
    }

    // Look in log cards (historical view)
    const logCard = document.querySelector(`.log-card[data-task-id="${taskId}"]`);
    if (logCard) {
        logCard.classList.add('task-entry-highlight');
        logCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        showTaskBanner(taskTitle, true);
        return;
    }

    // No log entry found — show banner prompting the user to create one
    showTaskBanner(taskTitle, false);
}

function showTaskBanner(taskTitle, found) {
    const existing = document.getElementById('taskHighlightBanner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'taskHighlightBanner';

    if (found) {
        banner.style.cssText = `
            position:fixed;top:72px;left:50%;transform:translateX(-50%);
            background:#10b981;color:#fff;font-size:13px;font-weight:700;
            padding:10px 22px;border-radius:10px;z-index:9999;
            box-shadow:0 4px 16px rgba(16,185,129,.4);
            display:flex;align-items:center;gap:8px;white-space:nowrap;
            animation:slideDown .3s ease;`;
        banner.innerHTML = `<span>📋</span> Task highlighted: <em style="font-style:normal;font-weight:900;">${taskTitle || 'Selected Task'}</em>`;
    } else {
        banner.style.cssText = `
            position:fixed;top:72px;left:50%;transform:translateX(-50%);
            background:#3b82f6;color:#fff;font-size:13px;font-weight:700;
            padding:10px 22px;border-radius:10px;z-index:9999;
            box-shadow:0 4px 16px rgba(59,130,246,.4);
            display:flex;align-items:center;gap:8px;white-space:nowrap;
            animation:slideDown .3s ease;`;
        banner.innerHTML = `<span>📋</span> <em style="font-style:normal;font-weight:900;">${taskTitle || 'Task'}</em> — no log entry yet. Click <strong>+ New Activity</strong> to start.`;
    }

    document.body.appendChild(banner);
    setTimeout(() => {
        banner.style.opacity = '0';
        banner.style.transition = 'opacity .5s';
        setTimeout(() => banner.remove(), 500);
    }, 4000);
}

/* Maps a task-log action to the corresponding Tasks.Status value */
const ACTION_TO_TASK_STATUS = {
    start:     'In Progress',
    pause:     'On Hold',
    postpone:  'On Hold',
    resume:    'In Progress',
    unassign:  'To Be Started',
    complete:  'Completed',
};

async function pushTaskStatus(log, action) {
    const taskStatus = ACTION_TO_TASK_STATUS[action];
    if (!taskStatus) return;

    // 1. TaskID on the log row  2. URL param  3. sessionStorage set by dashboard
    const taskId = log?.TaskID
        || new URLSearchParams(window.location.search).get('taskId')
        || sessionStorage.getItem('gvp_activeTaskId');

    if (!taskId) return;

    try {
        await apiCall(`/tasks/${taskId}`, {
            method: 'PUT',
            body: JSON.stringify({ Status: taskStatus })
        });
        // Once task reaches a terminal/idle state, clear the stored reference
        if (taskStatus === 'Completed' || taskStatus === 'To Be Started') {
            sessionStorage.removeItem('gvp_activeTaskId');
        }
    } catch (e) {
        console.warn('pushTaskStatus failed:', e.message);
    }
}

async function actAction(logId, action) {
    try {
        const res = await apiCall(`/task-logs/${logId}/${action}`, { method: 'POST' });
        updateLocalActivity(res.log);
        renderActivityList();
        await pushTaskStatus(res.log, action);
    } catch (e) {
        showActivityMsg(e.message, 'error');
    }
}

function updateLocalActivity(updatedLog) {
    const idx = todayActivities.findIndex(a => a.LogID === updatedLog.LogID);
    if (idx !== -1) todayActivities[idx] = updatedLog;
}

function showActivityMsg(text, type) {
    const el = document.getElementById('activityMsg');
    if (!el) return;
    el.textContent = text;
    el.className = `message ${type}`;
    el.style.display = 'block';
    if (type === 'success') setTimeout(() => { el.style.display = 'none'; }, 3000);
}
