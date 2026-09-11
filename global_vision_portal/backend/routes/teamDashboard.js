const { sql } = require('../config/database');
const { authMiddleware, requireAdmin, requireTeamAccess, isAdminRole } = require('../middleware/auth');

function registerTeamDashboardRoutes(app, deps) {
    function requireDb(req, res, next) {
        if (!deps.dbConnected || !deps.pool) return res.status(503).json({ error: 'Database unavailable' });
        next();
    }

    // Resolve which TeamIDs this user is allowed to see:
    // - Admin → all teams (returns null = no restriction)
    // - Manager → rows from ManagerTeams
    // - TeamLead → their own Employees.TeamID
    async function resolveAllowedTeamIds(pool, user) {
        const role = (user.role || '').trim().toLowerCase();
        if (isAdminRole(role)) return null; // unrestricted

        if (role === 'manager') {
            const r = await pool.request()
                .input('mid', sql.Int, user.employeeId)
                .query('SELECT TeamID FROM ManagerTeams WHERE ManagerID = @mid');
            return r.recordset.map(row => row.TeamID);
        }

        // TeamLead: use their own employee record's TeamID
        const r = await pool.request()
            .input('eid', sql.Int, user.employeeId)
            .query('SELECT TeamID FROM Employees WHERE EmployeeID = @eid');
        const tid = r.recordset[0]?.TeamID;
        return tid ? [tid] : [];
    }

    // ===== GET /api/team/my-teams — teams this user can see =====
    app.get('/api/team/my-teams', authMiddleware, requireTeamAccess, requireDb, async (req, res) => {
        try {
            const allowed = await resolveAllowedTeamIds(deps.pool, req.user);

            let result;
            if (allowed === null) {
                // Admin: all teams
                result = await deps.pool.request()
                    .query('SELECT TeamID, TeamName FROM Teams ORDER BY TeamName');
            } else if (!allowed.length) {
                return res.json({ success: true, teams: [] });
            } else {
                const ids = allowed.join(',');
                result = await deps.pool.request()
                    .query(`SELECT TeamID, TeamName FROM Teams WHERE TeamID IN (${ids}) ORDER BY TeamName`);
            }

            res.json({ success: true, teams: result.recordset });
        } catch (e) {
            console.error('my-teams:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ===== GET /api/team/dashboard?date=YYYY-MM-DD&teamId=N =====
    app.get('/api/team/dashboard', authMiddleware, requireTeamAccess, requireDb, async (req, res) => {
        try {
            const dateParam = (req.query.date || '').trim();
            const teamIdParam = parseInt(req.query.teamId, 10) || null;

            const allowed = await resolveAllowedTeamIds(deps.pool, req.user);

            // Enforce team restriction
            let teamFilter;
            if (allowed === null) {
                // Admin: use teamId param if given, else all
                teamFilter = teamIdParam ? [teamIdParam] : null;
            } else {
                if (!allowed.length) return res.json({ success: true, date: dateParam || null, employees: [] });
                // Non-admin: only their allowed teams; honour teamId param only if it's in their list
                teamFilter = (teamIdParam && allowed.includes(teamIdParam)) ? [teamIdParam] : allowed;
            }

            const req2 = deps.pool.request();
            let dateExpr;
            if (dateParam) {
                req2.input('clientDate', sql.Date, new Date(dateParam));
                dateExpr = 'CAST(@clientDate AS DATE)';
            } else {
                dateExpr = 'CAST(GETDATE() AS DATE)';
            }

            const teamCondition = teamFilter
                ? `AND e.TeamID IN (${teamFilter.join(',')})`
                : '';

            const result = await req2.query(`
                SELECT
                    e.EmployeeID, e.Name, e.Role, e.Designation, e.ProfileImageUrl,
                    e.ShiftStart, e.ShiftEnd,
                    t.TeamID, t.TeamName,
                    c.cliClientName AS ClientName,
                    a.LoginTime, a.LogoutTime,
                    lr.RemarkID,
                    lr.TeamID    AS RemarkTeamID,
                    lr.ClientID  AS RemarkClientID,
                    lr.Reason,
                    rec.Name     AS RecordedByName,
                    rt.TeamName  AS RemarkTeamName,
                    rc.cliClientName AS RemarkClientName
                FROM Employees e
                LEFT JOIN Teams   t  ON t.TeamID      = e.TeamID
                LEFT JOIN Clients c  ON c.cliClientID = e.ClientID
                LEFT JOIN (
                    SELECT EmployeeID,
                           MIN(LoginTime)   AS LoginTime,
                           MAX(LogoutTime)  AS LogoutTime
                    FROM Attendance
                    WHERE Date = ${dateExpr}
                    GROUP BY EmployeeID
                ) a ON a.EmployeeID = e.EmployeeID
                LEFT JOIN LateRemarks lr
                    ON lr.EmployeeID = e.EmployeeID AND lr.Date = ${dateExpr}
                LEFT JOIN Employees rec ON rec.EmployeeID = lr.RecordedBy
                LEFT JOIN Teams   rt ON rt.TeamID      = lr.TeamID
                LEFT JOIN Clients rc ON rc.cliClientID = lr.ClientID
                WHERE ISNULL(e.IsActive, 1) = 1
                  AND e.TeamID IS NOT NULL
                  ${teamCondition}
                ORDER BY
                    CASE WHEN a.LoginTime IS NULL THEN 2
                         WHEN CAST(a.LoginTime AS TIME) > CAST(ISNULL(e.ShiftStart,'09:00') AS TIME) THEN 1
                         ELSE 0 END,
                    e.Name
            `);

            res.json({ success: true, date: dateParam || null, employees: result.recordset });
        } catch (e) {
            console.error('team/dashboard:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ===== Admin: get teams assigned to a manager =====
    app.get('/api/admin/manager-teams/:managerId(\\d+)', authMiddleware, requireAdmin, requireDb, async (req, res) => {
        try {
            const mId = parseInt(req.params.managerId, 10);
            const result = await deps.pool.request()
                .input('mid', sql.Int, mId)
                .query(`
                    SELECT t.TeamID, t.TeamName
                    FROM ManagerTeams mt
                    INNER JOIN Teams t ON t.TeamID = mt.TeamID
                    WHERE mt.ManagerID = @mid
                    ORDER BY t.TeamName
                `);
            res.json({ success: true, teams: result.recordset });
        } catch (e) {
            console.error('manager-teams GET:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ===== Admin: set teams for a manager (replaces existing) =====
    app.put('/api/admin/manager-teams/:managerId(\\d+)', authMiddleware, requireAdmin, requireDb, async (req, res) => {
        try {
            const mId    = parseInt(req.params.managerId, 10);
            const teamIds = (req.body.teamIds || []).map(id => parseInt(id, 10)).filter(Boolean);

            // Verify employee exists and is Manager/TeamLead role
            const empCheck = await deps.pool.request()
                .input('id', sql.Int, mId)
                .query(`SELECT Role FROM Employees WHERE EmployeeID = @id`);
            if (!empCheck.recordset.length) return res.status(404).json({ error: 'Employee not found' });

            const role = (empCheck.recordset[0].Role || '').toLowerCase();
            if (role !== 'manager' && role !== 'teamlead') {
                return res.status(400).json({ error: 'Employee must have Manager or TeamLead role' });
            }

            // Replace all entries
            await deps.pool.request()
                .input('mid', sql.Int, mId)
                .query('DELETE FROM ManagerTeams WHERE ManagerID = @mid');

            for (const tid of teamIds) {
                await deps.pool.request()
                    .input('mid', sql.Int, mId)
                    .input('tid', sql.Int, tid)
                    .query(`
                        IF NOT EXISTS (SELECT 1 FROM ManagerTeams WHERE ManagerID = @mid AND TeamID = @tid)
                            INSERT INTO ManagerTeams (ManagerID, TeamID) VALUES (@mid, @tid)
                    `);
            }

            res.json({ success: true, assigned: teamIds.length });
        } catch (e) {
            console.error('manager-teams PUT:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });
}

module.exports = { registerTeamDashboardRoutes };
