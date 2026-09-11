/**
 * Roles, screens, and role-screen permissions
 */

const { sql } = require('../config/database');

const DEFAULT_SCREENS = [
    { key: 'dashboard', name: 'Dashboard', path: 'dashboard.html', sort: 1 },
    { key: 'profile', name: 'Profile', path: 'profile.html', sort: 2 },
    { key: 'tasks', name: 'Tasks', path: 'tasks.html', sort: 3 },
    { key: 'inventory', name: 'Inventory', path: 'inventory.html', sort: 4 },
    { key: 'knowledge-base', name: 'Knowledge Base', path: 'knowledge-base.html', sort: 5 },
    { key: 'medical-balance', name: 'Medical Balance', path: 'medical-balance.html', sort: 6 },
    { key: 'feedback', name: 'Suggestions & Complaints', path: 'feedback.html', sort: 7 },
    { key: 'jobs',            name: 'Job Announcements',  path: 'job-announcements.html', sort: 8  },
    { key: 'training',        name: 'Training',           path: 'training.html',          sort: 9  },
    { key: 'admin-dashboard', name: 'Admin — Dashboard',  path: 'admin-dashboard.html',   sort: 11 },
    { key: 'admin-employees', name: 'Admin — Employees', path: 'admin-employees.html', sort: 11 },
    { key: 'admin-users', name: 'Admin — User Management', path: 'admin-users.html', sort: 12 },
    { key: 'admin-roles', name: 'Admin — Roles & Screens', path: 'admin-roles.html', sort: 13 },
    { key: 'admin-announcements', name: 'Admin — Announcements', path: 'admin-announcements.html', sort: 14 },
    { key: 'admin-jobs', name: 'Admin — Job Postings', path: 'admin-jobs.html', sort: 15 },
    { key: 'admin-training', name: 'Admin — Training', path: 'admin-training.html', sort: 16 },
    { key: 'chat',              name: 'Chat',                path: 'chat.html',              sort: 10 },
    { key: 'task-log',          name: 'Daily Task Log',      path: 'task-log.html',          sort: 11 },
    { key: 'admin-medical',     name: 'Admin — Manage Balances', path: 'admin-medical.html',   sort: 20 },
    { key: 'team-dashboard',    name: 'Team Dashboard',          path: 'team-dashboard.html',  sort: 10 },
    { key: 'late-today',        name: 'Late Employees',          path: 'admin-late-today.html', sort: 21 },
    { key: 'absent-today',      name: 'Absent Today',            path: 'admin-absent-today.html', sort: 22 },
];

const EMPLOYEE_SCREENS = [
    'dashboard', 'profile', 'tasks', 'inventory',
    'knowledge-base', 'medical-balance', 'feedback', 'jobs', 'training', 'chat', 'task-log',
];

const DEFAULT_ROLES = [
    {
        name: 'Admin',
        description: 'Full system access',
        isSystem: true,
        screens: DEFAULT_SCREENS.map(s => s.key).filter(k => k !== 'admin-medical'),
    },
    {
        name: 'SuperAdmin',
        description: 'Super administrator — same full access as Admin',
        isSystem: true,
        screens: DEFAULT_SCREENS.map(s => s.key).filter(k => k !== 'admin-medical'),
    },
    {
        name: 'Manager',
        description: 'Supervises multiple teams, manages attendance remarks',
        isSystem: true,
        screens: [...EMPLOYEE_SCREENS, 'team-dashboard', 'late-today', 'absent-today'],
    },
    {
        name: 'TeamLead',
        description: 'Leads a single team, can view team attendance and add remarks',
        isSystem: true,
        screens: [...EMPLOYEE_SCREENS, 'team-dashboard'],
    },
    {
        name: 'Employee',
        description: 'Standard employee access',
        isSystem: true,
        screens: EMPLOYEE_SCREENS,
    },
    {
        name: 'FinanceManager',
        description: 'Access to finance modules: loans, medical balances, reports',
        isSystem: true,
        screens: ['dashboard', 'profile', 'admin-medical'],
    },
];

