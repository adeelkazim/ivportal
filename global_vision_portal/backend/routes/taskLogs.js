/* ── Task Log Routes ───────────────────────────────────────────────
   Handles all /api/task-logs endpoints.
   Status lifecycle for Activity List:
     Pending → In Progress → Paused | Postponed → In Progress → Completed
   ─────────────────────────────────────────────────────────────── */

function localDateStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function mapLog(row) {
    return {
        LogID:      row.LogID,
        EmployeeID: row.EmployeeID,
        LogDate:    row.LogDate,
        EndDate:    row.EndDate || null,
        Client:     row.Client,
        Project:    row.Project,
        Activity:   row.Activity,
        StartTime:  row.StartTime,
        EndTime:    row.EndTime,
        Status:     row.Status,
        Notes:      row.Notes,
        CreatedAt:    row.CreatedAt,
        UpdatedAt:    row.UpdatedAt,
        TaskID:       row.TaskID || null,
        TaskDeadline: row.TaskDeadline || null,
        IsOverdue:    row.IsOverdue === 1 || row.IsOverdue === true,
    };
}

// Build a JS Date from a date string + time string (HH:MM:SS) for cross-day validation
function toDateTime(dateStr, timeStr) {
    if (!dateStr || !timeStr) return null;
    return new Date(`${dateStr}T${timeStr}`);
}


function toTimeOrNull(val) {
    // Accept "HH:MM" or "HH:MM:SS"; return null for empty/falsy
    if (!val || String(val).trim() === '') return null;
    const m = String(val).match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    return `${m[1].padStart(2,'0')}:${m[2]}:00`;
}

