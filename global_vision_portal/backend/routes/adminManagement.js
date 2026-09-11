const bcrypt = require('bcryptjs');
const multer = require('multer');
const XLSX   = require('xlsx');
const { sql } = require('../config/database');
const { authMiddleware, requireAdmin, requireTeamAccess, isSuperAdminEmail, SUPER_ADMIN_EMAIL } = require('../middleware/auth');
const { getScreensForRoleName, setRoleScreens } = require('../services/rbac');
const {
    normalizeTargetType,
    parseExpiresAt,
    mapAnnouncementList,
    setAnnouncementRecipients,
    setAnnouncementRoles,
    clearAnnouncementTargeting,
} = require('../services/announcements');

const bulkUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function registerAdminManagementRoutes(app, deps) {
    const { mapEmployee, EMPLOYEE_SELECT, EMPLOYEE_FROM } = deps;

    function requireDb(req, res, next) {
        if (!deps.dbConnected || !deps.pool) {
            return res.status(503).json({ error: 'Database unavailable' });
        }
        next();
    }

    // ===== Screen access (current user) =====
    app.get('/api/me/screens', authMiddleware, requireDb, async (req, res) => {
        try {
            const screens = await getScreensForRoleName(deps.pool, req.user.role);
            // Super Admin gets admin-medical even though regular Admin role does not
            if (isSuperAdminEmail(req.user.email)) {
                const already = screens.some(s => (s.ScreenKey || s.screenKey) === 'admin-medical');
                if (!already) {
                    const r = await deps.pool.request()
                        .query(`SELECT ScreenKey, ScreenName, Path, SortOrder FROM Screens WHERE ScreenKey = 'admin-medical'`);
                    if (r.recordset[0]) screens.push(r.recordset[0]);
                }
            }
            res.json({ success: true, screens });
        } catch (error) {
            console.error('Me screens:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ===== Announcements (all authenticated users) =====
    app.get('/api/announcements', authMiddleware, requireDb, async (req, res) => {
        try {
            const employeeId = parseInt(req.user.employeeId, 10);
            const userRole = (req.user.role || '').trim();
            if (!employeeId || isNaN(employeeId)) {
                return res.status(401).json({
                    error: 'Your session is missing employee info. Log out and log in again.',
                });
            }
            const result = await deps.pool.request()
                .input('employeeId', sql.Int, employeeId)
                .input('userRole', sql.NVarChar, userRole)
                .query(`
                    SELECT a.*, e.Name AS CreatedByName
                    FROM Announcements a
                    LEFT JOIN Employees e ON e.EmployeeID = a.CreatedBy
                    WHERE a.IsActive <> 0
                      AND (a.ExpiresAt IS NULL OR a.ExpiresAt > GETDATE())
                      AND (
                          LOWER(LTRIM(RTRIM(ISNULL(a.TargetType, 'all')))) = 'all'
                          OR (
                              LOWER(LTRIM(RTRIM(ISNULL(a.TargetType, '')))) = 'selected'
                              AND EXISTS (
                                  SELECT 1 FROM AnnouncementRecipients r
                                  WHERE r.AnnouncementID = a.AnnouncementID
                                    AND r.EmployeeID = @employeeId
                              )
                          )
                          OR (
                              LOWER(LTRIM(RTRIM(ISNULL(a.TargetType, '')))) = 'roles'
                              AND EXISTS (
                                  SELECT 1 FROM AnnouncementRoles ar
                                  WHERE ar.AnnouncementID = a.AnnouncementID
                                    AND ar.RoleName = @userRole
                              )
                          )
                      )
                    ORDER BY a.Priority DESC, a.CreatedAt DESC
                `);
            const announcements = await mapAnnouncementList(deps.pool, result.recordset);
            res.json({ success: true, announcements });
        } catch (error) {
            console.error('Announcements:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ===== Admin: Users =====
    app.get('/api/admin/users', authMiddleware, requireAdmin, requireDb, async (req, res) => {
        try {
            const result = await deps.pool.request().query(`
                SELECT ${EMPLOYEE_SELECT}, e.IsActive
                ${EMPLOYEE_FROM}
                ORDER BY e.Name
            `);
            res.json({ success: true, users: result.recordset.map(mapEmployee) });
        } catch (error) {
            console.error('Admin users list:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.post('/api/admin/users', authMiddleware, requireAdmin, requireDb, async (req, res) => {
        try {
            const {
                name, email, contact, password, role, username,
                designation, teamId, clientId, isActive,
            } = req.body;

            const fullName = (name || '').trim();
            const empMail = (email || '').trim().toLowerCase();
            const empRole = (role || 'Employee').trim();

            if (!fullName || !empMail || !password) {
                return res.status(400).json({ error: 'Name, email, and password are required' });
            }

            if (empRole.toLowerCase() === 'financemanager' &&
                (req.user.email || '').toLowerCase() !== SUPER_ADMIN_EMAIL.toLowerCase()) {
                return res.status(403).json({ error: 'Only the Super Admin can assign the Finance Manager role' });
            }

            const roleCheck = await deps.pool.request()
                .input('roleName', sql.NVarChar, empRole)
                .query('SELECT RoleID FROM Roles WHERE RoleName = @roleName');
            if (!roleCheck.recordset.length) {
                return res.status(400).json({ error: 'Invalid role. Create the role first or pick an existing one.' });
            }

            const existing = await deps.pool.request()
                .input('email', sql.NVarChar, empMail)
                .query('SELECT EmployeeID FROM Employees WHERE Email = @email');
            if (existing.recordset.length) {
                return res.status(400).json({ error: 'Email already in use' });
            }

            const hash = await bcrypt.hash(password, 10);
            const team = teamId ? parseInt(teamId, 10) : null;
            const client = clientId ? parseInt(clientId, 10) : null;
            const active = isActive === false || isActive === 0 ? 0 : 1;

            const insert = await deps.pool.request()
                .input('name', sql.NVarChar, fullName)
                .input('email', sql.NVarChar, empMail)
                .input('contact', sql.NVarChar, contact || '')
                .input('role', sql.NVarChar, empRole)
                .input('hash', sql.NVarChar, hash)
                .input('designation', sql.NVarChar, (designation || empRole).trim())
                .input('teamId', sql.Int, team)
                .input('clientId', sql.Int, client)
                .input('isActive', sql.Bit, active)
                .query(`
                    INSERT INTO Employees (Name, Email, Role, Contact, PasswordHash, Designation, TeamID, ClientID, IsActive)
                    OUTPUT INSERTED.EmployeeID
                    VALUES (@name, @email, @role, @contact, @hash, @designation, @teamId, @clientId, @isActive)
                `);

            const employeeId = insert.recordset[0].EmployeeID;
            const uname = (username || empMail.split('@')[0]).trim().toLowerCase();

            const unameCheck = await deps.pool.request()
                .input('username', sql.NVarChar, uname)
                .query('SELECT 1 FROM Usernames WHERE Username = @username');
            if (unameCheck.recordset.length) {
                return res.status(400).json({ error: 'Username already taken' });
            }

            await deps.pool.request()
                .input('employeeId', sql.Int, employeeId)
                .input('username', sql.NVarChar, uname)
                .query('INSERT INTO Usernames (EmployeeID, Username) VALUES (@employeeId, @username)');

            const detail = await deps.pool.request()
                .input('id', sql.Int, employeeId)
                .query(`SELECT ${EMPLOYEE_SELECT} ${EMPLOYEE_FROM} WHERE e.EmployeeID = @id`);

            res.status(201).json({ success: true, user: mapEmployee(detail.recordset[0]) });
        } catch (error) {
            console.error('Admin create user:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ===== Bulk upload: sample XLSX =====
    app.get('/api/admin/users/sample', authMiddleware, requireAdmin, requireDb, async (req, res) => {
        try {
            // Fetch real roles, teams, and clients from the DB
            const [rolesRes, teamsRes, clientsRes] = await Promise.all([
                deps.pool.request().query(`SELECT RoleName FROM Roles ORDER BY RoleName`),
                deps.pool.request().query(`SELECT TeamName FROM Teams ORDER BY TeamName`),
                deps.pool.request().query(`SELECT cliClientName FROM Clients ORDER BY cliClientName`),
            ]);

            const roleNames   = rolesRes.recordset.map(r => r.RoleName).filter(r => r !== 'Admin');
            const teamNames   = teamsRes.recordset.map(t => t.TeamName);
            const clientNames = clientsRes.recordset.map(c => c.cliClientName);

            const firstRole   = roleNames[0]   || 'Employee';
            const secondRole  = roleNames[1]   || roleNames[0] || 'Employee';
            const firstTeam   = teamNames[0]   || '';
            const firstClient = clientNames[0] || '';

            // Sheet 1: Data template with 2 example rows
            const headers = ['Name','Email','Password','Role','Username','Contact','Designation','TeamName','ClientName'];
            const dataRows = [
                headers,
                ['Ahmad Ali',   'ahmad@yourcompany.com',  'Pass1234!', firstRole,  'ahmadali',   '03001234567', 'Developer',       firstTeam,   firstClient],
                ['Sara Khan',   'sara@yourcompany.com',   'Pass5678!', secondRole, 'sarakhan',   '03009876543', 'Project Manager', firstTeam,   ''],
            ];
            const ws = XLSX.utils.aoa_to_sheet(dataRows);
            ws['!cols'] = [{wch:20},{wch:30},{wch:14},{wch:16},{wch:16},{wch:16},{wch:20},{wch:18},{wch:18}];

            // Sheet 2: Reference — valid values for Role, TeamName, ClientName
            const maxRows = Math.max(roleNames.length, teamNames.length, clientNames.length, 1);
            const refHeader = ['Valid Roles (exact)','Valid Team Names (exact)','Valid Client Names (exact)'];
            const refRows = [refHeader];
            for (let i = 0; i < maxRows; i++) {
                refRows.push([roleNames[i] || '', teamNames[i] || '', clientNames[i] || '']);
            }
            refRows.push([]);
            refRows.push(['NOTES:','','']);
            refRows.push(['Name, Email, Password, Role are required.','','']);
            refRows.push(['Username defaults to email prefix if blank.','','']);
            refRows.push(['Designation defaults to Role if blank.','','']);
            refRows.push(['TeamName & ClientName must match exactly (case-sensitive).','','']);
            refRows.push(['Password must be at least 8 characters.','','']);

            const wsRef = XLSX.utils.aoa_to_sheet(refRows);
            wsRef['!cols'] = [{wch:36},{wch:30},{wch:30}];

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Users Template');
            XLSX.utils.book_append_sheet(wb, wsRef, 'Reference');

            const buf = XLSX.write(wb, { type:'buffer', bookType:'xlsx' });
            res.setHeader('Content-Disposition', 'attachment; filename="bulk_users_sample.xlsx"');
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
            res.send(buf);
        } catch (e) {
            console.error('Sample XLSX:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ===== Bulk upload: create users from XLSX =====
    app.post('/api/admin/users/bulk', authMiddleware, requireAdmin, requireDb, bulkUpload.single('file'), async (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
            const wb   = XLSX.read(req.file.buffer, { type:'buffer' });
            const ws   = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

            if (!rows.length) return res.status(400).json({ error: 'File is empty or has no data rows' });

            const results = [];
            for (const row of rows) {
                const name  = String(row['Name'] || '').trim();
                const email = String(row['Email'] || '').trim().toLowerCase();
                const pass  = String(row['Password'] || '').trim();
                const role  = String(row['Role'] || 'Employee').trim();

                if (!name || !email || !pass) {
                    results.push({ name: name || email || '?', status: 'skipped', message: 'Name, Email, and Password are required' });
                    continue;
                }

                try {
                    const roleCheck = await deps.pool.request()
                        .input('roleName', sql.NVarChar, role)
                        .query('SELECT RoleID FROM Roles WHERE RoleName = @roleName');
                    if (!roleCheck.recordset.length) {
                        results.push({ name, status: 'error', message: `Role "${role}" not found` });
                        continue;
                    }

                    const existing = await deps.pool.request()
                        .input('email', sql.NVarChar, email)
                        .query('SELECT EmployeeID FROM Employees WHERE Email = @email');
                    if (existing.recordset.length) {
                        results.push({ name, status: 'skipped', message: 'Email already in use' });
                        continue;
                    }

                    const hash       = await bcrypt.hash(pass, 10);
                    const uname      = String(row['Username'] || email.split('@')[0]).trim().toLowerCase();
                    const contact    = String(row['Contact'] || '').trim();
                    const desig      = String(row['Designation'] || role).trim();
                    const teamName   = String(row['TeamName'] || '').trim();
                    const clientName = String(row['ClientName'] || '').trim();

                    let teamId = null, clientId = null;
                    if (teamName) {
                        const tr = await deps.pool.request().input('n', sql.NVarChar, teamName).query('SELECT TeamID FROM Teams WHERE TeamName = @n');
                        if (tr.recordset[0]) teamId = tr.recordset[0].TeamID;
                    }
                    if (clientName) {
                        const cr = await deps.pool.request().input('n', sql.NVarChar, clientName).query('SELECT cliClientID FROM Clients WHERE cliClientName = @n');
                        if (cr.recordset[0]) clientId = cr.recordset[0].cliClientID;
                    }

                    const ins = await deps.pool.request()
                        .input('name',    sql.NVarChar, name)
                        .input('email',   sql.NVarChar, email)
                        .input('role',    sql.NVarChar, role)
                        .input('contact', sql.NVarChar, contact)
                        .input('hash',    sql.NVarChar, hash)
                        .input('desig',   sql.NVarChar, desig)
                        .input('teamId',  sql.Int, teamId)
                        .input('clientId',sql.Int, clientId)
                        .query(`INSERT INTO Employees (Name,Email,Role,Contact,PasswordHash,Designation,TeamID,ClientID,IsActive)
                                OUTPUT INSERTED.EmployeeID VALUES (@name,@email,@role,@contact,@hash,@desig,@teamId,@clientId,1)`);

                    const empId = ins.recordset[0].EmployeeID;

                    const unameCheck = await deps.pool.request()
                        .input('username', sql.NVarChar, uname)
                        .query('SELECT 1 FROM Usernames WHERE Username = @username');
                    const finalUname = unameCheck.recordset.length ? `${uname}_${empId}` : uname;
                    await deps.pool.request()
                        .input('empId',    sql.Int, empId)
                        .input('username', sql.NVarChar, finalUname)
                        .query('INSERT INTO Usernames (EmployeeID, Username) VALUES (@empId, @username)');

                    results.push({ name, status: 'created', message: `ID ${empId}` });
                } catch (rowErr) {
                    results.push({ name, status: 'error', message: rowErr.message });
                }
            }

            const created = results.filter(r => r.status === 'created').length;
            res.json({ success: true, created, total: rows.length, results });
        } catch (e) {
            console.error('Bulk upload users:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.put('/api/admin/users/:id', authMiddleware, requireAdmin, requireDb, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            const {
                name, email, contact, password, role, username,
                designation, teamId, clientId, isActive, profileImageUrl,
            } = req.body;

            const current = await deps.pool.request()
                .input('id', sql.Int, id)
                .query('SELECT EmployeeID, Role, Email, Name, Contact, Designation, TeamID, ClientID FROM Employees WHERE EmployeeID = @id');
            if (!current.recordset.length) {
                return res.status(404).json({ error: 'User not found' });
            }

            const row = current.recordset[0];
            if (row.Role === 'Admin' && req.user.employeeId === id && role && role !== 'Admin') {
                return res.status(400).json({ error: 'You cannot remove your own Admin role' });
            }

            if (role && role.toLowerCase() === 'financemanager' &&
                (req.user.email || '').toLowerCase() !== SUPER_ADMIN_EMAIL.toLowerCase()) {
                return res.status(403).json({ error: 'Only the Super Admin can assign the Finance Manager role' });
            }

            if (role) {
                const roleCheck = await deps.pool.request()
                    .input('roleName', sql.NVarChar, role)
                    .query('SELECT RoleID FROM Roles WHERE RoleName = @roleName');
                if (!roleCheck.recordset.length) {
                    return res.status(400).json({ error: 'Invalid role' });
                }
            }

            const empMail = email ? email.trim().toLowerCase() : row.Email;
            if (email) {
                const dup = await deps.pool.request()
                    .input('email', sql.NVarChar, empMail)
                    .input('id', sql.Int, id)
                    .query('SELECT 1 FROM Employees WHERE Email = @email AND EmployeeID <> @id');
                if (dup.recordset.length) {
                    return res.status(400).json({ error: 'Email already in use' });
                }
            }

            let hashClause = '';
            let imageClause = '';
            const request = deps.pool.request()
                .input('id', sql.Int, id)
                .input('name', sql.NVarChar, name || row.Name)
                .input('email', sql.NVarChar, empMail)
                .input('contact', sql.NVarChar, contact || '')
                .input('role', sql.NVarChar, role || row.Role)
                .input('designation', sql.NVarChar, designation || role || row.Role)
                .input('teamId', sql.Int, teamId ? parseInt(teamId, 10) : null)
                .input('clientId', sql.Int, clientId ? parseInt(clientId, 10) : null)
                .input('isActive', sql.Bit, isActive === false || isActive === 0 ? 0 : 1);

            if (password) {
                const hash = await bcrypt.hash(password, 10);
                request.input('hash', sql.NVarChar, hash);
                hashClause = ', PasswordHash = @hash';
            }

            if ('profileImageUrl' in req.body) {
                request.input('profileImageUrl', sql.NVarChar, profileImageUrl || null);
                imageClause = ', ProfileImageUrl = @profileImageUrl';
            }

            await request.query(`
                UPDATE Employees SET
                    Name = @name, Email = @email,
                    Contact = @contact, Role = @role, Designation = @designation,
                    TeamID = @teamId, ClientID = @clientId, IsActive = @isActive, UpdatedAt = GETDATE()
                    ${hashClause}${imageClause}
                WHERE EmployeeID = @id
            `);

            if (username) {
                const uname = username.trim().toLowerCase();
                const unameCheck = await deps.pool.request()
                    .input('username', sql.NVarChar, uname)
                    .input('id', sql.Int, id)
                    .query('SELECT 1 FROM Usernames WHERE Username = @username AND EmployeeID <> @id');
                if (unameCheck.recordset.length) {
                    return res.status(400).json({ error: 'Username already taken' });
                }
                await deps.pool.request()
                    .input('id', sql.Int, id)
                    .input('username', sql.NVarChar, uname)
                    .query(`
                        IF EXISTS (SELECT 1 FROM Usernames WHERE EmployeeID = @id)
                            UPDATE Usernames SET Username = @username WHERE EmployeeID = @id
                        ELSE
                            INSERT INTO Usernames (EmployeeID, Username) VALUES (@id, @username)
                    `);
            }

            const detail = await deps.pool.request()
                .input('id', sql.Int, id)
                .query(`SELECT ${EMPLOYEE_SELECT} ${EMPLOYEE_FROM} WHERE e.EmployeeID = @id`);

            res.json({ success: true, user: mapEmployee(detail.recordset[0]) });
        } catch (error) {
            console.error('Admin update user:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.delete('/api/admin/users/:id', authMiddleware, requireAdmin, requireDb, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            if (id === req.user.employeeId) {
                return res.status(400).json({ error: 'Cannot delete your own account' });
            }

            const current = await deps.pool.request()
                .input('id', sql.Int, id)
                .query('SELECT Role FROM Employees WHERE EmployeeID = @id');
            if (!current.recordset.length) {
                return res.status(404).json({ error: 'User not found' });
            }

            await deps.pool.request()
                .input('id', sql.Int, id)
                .query('UPDATE Employees SET IsActive = 0, UpdatedAt = GETDATE() WHERE EmployeeID = @id');

            res.json({ success: true, message: 'User deactivated' });
        } catch (error) {
            console.error('Admin delete user:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ===== Admin: Roles =====
    app.get('/api/admin/roles', authMiddleware, requireAdmin, requireDb, async (req, res) => {
        try {
            const roles = await deps.pool.request().query(`
                SELECT r.RoleID, r.RoleName, r.Description, r.IsSystem,
                    (SELECT COUNT(*) FROM Employees e WHERE e.Role = r.RoleName AND e.IsActive = 1) AS UserCount
                FROM Roles r
                ORDER BY r.RoleName
            `);

            const screens = await deps.pool.request().query(`
                SELECT rs.RoleID, s.ScreenKey, s.ScreenName, s.Path
                FROM RoleScreens rs
                INNER JOIN Screens s ON s.ScreenID = rs.ScreenID
            `);

            const byRole = {};
            screens.recordset.forEach((row) => {
                if (!byRole[row.RoleID]) byRole[row.RoleID] = [];
                byRole[row.RoleID].push({
                    key: row.ScreenKey,
                    name: row.ScreenName,
                    path: row.Path,
                });
            });

            res.json({
                success: true,
                roles: roles.recordset.map((r) => ({
                    id: r.RoleID,
                    name: r.RoleName,
                    description: r.Description,
                    isSystem: !!r.IsSystem,
                    userCount: r.UserCount,
                    screens: byRole[r.RoleID] || [],
                })),
            });
        } catch (error) {
            console.error('Admin roles:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.post('/api/admin/roles', authMiddleware, requireAdmin, requireDb, async (req, res) => {
        try {
            const { name, description, screenKeys } = req.body;
            const roleName = (name || '').trim();
            if (!roleName) {
                return res.status(400).json({ error: 'Role name is required' });
            }

            const insert = await deps.pool.request()
                .input('name', sql.NVarChar, roleName)
                .input('desc', sql.NVarChar, description || '')
                .query(`
                    INSERT INTO Roles (RoleName, Description, IsSystem)
                    OUTPUT INSERTED.RoleID
                    VALUES (@name, @desc, 0)
                `);

            const roleId = insert.recordset[0].RoleID;
            if (Array.isArray(screenKeys) && screenKeys.length) {
                await setRoleScreens(deps.pool, roleId, screenKeys);
            }

            res.status(201).json({ success: true, id: roleId });
        } catch (error) {
            if (error.number === 2627) {
                return res.status(400).json({ error: 'Role name already exists' });
            }
            console.error('Admin create role:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.put('/api/admin/roles/:id', authMiddleware, requireAdmin, requireDb, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            const { name, description } = req.body;

            const current = await deps.pool.request()
                .input('id', sql.Int, id)
                .query('SELECT * FROM Roles WHERE RoleID = @id');
            if (!current.recordset.length) {
                return res.status(404).json({ error: 'Role not found' });
            }

            const oldName = current.recordset[0].RoleName;
            const newName = (name || oldName).trim();

            await deps.pool.request()
                .input('id', sql.Int, id)
                .input('name', sql.NVarChar, newName)
                .input('desc', sql.NVarChar, description ?? current.recordset[0].Description)
                .query('UPDATE Roles SET RoleName = @name, Description = @desc WHERE RoleID = @id');

            if (newName !== oldName) {
                await deps.pool.request()
                    .input('oldName', sql.NVarChar, oldName)
                    .input('newName', sql.NVarChar, newName)
                    .query('UPDATE Employees SET Role = @newName WHERE Role = @oldName');
            }

            res.json({ success: true });
        } catch (error) {
            console.error('Admin update role:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.delete('/api/admin/roles/:id', authMiddleware, requireAdmin, requireDb, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            const current = await deps.pool.request()
                .input('id', sql.Int, id)
                .query('SELECT RoleName, IsSystem FROM Roles WHERE RoleID = @id');
            if (!current.recordset.length) {
                return res.status(404).json({ error: 'Role not found' });
            }
            if (current.recordset[0].IsSystem) {
                return res.status(400).json({ error: 'System roles cannot be deleted' });
            }

            const inUse = await deps.pool.request()
                .input('name', sql.NVarChar, current.recordset[0].RoleName)
                .query('SELECT COUNT(*) AS cnt FROM Employees WHERE Role = @name AND IsActive = 1');
            if (inUse.recordset[0].cnt > 0) {
                return res.status(400).json({ error: 'Role is assigned to active users' });
            }

            await deps.pool.request().input('id', sql.Int, id).query('DELETE FROM Roles WHERE RoleID = @id');
            res.json({ success: true });
        } catch (error) {
            console.error('Admin delete role:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.get('/api/admin/screens', authMiddleware, requireAdmin, requireDb, async (req, res) => {
        try {
            const result = await deps.pool.request().query(`
                SELECT ScreenID, ScreenKey, ScreenName, Path, SortOrder
                FROM Screens ORDER BY SortOrder, ScreenName
            `);
            res.json({ success: true, screens: result.recordset });
        } catch (error) {
            console.error('Admin screens:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.put('/api/admin/roles/:id/screens', authMiddleware, requireAdmin, requireDb, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            const { screenKeys } = req.body;
            if (!Array.isArray(screenKeys)) {
                return res.status(400).json({ error: 'screenKeys array required' });
            }

            const current = await deps.pool.request()
                .input('id', sql.Int, id)
                .query('SELECT RoleID FROM Roles WHERE RoleID = @id');
            if (!current.recordset.length) {
                return res.status(404).json({ error: 'Role not found' });
            }

            await setRoleScreens(deps.pool, id, screenKeys);
            res.json({ success: true });
        } catch (error) {
            console.error('Admin role screens:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ===== Admin: Announcements =====
    app.get('/api/admin/announcements', authMiddleware, requireAdmin, requireDb, async (req, res) => {
        try {
            const result = await deps.pool.request().query(`
                SELECT a.*, e.Name AS CreatedByName
                FROM Announcements a
                LEFT JOIN Employees e ON e.EmployeeID = a.CreatedBy
                ORDER BY a.CreatedAt DESC
            `);
            const announcements = await mapAnnouncementList(deps.pool, result.recordset);
            res.json({ success: true, announcements });
        } catch (error) {
            console.error('Admin announcements:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.post('/api/admin/announcements', authMiddleware, requireAdmin, requireDb, async (req, res) => {
        try {
            const { title, body, isActive, priority, expiresAt, targetType, employeeIds, roleNames, category } = req.body;
            if (!(title || '').trim() || !(body || '').trim()) {
                return res.status(400).json({ error: 'Title and body are required' });
            }

            const target = normalizeTargetType(targetType);
            const ids = Array.isArray(employeeIds)
                ? employeeIds.map((id) => parseInt(id, 10)).filter((id) => !isNaN(id) && id > 0)
                : [];
            const roles = Array.isArray(roleNames)
                ? roleNames.map((r) => String(r || '').trim()).filter(Boolean)
                : [];
            if (target === 'selected' && !ids.length) {
                return res.status(400).json({ error: 'Select at least one employee' });
            }
            if (target === 'roles' && !roles.length) {
                return res.status(400).json({ error: 'Select at least one role' });
            }

            const expiry = parseExpiresAt(expiresAt);
            if (expiry.error) {
                return res.status(400).json({ error: expiry.error });
            }

            const categoryVal = (category || '').trim() || null;
            const insert = await deps.pool.request()
                .input('title', sql.NVarChar, title.trim())
                .input('body', sql.NVarChar, body.trim())
                .input('isActive', sql.Bit, isActive === false ? 0 : 1)
                .input('priority', sql.Int, parseInt(priority, 10) || 0)
                .input('targetType', sql.NVarChar, target)
                .input('createdBy', sql.Int, req.user.employeeId)
                .input('expiresAt', sql.DateTime2, expiry.date)
                .input('category', sql.NVarChar, categoryVal)
                .query(`
                    INSERT INTO Announcements (Title, Body, IsActive, Priority, TargetType, CreatedBy, ExpiresAt, Category)
                    OUTPUT INSERTED.AnnouncementID
                    VALUES (@title, @body, @isActive, @priority, @targetType, @createdBy, @expiresAt, @category)
                `);

            const annId = insert.recordset[0].AnnouncementID;
            await clearAnnouncementTargeting(deps.pool, annId);
            if (target === 'selected') {
                const saved = await setAnnouncementRecipients(deps.pool, annId, ids);
                if (!saved) {
                    await deps.pool.request()
                        .input('id', sql.Int, annId)
                        .query('DELETE FROM Announcements WHERE AnnouncementID = @id');
                    return res.status(400).json({
                        error: 'None of the selected people exist in the database. Refresh the page and pick again.',
                    });
                }
            } else if (target === 'roles') {
                await setAnnouncementRoles(deps.pool, annId, roles);
            }

            res.status(201).json({ success: true, id: annId });
        } catch (error) {
            console.error('Admin create announcement:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.put('/api/admin/announcements/:id', authMiddleware, requireAdmin, requireDb, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            const { title, body, isActive, priority, expiresAt, targetType, employeeIds, roleNames, category } = req.body;

            const target = normalizeTargetType(targetType);
            const ids = Array.isArray(employeeIds)
                ? employeeIds.map((id) => parseInt(id, 10)).filter((id) => !isNaN(id) && id > 0)
                : [];
            const roles = Array.isArray(roleNames)
                ? roleNames.map((r) => String(r || '').trim()).filter(Boolean)
                : [];
            if (target === 'selected' && !ids.length) {
                return res.status(400).json({ error: 'Select at least one employee' });
            }
            if (target === 'roles' && !roles.length) {
                return res.status(400).json({ error: 'Select at least one role' });
            }

            const expiry = parseExpiresAt(expiresAt);
            if (expiry.error) {
                return res.status(400).json({ error: expiry.error });
            }

            const categoryVal = (category || '').trim() || null;
            await deps.pool.request()
                .input('id', sql.Int, id)
                .input('title', sql.NVarChar, (title || '').trim())
                .input('body', sql.NVarChar, (body || '').trim())
                .input('isActive', sql.Bit, isActive === false ? 0 : 1)
                .input('priority', sql.Int, parseInt(priority, 10) || 0)
                .input('targetType', sql.NVarChar, target)
                .input('expiresAt', sql.DateTime2, expiry.date)
                .input('category', sql.NVarChar, categoryVal)
                .query(`
                    UPDATE Announcements SET
                        Title = @title, Body = @body, IsActive = @isActive,
                        Priority = @priority, TargetType = @targetType,
                        ExpiresAt = @expiresAt, UpdatedAt = GETDATE(),
                        Category = @category
                    WHERE AnnouncementID = @id
                `);

            await clearAnnouncementTargeting(deps.pool, id);
            if (target === 'selected') {
                const saved = await setAnnouncementRecipients(deps.pool, id, ids);
                if (!saved) {
                    return res.status(400).json({
                        error: 'None of the selected people exist in the database. Refresh the page and pick again.',
                    });
                }
            } else if (target === 'roles') {
                await setAnnouncementRoles(deps.pool, id, roles);
            }

            res.json({ success: true });
        } catch (error) {
            console.error('Admin update announcement:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.delete('/api/admin/announcements/:id', authMiddleware, requireAdmin, requireDb, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            await clearAnnouncementTargeting(deps.pool, id);
            await deps.pool.request()
                .input('id', sql.Int, id)
                .query('DELETE FROM Announcements WHERE AnnouncementID = @id');
            res.json({ success: true });
        } catch (error) {
            console.error('Admin delete announcement:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    /* ── Announcement Categories ── */

    app.get('/api/admin/announcement-categories', authMiddleware, requireDb, async (req, res) => {
        try {
            const result = await deps.pool.request()
                .query('SELECT CategoryID, CategoryName, CreatedAt FROM AnnouncementCategories ORDER BY CategoryName');
            res.json({ success: true, categories: result.recordset });
        } catch (e) {
            console.error('List ann categories:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.post('/api/admin/announcement-categories', authMiddleware, requireAdmin, requireDb, async (req, res) => {
        try {
            const name = (req.body.name || '').trim();
            if (!name) return res.status(400).json({ error: 'Category name is required' });
            const ins = await deps.pool.request()
                .input('n', sql.NVarChar(100), name)
                .query(`
                    INSERT INTO AnnouncementCategories (CategoryName)
                    OUTPUT INSERTED.*
                    VALUES (@n)
                `);
            res.status(201).json({ success: true, category: ins.recordset[0] });
        } catch (e) {
            if (e.number === 2627 || e.number === 2601)
                return res.status(400).json({ error: 'Category already exists' });
            console.error('Create ann category:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.delete('/api/admin/announcement-categories/:id', authMiddleware, requireAdmin, requireDb, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            await deps.pool.request()
                .input('id', sql.Int, id)
                .query('DELETE FROM AnnouncementCategories WHERE CategoryID = @id');
            res.json({ success: true });
        } catch (e) {
            console.error('Delete ann category:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    /* ── Employee Documents (admin view + download) ── */

    app.get('/api/admin/employee-documents', authMiddleware, requireAdmin, requireDb, async (req, res) => {
        try {
            const result = await deps.pool.request().query(`
                SELECT d.*, e.Name AS EmployeeName, e.Email AS EmployeeEmail,
                       r.Name AS ReviewerName
                FROM EmployeeDocuments d
                JOIN Employees e ON e.EmployeeID = d.EmployeeID
                LEFT JOIN Employees r ON r.EmployeeID = d.ReviewedBy
                ORDER BY d.UploadDate DESC
            `);
            res.json({ success: true, documents: result.recordset });
        } catch (e) {
            console.error('List employee docs:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.put('/api/admin/employee-documents/:id/review', authMiddleware, requireAdmin, requireDb, async (req, res) => {
        try {
            const docId  = parseInt(req.params.id, 10);
            const status = (req.body.status || 'Reviewed').trim(); // Reviewed | Rejected
            const notes  = (req.body.notes  || '').trim();
            await deps.pool.request()
                .input('id',     sql.Int,           docId)
                .input('status', sql.NVarChar(20),  status)
                .input('notes',  sql.NVarChar(sql.MAX), notes || null)
                .input('by',     sql.Int,           req.user.employeeId)
                .query(`
                    UPDATE EmployeeDocuments SET
                        ReviewStatus = @status,
                        Notes        = @notes,
                        ReviewedBy   = @by,
                        ReviewedAt   = GETDATE()
                    WHERE DocID = @id
                `);
            res.json({ success: true });
        } catch (e) {
            console.error('Review employee doc:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ===== Working Hours =====

    app.get('/api/admin/working-hours', authMiddleware, requireAdmin, requireDb, async (req, res) => {
        try {
            const result = await deps.pool.request().query(`
                SELECT e.EmployeeID, e.Name, e.Role, t.TeamName,
                       e.ShiftStart, e.ShiftEnd
                FROM Employees e
                LEFT JOIN Teams t ON t.TeamID = e.TeamID
                WHERE ISNULL(e.IsActive, 1) = 1
                ORDER BY e.Name
            `);
            res.json({ success: true, employees: result.recordset });
        } catch (e) {
            console.error('Working hours list:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.put('/api/admin/working-hours/:id(\\d+)', authMiddleware, requireAdmin, requireDb, async (req, res) => {
        try {
            const id    = parseInt(req.params.id, 10);
            const start = (req.body.shiftStart || '').trim() || null;
            const end   = (req.body.shiftEnd   || '').trim() || null;
            await deps.pool.request()
                .input('id',    sql.Int,       id)
                .input('start', sql.NVarChar,  start)
                .input('end',   sql.NVarChar,  end)
                .query(`UPDATE Employees SET ShiftStart = @start, ShiftEnd = @end WHERE EmployeeID = @id`);
            res.json({ success: true });
        } catch (e) {
            console.error('Working hours update:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // Converts an Excel cell value to "HH:MM" string.
    // Excel stores times as day fractions (0.375 = 09:00) and SheetJS may return
    // numbers, Date objects, or already-formatted strings depending on cell type.
    function parseExcelTime(val) {
        if (val === null || val === undefined || val === '') return null;
        if (typeof val === 'string') {
            const s = val.trim();
            if (!s) return null;
            // Already HH:MM or H:MM
            if (/^\d{1,2}:\d{2}$/.test(s)) {
                const [h, m] = s.split(':');
                return `${h.padStart(2, '0')}:${m}`;
            }
            return s;
        }
        if (val instanceof Date) {
            return `${String(val.getUTCHours()).padStart(2,'0')}:${String(val.getUTCMinutes()).padStart(2,'0')}`;
        }
        if (typeof val === 'number' && val >= 0 && val < 1) {
            const totalMins = Math.round(val * 24 * 60);
            return `${String(Math.floor(totalMins / 60)).padStart(2,'0')}:${String(totalMins % 60).padStart(2,'0')}`;
        }
        return String(val).trim() || null;
    }

    app.post('/api/admin/working-hours/bulk', authMiddleware, requireAdmin, requireDb,
        bulkUpload.single('file'), async (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
            // cellDates:true makes SheetJS return Date objects for time cells
            const wb   = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
            const ws   = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

            if (!rows.length) return res.status(400).json({ error: 'No data rows in file' });

            let updated = 0;
            const results = [];
            for (const row of rows) {
                const empId = parseInt(
                    row['EmployeeID'] || row['employeeId'] || row['Employee ID'] || row['employee_id'], 10
                );
                const start = parseExcelTime(row['ShiftStart'] ?? row['Shift Start'] ?? row['shiftStart'] ?? '');
                const end   = parseExcelTime(row['ShiftEnd']   ?? row['Shift End']   ?? row['shiftEnd']   ?? '');
                const label = String(row['Name'] || row['name'] || (isNaN(empId) ? '?' : `ID ${empId}`));

                if (!empId || isNaN(empId)) {
                    results.push({ name: label, status: 'skipped', message: 'Missing or invalid EmployeeID' });
                    continue;
                }

                const check = await deps.pool.request()
                    .input('id', sql.Int, empId)
                    .query('SELECT Name FROM Employees WHERE EmployeeID = @id');
                if (!check.recordset.length) {
                    results.push({ name: label, status: 'skipped', message: `No employee with ID ${empId}` });
                    continue;
                }

                await deps.pool.request()
                    .input('id',    sql.Int,      empId)
                    .input('start', sql.NVarChar, start)
                    .input('end',   sql.NVarChar, end)
                    .query(`UPDATE Employees SET ShiftStart = @start, ShiftEnd = @end WHERE EmployeeID = @id`);

                updated++;
                results.push({ name: check.recordset[0].Name, status: 'updated', message: `${start || '—'} → ${end || '—'}` });
            }
            res.json({ success: true, updated, total: rows.length, results });
        } catch (e) {
            console.error('Working hours bulk:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.get('/api/admin/working-hours/sample', authMiddleware, requireAdmin, requireDb, async (req, res) => {
        try {
            const empRes = await deps.pool.request().query(`
                SELECT e.EmployeeID, e.Name, e.Role,
                       ISNULL(e.ShiftStart, '09:00') AS ShiftStart,
                       ISNULL(e.ShiftEnd,   '17:00') AS ShiftEnd
                FROM Employees e
                WHERE ISNULL(e.IsActive, 1) = 1
                ORDER BY e.Name
            `);
            const wb = XLSX.utils.book_new();
            const dataRows = empRes.recordset.map(r => ({
                'EmployeeID': r.EmployeeID,
                'Name':       r.Name,
                'Role':       r.Role,
                'ShiftStart': r.ShiftStart,
                'ShiftEnd':   r.ShiftEnd,
            }));
            const ws = XLSX.utils.json_to_sheet(dataRows);
            ws['!cols'] = [{wch:12},{wch:24},{wch:14},{wch:12},{wch:12}];
            XLSX.utils.book_append_sheet(wb, ws, 'Working Hours');

            const noteRows = [
                { 'Column': 'EmployeeID', 'Required': 'Yes', 'Example': '1', 'Notes': 'Must match an existing employee ID' },
                { 'Column': 'ShiftStart', 'Required': 'No',  'Example': '09:00', 'Notes': '24-hour format HH:MM' },
                { 'Column': 'ShiftEnd',   'Required': 'No',  'Example': '17:00', 'Notes': '24-hour format HH:MM' },
            ];
            const wsNote = XLSX.utils.json_to_sheet(noteRows);
            wsNote['!cols'] = [{wch:14},{wch:10},{wch:12},{wch:36}];
            XLSX.utils.book_append_sheet(wb, wsNote, 'Instructions');

            const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
            res.setHeader('Content-Disposition', 'attachment; filename="working_hours_sample.xlsx"');
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
            res.send(buf);
        } catch (e) {
            console.error('Working hours sample:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });
    // ===== Absent Today =====
    app.get('/api/admin/attendance/absent-today', authMiddleware, requireTeamAccess, requireDb, async (req, res) => {
        try {
            const dateParam = (req.query.date || '').trim();
            const req2 = deps.pool.request();
            let dateExpr;
            if (dateParam) {
                req2.input('clientDate', sql.Date, new Date(dateParam));
                dateExpr = 'CAST(@clientDate AS DATE)';
            } else {
                dateExpr = 'CAST(GETDATE() AS DATE)';
            }

            const result = await req2.query(`
                SELECT e.EmployeeID, e.Name, e.Role, e.Designation,
                       t.TeamName,
                       c.cliClientName AS ClientName
                FROM Employees e
                LEFT JOIN Teams   t ON t.TeamID      = e.TeamID
                LEFT JOIN Clients c ON c.cliClientID = e.ClientID
                WHERE ISNULL(e.IsActive, 1) = 1
                  AND NOT EXISTS (
                      SELECT 1 FROM Attendance a
                      WHERE a.EmployeeID = e.EmployeeID
                        AND a.Date = ${dateExpr}
                  )
                ORDER BY e.Name
            `);

            res.json({ success: true, date: dateParam || null, count: result.recordset.length, employees: result.recordset });
        } catch (e) {
            console.error('Absent today:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ===== Late Today =====
    app.get('/api/admin/attendance/late-today', authMiddleware, requireTeamAccess, requireDb, async (req, res) => {
        try {
            const dateParam = (req.query.date || '').trim();
            const req2 = deps.pool.request();
            let dateExpr;
            if (dateParam) {
                req2.input('clientDate', sql.Date, new Date(dateParam));
                dateExpr = 'CAST(@clientDate AS DATE)';
            } else {
                dateExpr = 'CAST(GETDATE() AS DATE)';
            }

            const result = await req2.query(`
                SELECT e.EmployeeID, e.Name, e.Role, e.Designation,
                       t.TeamName,
                       c.cliClientName AS ClientName,
                       e.ShiftStart,
                       a.LoginTime,
                       lr.RemarkID, lr.TeamID AS RemarkTeamID, lr.ClientID AS RemarkClientID,
                       lr.Reason,
                       rec.Name     AS RecordedByName,
                       rt.TeamName  AS RemarkTeamName,
                       rc.cliClientName AS RemarkClientName
                FROM Employees e
                INNER JOIN (
                    SELECT EmployeeID, MIN(LoginTime) AS LoginTime
                    FROM Attendance
                    WHERE Date = ${dateExpr}
                      AND LoginTime IS NOT NULL
                    GROUP BY EmployeeID
                ) a ON a.EmployeeID = e.EmployeeID
                LEFT JOIN Teams   t  ON t.TeamID      = e.TeamID
                LEFT JOIN Clients c  ON c.cliClientID = e.ClientID
                LEFT JOIN LateRemarks lr  ON lr.EmployeeID = e.EmployeeID AND lr.Date = ${dateExpr}
                LEFT JOIN Employees rec   ON rec.EmployeeID = lr.RecordedBy
                LEFT JOIN Teams   rt ON rt.TeamID      = lr.TeamID
                LEFT JOIN Clients rc ON rc.cliClientID = lr.ClientID
                WHERE ISNULL(e.IsActive, 1) = 1
                  AND CAST(a.LoginTime AS TIME) > CAST(ISNULL(e.ShiftStart, '09:00') AS TIME)
                ORDER BY a.LoginTime ASC
            `);

            res.json({ success: true, date: dateParam || null, count: result.recordset.length, employees: result.recordset });
        } catch (e) {
            console.error('Late today:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ===== Late Remarks — POST (upsert: insert or update on conflict) =====
    app.post('/api/admin/attendance/late-remarks', authMiddleware, requireTeamAccess, requireDb, async (req, res) => {
        try {
            const { employeeId, date, teamId, clientId, reason } = req.body;
            if (!employeeId || !date || !reason?.trim()) {
                return res.status(400).json({ error: 'employeeId, date and reason are required' });
            }

            const result = await deps.pool.request()
                .input('eid',   sql.Int,      parseInt(employeeId, 10))
                .input('dt',    sql.Date,     new Date(date))
                .input('tid',   sql.Int,      teamId   ? parseInt(teamId,   10) : null)
                .input('cid',   sql.Int,      clientId ? parseInt(clientId, 10) : null)
                .input('rsn',   sql.NVarChar, reason.trim())
                .input('by',    sql.Int,      req.user.employeeId || null)
                .query(`
                    MERGE LateRemarks AS target
                    USING (SELECT @eid AS EmployeeID, @dt AS Date) AS src
                        ON target.EmployeeID = src.EmployeeID AND target.Date = src.Date
                    WHEN MATCHED THEN
                        UPDATE SET TeamID = @tid, ClientID = @cid, Reason = @rsn
                    WHEN NOT MATCHED THEN
                        INSERT (EmployeeID, Date, TeamID, ClientID, Reason, RecordedBy)
                        VALUES (@eid, @dt, @tid, @cid, @rsn, @by)
                    OUTPUT INSERTED.RemarkID;
                `);

            res.json({ success: true, remarkId: result.recordset[0]?.RemarkID });
        } catch (e) {
            console.error('Late remarks POST:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ===== Late Remarks — PUT (update) =====
    app.put('/api/admin/attendance/late-remarks/:id(\\d+)', authMiddleware, requireTeamAccess, requireDb, async (req, res) => {
        try {
            const remarkId = parseInt(req.params.id, 10);
            const { teamId, clientId, reason } = req.body;
            if (!reason?.trim()) return res.status(400).json({ error: 'reason is required' });

            const result = await deps.pool.request()
                .input('id',  sql.Int,      remarkId)
                .input('tid', sql.Int,      teamId   ? parseInt(teamId,   10) : null)
                .input('cid', sql.Int,      clientId ? parseInt(clientId, 10) : null)
                .input('rsn', sql.NVarChar, reason.trim())
                .query(`
                    UPDATE LateRemarks
                    SET TeamID = @tid, ClientID = @cid, Reason = @rsn
                    WHERE RemarkID = @id
                `);

            if (result.rowsAffected[0] === 0) return res.status(404).json({ error: 'Remark not found' });
            res.json({ success: true });
        } catch (e) {
            console.error('Late remarks PUT:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });
}

module.exports = { registerAdminManagementRoutes };