async function ensureRbacTables(pool) {
    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Roles')
        CREATE TABLE Roles (
            RoleID INT PRIMARY KEY IDENTITY(1,1),
            RoleName NVARCHAR(50) NOT NULL UNIQUE,
            Description NVARCHAR(255) NULL,
            IsSystem BIT NOT NULL DEFAULT 0,
            CreatedAt DATETIME2 DEFAULT GETDATE()
        );

        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Screens')
        CREATE TABLE Screens (
            ScreenID INT PRIMARY KEY IDENTITY(1,1),
            ScreenKey NVARCHAR(50) NOT NULL UNIQUE,
            ScreenName NVARCHAR(100) NOT NULL,
            Path NVARCHAR(120) NOT NULL,
            SortOrder INT NOT NULL DEFAULT 0
        );

        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'RoleScreens')
        CREATE TABLE RoleScreens (
            RoleID INT NOT NULL,
            ScreenID INT NOT NULL,
            PRIMARY KEY (RoleID, ScreenID),
            CONSTRAINT FK_RoleScreens_Role FOREIGN KEY (RoleID) REFERENCES Roles(RoleID) ON DELETE CASCADE,
            CONSTRAINT FK_RoleScreens_Screen FOREIGN KEY (ScreenID) REFERENCES Screens(ScreenID) ON DELETE CASCADE
        );

        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Employees') AND name = 'IsActive')
            ALTER TABLE Employees ADD IsActive BIT NOT NULL DEFAULT 1;
    `);

    // Remove finance-dashboard screen entirely
    await pool.request().query(`DELETE FROM Screens WHERE ScreenKey = 'finance-dashboard'`);

    // Deduplicate SuperAdmin: delete any variant whose name is not exactly 'SuperAdmin'
    // but normalises to the same thing (e.g. "Super Admin", "super admin", "SUPERADMIN")
    // RoleScreens are removed automatically via ON DELETE CASCADE.
    await pool.request().query(`
        DELETE FROM Roles
        WHERE LOWER(REPLACE(RoleName, ' ', '')) = 'superadmin'
          AND RoleName <> 'SuperAdmin'
    `);

    // Ensure team-dashboard is NOT accessible to Employee or FinanceManager
    await pool.request().query(`
        DELETE rs FROM RoleScreens rs
        INNER JOIN Roles r   ON r.RoleID   = rs.RoleID
        INNER JOIN Screens s ON s.ScreenID = rs.ScreenID
        WHERE s.ScreenKey IN ('team-dashboard', 'late-today', 'absent-today')
          AND r.RoleName IN ('Employee', 'FinanceManager')
    `);

    // Force-assign new screens to existing roles (bypasses the IF NOT EXISTS loop
    // which only fires on first role insert and misses subsequent screen additions)
    await pool.request().query(`
        INSERT INTO RoleScreens (RoleID, ScreenID)
        SELECT r.RoleID, s.ScreenID
        FROM Roles r
        CROSS JOIN Screens s
        WHERE (
            (r.RoleName = 'Manager'  AND s.ScreenKey IN ('team-dashboard', 'late-today', 'absent-today'))
            OR
            (r.RoleName = 'TeamLead' AND s.ScreenKey = 'team-dashboard')
        )
        AND NOT EXISTS (
            SELECT 1 FROM RoleScreens rs2
            WHERE rs2.RoleID = r.RoleID AND rs2.ScreenID = s.ScreenID
        )
    `);

    // Remove admin-medical from Admin/SuperAdmin roles (granted separately via email check in /me/screens)
    await pool.request().query(`
        DELETE rs FROM RoleScreens rs
        INNER JOIN Roles r   ON r.RoleID   = rs.RoleID
        INNER JOIN Screens s ON s.ScreenID = rs.ScreenID
        WHERE r.RoleName IN ('Admin', 'SuperAdmin') AND s.ScreenKey = 'admin-medical'
    `);

    for (const s of DEFAULT_SCREENS) {
        await pool.request()
            .input('key', sql.NVarChar, s.key)
            .input('name', sql.NVarChar, s.name)
            .input('path', sql.NVarChar, s.path)
            .input('sort', sql.Int, s.sort)
            .query(`
                IF NOT EXISTS (SELECT 1 FROM Screens WHERE ScreenKey = @key)
                INSERT INTO Screens (ScreenKey, ScreenName, Path, SortOrder) VALUES (@key, @name, @path, @sort)
            `);
    }

    for (const role of DEFAULT_ROLES) {
        await pool.request()
            .input('name', sql.NVarChar, role.name)
            .input('desc', sql.NVarChar, role.description)
            .input('isSystem', sql.Bit, role.isSystem ? 1 : 0)
            .query(`
                IF NOT EXISTS (SELECT 1 FROM Roles WHERE RoleName = @name)
                INSERT INTO Roles (RoleName, Description, IsSystem) VALUES (@name, @desc, @isSystem)
            `);

        const roleRow = await pool.request()
            .input('name', sql.NVarChar, role.name)
            .query('SELECT RoleID FROM Roles WHERE RoleName = @name');
        const roleId = roleRow.recordset[0]?.RoleID;
        if (!roleId) continue;

        for (const screenKey of role.screens) {
            await pool.request()
                .input('roleId', sql.Int, roleId)
                .input('key', sql.NVarChar, screenKey)
                .query(`
                    IF NOT EXISTS (
                        SELECT 1 FROM RoleScreens rs
                        INNER JOIN Screens s ON s.ScreenID = rs.ScreenID
                        WHERE rs.RoleID = @roleId AND s.ScreenKey = @key
                    )
                    INSERT INTO RoleScreens (RoleID, ScreenID)
                    SELECT @roleId, ScreenID FROM Screens WHERE ScreenKey = @key
                `);
        }
    }
}

async function getScreensForRoleName(pool, roleName) {
    const result = await pool.request()
        .input('roleName', sql.NVarChar, roleName)
        .query(`
            SELECT s.ScreenKey, s.ScreenName, s.Path, s.SortOrder
            FROM Screens s
            INNER JOIN RoleScreens rs ON rs.ScreenID = s.ScreenID
            INNER JOIN Roles r ON r.RoleID = rs.RoleID
            WHERE r.RoleName = @roleName
            ORDER BY s.SortOrder, s.ScreenName
        `);

    if (result.recordset.length) return result.recordset;

    const fallback = await pool.request()
        .input('roleName', sql.NVarChar, roleName)
        .query(`
            SELECT ScreenKey, ScreenName, Path, SortOrder FROM Screens
            WHERE (@roleName IN ('Admin', 'SuperAdmin') AND ScreenKey LIKE 'admin-%')
               OR (@roleName IN ('Manager', 'Employee') AND ScreenKey NOT LIKE 'admin-%')
            ORDER BY SortOrder
        `);
    return fallback.recordset;
}

async function setRoleScreens(pool, roleId, screenKeys) {
    await pool.request()
        .input('roleId', sql.Int, roleId)
        .query('DELETE FROM RoleScreens WHERE RoleID = @roleId');

    for (const key of screenKeys) {
        await pool.request()
            .input('roleId', sql.Int, roleId)
            .input('key', sql.NVarChar, key)
            .query(`
                INSERT INTO RoleScreens (RoleID, ScreenID)
                SELECT @roleId, ScreenID FROM Screens WHERE ScreenKey = @key
            `);
    }
}

module.exports = {
    ensureRbacTables,
    getScreensForRoleName,
    setRoleScreens,
    DEFAULT_SCREENS,
};