function registerTaskLogRoutes(app, ctx) {
    // Access pool lazily via getter so it resolves after connectToDatabase()
    const { sql, authMiddleware, requireDb } = ctx;

    async function syncToTask(taskId, taskStatus) {
        if (!taskId) return;
        const statusToStore = taskStatus === 'Postponed' ? 'In Progress' : taskStatus;
        const isCompleted = statusToStore === 'Completed';
        try {
            const req = ctx.pool.request()
                .input('id',     sql.Int,      taskId)
                .input('status', sql.NVarChar, statusToStore);
            if (isCompleted) {
                req.input('completedAt', sql.DateTime, new Date());
                await req.query(`UPDATE Tasks SET Status = @status, UpdatedAt = GETDATE(), CompletedDate = @completedAt WHERE TaskID = @id`);
            } else {
                await req.query(`UPDATE Tasks SET Status = @status, UpdatedAt = GETDATE(), CompletedDate = NULL WHERE TaskID = @id`);
            }
        } catch (e) {
            console.warn('syncToTask failed:', e.message);
        }
    }

    /* ── GET /api/task-logs ─────────────────────────────────────── */
    app.get('/api/task-logs', authMiddleware, requireDb, async (req, res) => {
        try {
            const logSelect = `
                dl.*,
                t.Deadline AS TaskDeadline,
                CASE
                    WHEN dl.TaskID IS NOT NULL
                     AND t.Deadline < GETDATE()
                     AND dl.Status NOT IN ('Completed')
                    THEN 1 ELSE 0
                END AS IsOverdue
            `;
            let result;
            if (req.query.all === 'true' || !req.query.date) {
                result = await ctx.pool.request()
                    .input('empId', sql.Int, req.user.employeeId)
                    .query(`
                        SELECT ${logSelect}
                        FROM DailyTaskLogs dl
                        LEFT JOIN Tasks t ON t.TaskID = dl.TaskID
                        WHERE dl.EmployeeID = @empId
                          AND dl.LogDate >= CAST(DATEADD(DAY, -30, GETDATE()) AS DATE)
                        ORDER BY dl.LogDate DESC, dl.CreatedAt ASC
                    `);
            } else {
                const dateStr = req.query.date;
                result = await ctx.pool.request()
                    .input('empId', sql.Int,          req.user.employeeId)
                    .input('date',  sql.NVarChar(10), dateStr)
                    .query(`
                        SELECT ${logSelect}
                        FROM DailyTaskLogs dl
                        LEFT JOIN Tasks t ON t.TaskID = dl.TaskID
                        WHERE dl.EmployeeID = @empId
                          AND CONVERT(VARCHAR(10), dl.LogDate, 120) = @date
                        ORDER BY dl.CreatedAt ASC
                    `);
            }
            res.json({ success: true, logs: result.recordset.map(mapLog) });
        } catch (e) {
            console.error('Get task logs:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    /* ── POST /api/task-logs/new-activity ──────────────────────────
       Creates a blank activity slot for today.
       Must come BEFORE the /:id routes so it isn't treated as an ID. */
    app.post('/api/task-logs/new-activity', authMiddleware, requireDb, async (req, res) => {
        try {
            const insert = await ctx.pool.request()
                .input('empId', sql.Int,           req.user.employeeId)
                .input('act',   sql.NVarChar(500), 'PERSONAL WORK')
                .query(`
                    INSERT INTO DailyTaskLogs (EmployeeID, LogDate, Activity, Status)
                    OUTPUT INSERTED.*
                    VALUES (@empId, CAST(GETDATE() AS DATE), @act, 'To Be Started')
                `);
            res.status(201).json({ success: true, log: mapLog(insert.recordset[0]) });
        } catch (e) {
            console.error('New activity:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    /* ── POST /api/task-logs ────────────────────────────────────── */
    app.post('/api/task-logs', authMiddleware, requireDb, async (req, res) => {
        try {
            const { logDate, endDate, client, project, activity, startTime, endTime, status, notes } = req.body;

            if (!activity && activity !== '') {
                return res.status(400).json({ error: 'Activity is required' });
            }
            if (status === 'Completed' && (!startTime || !endTime)) {
                return res.status(400).json({ error: 'Completed tasks require both start and end times' });
            }

            const startDateStr = logDate || localDateStr();
            const endDateStr   = endDate  || startDateStr;
            const start = toTimeOrNull(startTime);
            const end   = toTimeOrNull(endTime);

            if (start && end) {
                if (endDateStr < startDateStr) {
                    return res.status(400).json({ error: 'End date cannot be before start date' });
                }
                const startDT = toDateTime(startDateStr, start);
                const endDT   = toDateTime(endDateStr,   end);
                if (startDT && endDT && endDT <= startDT) {
                    return res.status(400).json({ error: 'End date/time must be after start date/time' });
                }
            }

            const storedEndDate = endDateStr !== startDateStr ? endDateStr : null;
            const insert = await ctx.pool.request()
                .input('empId',   sql.Int,              req.user.employeeId)
                .input('date',    sql.NVarChar(10),      startDateStr)
                .input('endDate', sql.NVarChar(10),      storedEndDate)
                .input('client',  sql.NVarChar(30),      client  || null)
                .input('project', sql.NVarChar(50),      project || null)
                .input('act',     sql.NVarChar(500),     activity)
                .input('start',   sql.NVarChar(10),      start)
                .input('end',     sql.NVarChar(10),      end)
                .input('status',  sql.NVarChar(50),      status || 'To Be Started')
                .input('notes',   sql.NVarChar(sql.MAX), notes || null)
                .query(`
                    INSERT INTO DailyTaskLogs
                        (EmployeeID, LogDate, EndDate, Client, Project, Activity, StartTime, EndTime, Status, Notes)
                    OUTPUT INSERTED.*
                    VALUES
                        (@empId, CAST(@date AS DATE), TRY_CAST(@endDate AS DATE),
                         @client, @project, @act,
                         TRY_CAST(@start AS TIME), TRY_CAST(@end AS TIME), @status, @notes)
                `);
            res.status(201).json({ success: true, log: mapLog(insert.recordset[0]) });
        } catch (e) {
            console.error('Create task log:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    /* ── PUT /api/task-logs/:id ─────────────────────────────────── */
    app.put('/api/task-logs/:id', authMiddleware, requireDb, async (req, res) => {
        try {
            const logId = parseInt(req.params.id, 10);
            if (isNaN(logId)) return res.status(400).json({ error: 'Invalid log id' });

            const { logDate, endDate, client, project, activity, startTime, endTime, status, notes } = req.body;

            const owns = await ctx.pool.request()
                .input('id',    sql.Int, logId)
                .input('empId', sql.Int, req.user.employeeId)
                .query('SELECT LogID, LogDate FROM DailyTaskLogs WHERE LogID = @id AND EmployeeID = @empId');
            if (!owns.recordset[0]) return res.status(404).json({ error: 'Log not found' });

            if (status === 'Completed' && (!startTime || !endTime)) {
                return res.status(400).json({ error: 'Completed tasks require both start and end times' });
            }

            const startDateStr = logDate || (owns.recordset[0].LogDate || '').toString().split('T')[0];
            const endDateStr   = endDate  || startDateStr;
            const start = toTimeOrNull(startTime);
            const end   = toTimeOrNull(endTime);

            if (start && end) {
                if (endDateStr < startDateStr) {
                    return res.status(400).json({ error: 'End date cannot be before start date' });
                }
                const startDT = toDateTime(startDateStr, start);
                const endDT   = toDateTime(endDateStr,   end);
                if (startDT && endDT && endDT <= startDT) {
                    return res.status(400).json({ error: 'End date/time must be after start date/time' });
                }
            }

            const storedEndDate = endDateStr !== startDateStr ? endDateStr : null;
            const update = await ctx.pool.request()
                .input('id',      sql.Int,              logId)
                .input('date',    sql.Date,              logDate ? new Date(logDate) : null)
                .input('endDate', sql.NVarChar(10),      storedEndDate)
                .input('client',  sql.NVarChar(30),      client  ?? null)
                .input('project', sql.NVarChar(50),      project ?? null)
                .input('act',     sql.NVarChar(500),     activity)
                .input('start',   sql.NVarChar(10),      start)
                .input('end',     sql.NVarChar(10),      end)
                .input('status',  sql.NVarChar(50),      status)
                .input('notes',   sql.NVarChar(sql.MAX), notes ?? null)
                .query(`
                    UPDATE DailyTaskLogs SET
                        LogDate   = ISNULL(@date, LogDate),
                        EndDate   = TRY_CAST(@endDate AS DATE),
                        Client    = @client,
                        Project   = @project,
                        Activity  = @act,
                        StartTime = TRY_CAST(@start AS TIME),
                        EndTime   = TRY_CAST(@end   AS TIME),
                        Status    = @status,
                        Notes     = @notes,
                        UpdatedAt = GETDATE()
                    OUTPUT INSERTED.*
                    WHERE LogID = @id
                `);
            res.json({ success: true, log: mapLog(update.recordset[0]) });
        } catch (e) {
            console.error('Update task log:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    /* ── DELETE /api/task-logs/:id ──────────────────────────────── */
    app.delete('/api/task-logs/:id', authMiddleware, requireDb, async (req, res) => {
        try {
            const logId = parseInt(req.params.id, 10);
            if (isNaN(logId)) return res.status(400).json({ error: 'Invalid log id' });

            const del = await ctx.pool.request()
                .input('id',    sql.Int, logId)
                .input('empId', sql.Int, req.user.employeeId)
                .query(`
                    DELETE FROM DailyTaskLogs
                    OUTPUT DELETED.LogID
                    WHERE LogID = @id AND EmployeeID = @empId
                `);
            if (!del.recordset[0]) return res.status(404).json({ error: 'Log not found' });
            res.json({ success: true });
        } catch (e) {
            console.error('Delete task log:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    /* ── POST /api/task-logs/:id/unassign ──────────────────────────
       Resets an active/paused/postponed activity back to Pending.
       Clears StartTime so the employee can restart fresh. */
    app.post('/api/task-logs/:id/unassign', authMiddleware, requireDb, async (req, res) => {
        try {
            const logId = parseInt(req.params.id, 10);
            if (isNaN(logId)) return res.status(400).json({ error: 'Invalid log id' });

            const update = await ctx.pool.request()
                .input('id',    sql.Int, logId)
                .input('empId', sql.Int, req.user.employeeId)
                .query(`
                    UPDATE DailyTaskLogs SET
                        StartTime = NULL,
                        Status    = 'To Be Started',
                        UpdatedAt = GETDATE()
                    OUTPUT INSERTED.*
                    WHERE LogID = @id AND EmployeeID = @empId
                      AND Status IN ('In Progress', 'Paused', 'Postponed')
                `);
            if (!update.recordset[0])
                return res.status(400).json({ error: 'Only active, paused, or postponed activities can be unassigned' });
            res.json({ success: true, log: mapLog(update.recordset[0]) });
        } catch (e) {
            console.error('Unassign activity:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    /* ── POST /api/task-logs/:id/description ───────────────────────
       Inline-save description. Optionally links a TaskID if provided. */
    app.post('/api/task-logs/:id/description', authMiddleware, requireDb, async (req, res) => {
        try {
            const logId   = parseInt(req.params.id, 10);
            if (isNaN(logId)) return res.status(400).json({ error: 'Invalid log id' });

            const activity = (req.body.activity || '').trim() || 'PERSONAL WORK';
            const taskId   = req.body.taskId ? parseInt(req.body.taskId, 10) : null;

            let update;
            if (taskId && !isNaN(taskId)) {
                update = await ctx.pool.request()
                    .input('id',     sql.Int,           logId)
                    .input('empId',  sql.Int,           req.user.employeeId)
                    .input('act',    sql.NVarChar(500),  activity)
                    .input('taskId', sql.Int,            taskId)
                    .query(`
                        UPDATE DailyTaskLogs SET Activity = @act, TaskID = @taskId, UpdatedAt = GETDATE()
                        OUTPUT INSERTED.*
                        WHERE LogID = @id AND EmployeeID = @empId
                    `);
            } else {
                update = await ctx.pool.request()
                    .input('id',    sql.Int,           logId)
                    .input('empId', sql.Int,           req.user.employeeId)
                    .input('act',   sql.NVarChar(500),  activity)
                    .query(`
                        UPDATE DailyTaskLogs SET Activity = @act, UpdatedAt = GETDATE()
                        OUTPUT INSERTED.*
                        WHERE LogID = @id AND EmployeeID = @empId
                    `);
            }
            if (!update.recordset[0]) return res.status(404).json({ error: 'Log not found' });
            res.json({ success: true, log: mapLog(update.recordset[0]) });
        } catch (e) {
            console.error('Save description:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    /* ── POST /api/task-logs/:id/start ─────────────────────────────
       Records StartTime = now, sets Status = 'In Progress'.
       Allowed from: Pending. */
    app.post('/api/task-logs/:id/start', authMiddleware, requireDb, async (req, res) => {
        try {
            const logId = parseInt(req.params.id, 10);
            if (isNaN(logId)) return res.status(400).json({ error: 'Invalid log id' });

            const update = await ctx.pool.request()
                .input('id',    sql.Int, logId)
                .input('empId', sql.Int, req.user.employeeId)
                .query(`
                    UPDATE DailyTaskLogs SET
                        StartTime = CAST(GETDATE() AS TIME),
                        Status    = 'In Progress',
                        UpdatedAt = GETDATE()
                    OUTPUT INSERTED.*
                    WHERE LogID = @id AND EmployeeID = @empId
                      AND Status IN ('To Be Started', 'Pending')
                `);
            if (!update.recordset[0])
                return res.status(400).json({ error: 'Activity must be in "To Be Started" status to start' });
            await syncToTask(update.recordset[0].TaskID, 'In Progress');
            res.json({ success: true, log: mapLog(update.recordset[0]) });
        } catch (e) {
            console.error('Start activity:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    /* ── POST /api/task-logs/:id/pause ─────────────────────────────
       Freezes the activity. Allowed from: In Progress. */
    app.post('/api/task-logs/:id/pause', authMiddleware, requireDb, async (req, res) => {
        try {
            const logId = parseInt(req.params.id, 10);
            if (isNaN(logId)) return res.status(400).json({ error: 'Invalid log id' });

            const update = await ctx.pool.request()
                .input('id',    sql.Int, logId)
                .input('empId', sql.Int, req.user.employeeId)
                .query(`
                    UPDATE DailyTaskLogs SET Status = 'Paused', UpdatedAt = GETDATE()
                    OUTPUT INSERTED.*
                    WHERE LogID = @id AND EmployeeID = @empId AND Status = 'In Progress'
                `);
            if (!update.recordset[0])
                return res.status(400).json({ error: 'Activity must be In Progress to pause' });
            await syncToTask(update.recordset[0].TaskID, 'Paused');
            res.json({ success: true, log: mapLog(update.recordset[0]) });
        } catch (e) {
            console.error('Pause activity:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    /* ── POST /api/task-logs/:id/resume ────────────────────────────
       Resumes from Paused or Postponed → In Progress. */
    app.post('/api/task-logs/:id/resume', authMiddleware, requireDb, async (req, res) => {
        try {
            const logId = parseInt(req.params.id, 10);
            if (isNaN(logId)) return res.status(400).json({ error: 'Invalid log id' });

            const update = await ctx.pool.request()
                .input('id',    sql.Int, logId)
                .input('empId', sql.Int, req.user.employeeId)
                .query(`
                    UPDATE DailyTaskLogs SET Status = 'In Progress', UpdatedAt = GETDATE()
                    OUTPUT INSERTED.*
                    WHERE LogID = @id AND EmployeeID = @empId
                      AND Status IN ('Paused', 'Postponed')
                `);
            if (!update.recordset[0])
                return res.status(400).json({ error: 'Activity must be Paused or Postponed to resume' });
            await syncToTask(update.recordset[0].TaskID, 'In Progress');
            res.json({ success: true, log: mapLog(update.recordset[0]) });
        } catch (e) {
            console.error('Resume activity:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    /* ── POST /api/task-logs/:id/postpone ──────────────────────────
       Marks as postponed. Allowed from: In Progress.
       Completed stays disabled until resumed. */
    app.post('/api/task-logs/:id/postpone', authMiddleware, requireDb, async (req, res) => {
        try {
            const logId = parseInt(req.params.id, 10);
            if (isNaN(logId)) return res.status(400).json({ error: 'Invalid log id' });

            const update = await ctx.pool.request()
                .input('id',    sql.Int, logId)
                .input('empId', sql.Int, req.user.employeeId)
                .query(`
                    UPDATE DailyTaskLogs SET Status = 'Postponed', UpdatedAt = GETDATE()
                    OUTPUT INSERTED.*
                    WHERE LogID = @id AND EmployeeID = @empId AND Status = 'In Progress'
                `);
            if (!update.recordset[0])
                return res.status(400).json({ error: 'Activity must be In Progress to postpone' });
            await syncToTask(update.recordset[0].TaskID, 'Postponed');
            res.json({ success: true, log: mapLog(update.recordset[0]) });
        } catch (e) {
            console.error('Postpone activity:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    /* ── POST /api/task-logs/:id/complete ──────────────────────────
       Records EndTime = now, sets Status = 'Completed'.
       Allowed from: In Progress only.
       Frontend then opens Daily Log form for Client/Project/Notes. */
    app.post('/api/task-logs/:id/complete', authMiddleware, requireDb, async (req, res) => {
        try {
            const logId = parseInt(req.params.id, 10);
            if (isNaN(logId)) return res.status(400).json({ error: 'Invalid log id' });

            const update = await ctx.pool.request()
                .input('id',    sql.Int, logId)
                .input('empId', sql.Int, req.user.employeeId)
                .query(`
                    UPDATE DailyTaskLogs SET
                        EndTime   = CAST(GETDATE() AS TIME),
                        Status    = 'Completed',
                        UpdatedAt = GETDATE()
                    OUTPUT INSERTED.*
                    WHERE LogID = @id AND EmployeeID = @empId AND Status = 'In Progress'
                `);
            if (!update.recordset[0])
                return res.status(400).json({ error: 'Activity must be In Progress to complete' });
            await syncToTask(update.recordset[0].TaskID, 'Completed');
            res.json({ success: true, log: mapLog(update.recordset[0]) });
        } catch (e) {
            console.error('Complete activity:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });
}

module.exports = { registerTaskLogRoutes };
