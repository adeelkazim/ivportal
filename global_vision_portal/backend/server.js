const express = require('express');
const http    = require('http');
const path    = require('path');
const { Server: SocketServer } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const XLSX = require('xlsx');
const { sql, dbConfig, DB_NAME, buildConnectionString } = require('./config/database');
const DB_SERVER_DISPLAY = (process.env.DB_SERVER || '(localdb)\\MSSQLLocalDB').replace(/\\/g, '\\');
const multer = require('multer');
const { parseInventoryFile } = require('./utils/parseInventoryFile');
const { parseAttendanceFile } = require('./utils/parseAttendanceFile');
const { signToken, authMiddleware, requireAdmin, requireManagerOrAdmin, isAdminRole } = require('./middleware/auth');
const {
    ensureUsernamesTable,
    ensureEmployeeProfileColumns,
    ensureTeamsTable,
    ensureInventoryColumns,
    ensureInventoryEmployeeLink,
    ensureClientsTable,
    removeDepartmentColumn,
    ensureAnnouncementCategories,
    ensureTasksExtendedColumns,
    ensureEmployeeDocumentsTable,
    ensureJobRecommendationCvColumn,
    ensureBalanceCards,
    ensureAttendanceLoginType,
    ensureTaskLogEndDate,
    ensureFinanceLoans,
    ensureWorkingHoursColumns,
    ensureLateRemarksTable,
    ensureManagerTeamsTable,
} = require('./services/schema');
const { ensureRbacTables } = require('./services/rbac');
const { ensureAnnouncementsTable } = require('./services/announcements');
const { ensureChatTables, registerChatRoutes, registerChatSocket } = require('./services/chat');
const { ensureHrPortalTables } = require('./services/hrPortal');
const { registerAdminManagementRoutes } = require('./routes/adminManagement');
const { registerHrPortalRoutes } = require('./routes/hrPortal');
const { registerTaskLogRoutes } = require('./routes/taskLogs');
const { registerFinanceRoutes } = require('./routes/finance');
const { registerTeamDashboardRoutes } = require('./routes/teamDashboard');
const {
    ensureNotificationsTable,
    notifyInventoryRequest,
    notifyNewInventoryRequest,
    notifyInventoryReturn,
    notifyTaskStatusChange,
    mapNotification
} = require('./services/notifications');

const csvXlsxFilter = (req, file, cb) => {
    const name = file.originalname.toLowerCase();
    const ok = file.mimetype === 'text/csv' ||
        file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        file.mimetype === 'application/vnd.ms-excel' ||
        name.endsWith('.csv') || name.endsWith('.xlsx') || name.endsWith('.xls');
    cb(ok ? null : new Error('Only CSV or Excel files are allowed'), ok);
};

const attendanceUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: csvXlsxFilter,
});

const inventoryUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const name = file.originalname.toLowerCase();
        const allowed =
            file.mimetype === 'text/csv' ||
            file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
            file.mimetype === 'application/vnd.ms-excel' ||
            name.endsWith('.csv') ||
            name.endsWith('.xlsx') ||
            name.endsWith('.xls');
        if (allowed) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV (.csv) or Excel (.xlsx, .xls) files are allowed'));
        }
    }
});

dotenv.config();

const app        = express();
const httpServer  = http.createServer(app);
const io          = new SocketServer(httpServer, {
    cors: { origin: true, credentials: true },
    maxHttpBufferSize: 50 * 1024 * 1024,
});
const PORT = process.env.PORT || 3000;

app.use(helmet({
    contentSecurityPolicy: false,        // App uses inline onclick handlers throughout
    crossOriginResourcePolicy: false,    // Allow cross-origin resource access for downloads
}));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '4mb' }));

// Explicit CORS + CORP headers for uploads (before other routes)
app.use('/uploads', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS, POST');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Cross-Origin-Resource-Policy', 'cross-origin');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Serve frontend static files via HTTP
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Serve uploaded files (CVs, docs, etc.)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

let pool;
let dbConnected = false;

function mapEmployee(row) {
    return {
        id: row.EmployeeID,
        EmployeeID: row.EmployeeID,
        EmpID: row.EmployeeID,
        name: row.Name,
        Name: row.Name,
        EmpName: row.Name,
        email: row.Email,
        Email: row.Email,
        EmpEmail: row.Email,
        role: row.Role,
        Role: row.Role,
        contact: row.Contact,
        Contact: row.Contact,
        username: row.Username || null,
        Username: row.Username || null,
        profileImageUrl: row.ProfileImageUrl || null,
        ProfileImageUrl: row.ProfileImageUrl || null,
        fatherName: row.FatherName || null,
        FatherName: row.FatherName || null,
        EmpFatherName: row.FatherName || null,
        qualification: row.Qualification || null,
        Qualification: row.Qualification || null,
        EmpQualification: row.Qualification || null,
        certifications: row.Certifications || null,
        Certifications: row.Certifications || null,
        EmpCertifications: row.Certifications || null,
        cvFile: row.CVFile || null,
        CVFile: row.CVFile || null,
        EmpCVFile: row.CVFile || null,
        appointedOn: row.AppointedOn || null,
        AppointedOn: row.AppointedOn || null,
        EmpAppointedOn: row.AppointedOn || null,
        designation: row.Designation || row.Role || null,
        Designation: row.Designation || null,
        EmpDesignation: row.Designation || null,
        teamId: row.TeamID || null,
        TeamID: row.TeamID || null,
        teamName: row.TeamName || null,
        TeamName: row.TeamName || null,
        clientId: row.ClientID || null,
        ClientID: row.ClientID || null,
        clientName: row.cliClientName || null,
        ClientName: row.cliClientName || null,
        isActive: row.IsActive !== false && row.IsActive !== 0,
        IsActive: row.IsActive !== false && row.IsActive !== 0
    };
}

const EMPLOYEE_SELECT = `
    e.EmployeeID, e.Name, e.Email, e.Role, e.Contact, e.ProfileImageUrl,
    e.FatherName, e.Qualification, e.Certifications, e.CVFile, e.AppointedOn,
    e.Designation, e.TeamID, t.TeamName, e.ClientID, c.cliClientName, u.Username
`;
const EMPLOYEE_FROM = `
    FROM Employees e
    LEFT JOIN Teams t ON t.TeamID = e.TeamID
    LEFT JOIN Clients c ON c.cliClientID = e.ClientID
    LEFT JOIN Usernames u ON u.EmployeeID = e.EmployeeID
`;

function mapTask(row) {
    return {
        TaskID: row.TaskID,
        Title: row.Title,
        Description: row.Description,
        Project: row.Project || null,
        Notes: row.Notes || null,
        AssignedTo: row.AssignedTo,
        AssignedToName: row.AssignedToName || null,
        AssignedBy: row.AssignedBy,
        AssignedByName: row.AssignedByName || null,
        AssignedByRole: row.AssignedByRole || null,
        Status: row.Status,
        Priority: row.Priority,
        Deadline: row.Deadline,
        StartTime: row.StartTime || null,
        EndTime: row.EndTime || null,
        CompletedDate: row.CompletedDate,
        CreatedAt: row.CreatedAt,
        TeamID: row.TeamID || null,
        TeamName: row.TeamName || null,
        ClientID: row.ClientID || null,
        ClientName: row.ClientName || null
    };
}

function mapInventory(row) {
    return {
        ItemID: row.ItemID,
        ItemName: row.ItemName,
        Quantity: row.Quantity,
        AvailableQuantity: row.AvailableQuantity,
        IssuedTo: row.IssuedTo,
        IssuedToName: row.IssuedToName || null,
        IssueDate: row.IssueDate,
        ReturnDate: row.ReturnDate,
        Status: row.Status,
        DeskNo: row.DeskNo || null,
        ExternalItemId: row.ExternalItemId || null,
        IssuedToEmail: row.IssuedToEmail || null,
        IssuedToUsername: row.IssuedToUsername || null,
        RequestNotes: row.RequestNotes || null
    };
}

function mapKB(row) {
    return {
        ProblemID: row.ProblemID,
        Title: row.Title,
        Description: row.Description,
        Solution: row.Solution,
        Category: row.Category,
        AddedBy: row.AddedBy,
        ViewCount: row.ViewCount,
        CreatedAt: row.CreatedAt
    };
}

async function connectToDatabase() {
    try {
        pool = await sql.connect(dbConfig);
        await pool.request().query('SELECT 1');
        dbConnected = true;
        console.log(`Database connected: ${DB_SERVER_DISPLAY} / ${DB_NAME}`);
        await ensureInventoryColumns(pool);
        await ensureUsernamesTable(pool);
        await ensureEmployeeProfileColumns(pool);
        await ensureTeamsTable(pool);
        await ensureClientsTable(pool);
        await removeDepartmentColumn(pool);
        await ensureInventoryEmployeeLink(pool);
        await ensureNotificationsTable(pool);
        await ensureRbacTables(pool);
        await ensureAnnouncementsTable(pool);
        await ensureHrPortalTables(pool);
        await ensureChatTables(pool);
        await ensureAnnouncementCategories(pool);
        await ensureTasksExtendedColumns(pool);
        await ensureEmployeeDocumentsTable(pool);
        await ensureJobRecommendationCvColumn(pool);
        await ensureBalanceCards(pool);
        await ensureAttendanceLoginType(pool);
        await ensureTaskLogEndDate(pool);
        await ensureFinanceLoans(pool);
        await ensureWorkingHoursColumns(pool);
        await ensureLateRemarksTable(pool);
        await ensureManagerTeamsTable(pool);
    } catch (error) {
        dbConnected = false;
        console.error('Database connection failed:', error.message);
        if (error.precedingErrors && error.precedingErrors.length) {
            error.precedingErrors.forEach((e, i) => {
                console.error(`  Detail ${i + 1}:`, e.message);
            });
        }
        console.error('Run: npm run init-db');
        console.error('If HR tables failed: node scripts/repair-hr-tables.js');
        console.error('Ensure LocalDB is running: sqllocaldb start MSSQLLocalDB');
    }
}

function requireDb(req, res, next) {
    if (!dbConnected || !pool) {
        return res.status(503).json({ error: 'Database unavailable. Start SQL Server LocalDB and run init-database.js' });
    }
    next();
}

// ===== Health =====
app.get('/api/health', async (req, res) => {
    res.json({
        status: 'OK',
        database: dbConnected ? 'Connected' : 'Disconnected',
        server: DB_SERVER_DISPLAY,
        databaseName: dbConfig.database
    });
});

// ===== Auth =====
app.post('/api/auth/login', requireDb, async (req, res) => {
    try {
        const { email, password } = req.body;
        const login = (email || '').trim();
        const loginKey = login.toLowerCase();
        if (!login || !password) {
            return res.status(400).json({ error: 'Email/username and password required' });
        }

        const result = await pool.request()
            .input('loginKey', sql.NVarChar, loginKey)
            .query(`
                SELECT e.*, u.Username
                FROM Employees e
                LEFT JOIN Usernames u ON u.EmployeeID = e.EmployeeID
                WHERE LOWER(LTRIM(e.Email)) = @loginKey
                   OR LOWER(LTRIM(u.Username)) = @loginKey
            `);

        const row = result.recordset[0];
        if (!row) {
            return res.status(401).json({ error: 'Invalid email/username or password' });
        }

        const hash = row.PasswordHash || '';
        let valid = hash.startsWith('$2')
            ? await bcrypt.compare(password, hash)
            : false;

        if (!valid && hash && !hash.startsWith('$2')) {
            valid = password === hash;
            if (valid) {
                const newHash = await bcrypt.hash(password, 10);
                await pool.request()
                    .input('id', sql.Int, row.EmployeeID)
                    .input('newHash', sql.NVarChar, newHash)
                    .query('UPDATE Employees SET PasswordHash = @newHash WHERE EmployeeID = @id');
            }
        }

        if (!valid) {
            return res.status(401).json({ error: 'Invalid email/username or password' });
        }

        if (row.IsActive === false || row.IsActive === 0) {
            return res.status(403).json({ error: 'Account deactivated. Contact your administrator.' });
        }

        const user = mapEmployee(row);
        const token = signToken(user);

        res.json({ success: true, token, user });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/auth/register', requireDb, async (req, res) => {
    return res.status(403).json({
        error: 'Self-registration is disabled. Please contact your administrator for an account.',
    });
});

app.post('/api/auth/logout', authMiddleware, (req, res) => {
    res.json({ success: true, message: 'Logged out' });
});

// ===== Attendance =====
app.get('/api/attendance', authMiddleware, requireDb, async (req, res) => {
    try {
        let employeeId = req.user.employeeId;
        if (req.query.employeeId && isAdminRole(req.user.role)) {
            employeeId = parseInt(req.query.employeeId, 10);
        }

        const result = await pool.request()
            .input('employeeId', sql.Int, employeeId)
            .query(`
                SELECT TOP 50 AttendanceID, EmployeeID, Date, LoginTime, LogoutTime, TotalHours, CreatedAt
                FROM Attendance WHERE EmployeeID = @employeeId
                ORDER BY Date DESC, LoginTime DESC
            `);
        res.json({ success: true, records: result.recordset });
    } catch (error) {
        console.error('Attendance fetch:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/attendance/today', authMiddleware, requireDb, async (req, res) => {
    try {
        let employeeId = req.user.employeeId;
        if (req.query.employeeId && isAdminRole(req.user.role)) {
            employeeId = parseInt(req.query.employeeId, 10);
        }

        const result = await pool.request()
            .input('employeeId', sql.Int, employeeId)
            .query(`
                SELECT TOP 1 * FROM Attendance
                WHERE EmployeeID = @employeeId AND Date = CAST(GETDATE() AS DATE)
                ORDER BY AttendanceID DESC
            `);
        res.json({ success: true, record: result.recordset[0] || null });
    } catch (error) {
        console.error('Attendance today:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/attendance/stats', authMiddleware, requireDb, async (req, res) => {
    try {
        let employeeId = req.user.employeeId;
        if (req.query.employeeId && isAdminRole(req.user.role)) {
            employeeId = parseInt(req.query.employeeId, 10);
        }

        const result = await pool.request()
            .input('employeeId', sql.Int, employeeId)
            .query(`
                SELECT ISNULL(SUM(
                    CASE
                        WHEN TotalHours IS NOT NULL THEN CAST(TotalHours AS FLOAT)
                        WHEN LogoutTime IS NOT NULL AND LoginTime IS NOT NULL
                            THEN ROUND(DATEDIFF(MINUTE, LoginTime, LogoutTime) / 60.0, 2)
                        ELSE 0
                    END
                ), 0) AS monthlyHours
                FROM Attendance
                WHERE EmployeeID = @employeeId
                  AND MONTH(Date) = MONTH(GETDATE())
                  AND YEAR(Date) = YEAR(GETDATE())
            `);
        res.json({
            success: true,
            monthlyHours: parseFloat(result.recordset[0].monthlyHours) || 0
        });
    } catch (error) {
        console.error('Attendance stats:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/attendance/login', authMiddleware, requireDb, async (req, res) => {
    try {
        const employeeId  = req.body.employeeId || req.user.employeeId;
        // Use client-provided date/time when available (fixes server-UTC vs local timezone mismatch)
        const clientDate  = req.body.clientDate || null;   // 'YYYY-MM-DD'
        const clientTime  = req.body.clientTime || null;   // ISO string

        const today = await pool.request()
            .input('employeeId', sql.Int, employeeId)
            .input('date', sql.Date, clientDate ? new Date(clientDate) : null)
            .query(clientDate
                ? `SELECT TOP 1 * FROM Attendance WHERE EmployeeID = @employeeId AND Date = @date AND LogoutTime IS NULL`
                : `SELECT TOP 1 * FROM Attendance WHERE EmployeeID = @employeeId AND Date = CAST(GETDATE() AS DATE) AND LogoutTime IS NULL`);

        if (today.recordset.length > 0) {
            return res.json({ success: true, record: today.recordset[0], message: 'Already logged in' });
        }

        const req2 = pool.request().input('employeeId', sql.Int, employeeId);
        let insertQuery;
        if (clientDate && clientTime) {
            req2.input('date', sql.Date, new Date(clientDate));
            req2.input('loginTime', sql.DateTime, new Date(clientTime));
            insertQuery = `INSERT INTO Attendance (EmployeeID, Date, LoginTime) OUTPUT INSERTED.* VALUES (@employeeId, @date, @loginTime)`;
        } else {
            insertQuery = `INSERT INTO Attendance (EmployeeID, Date, LoginTime) OUTPUT INSERTED.* VALUES (@employeeId, CAST(GETDATE() AS DATE), GETDATE())`;
        }
        const insert = await req2.query(insertQuery);
        res.json({ success: true, record: insert.recordset[0] });
    } catch (error) {
        console.error('Attendance login:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/attendance/logout', authMiddleware, requireDb, async (req, res) => {
    try {
        const employeeId = req.body.employeeId || req.user.employeeId;
        const clientDate = req.body.clientDate || null;
        const clientTime = req.body.clientTime || null;

        const openReq = pool.request().input('employeeId', sql.Int, employeeId);
        let openQuery;
        if (clientDate) {
            openReq.input('date', sql.Date, new Date(clientDate));
            openQuery = `SELECT TOP 1 AttendanceID, LoginTime FROM Attendance WHERE EmployeeID = @employeeId AND Date = @date AND LogoutTime IS NULL ORDER BY AttendanceID DESC`;
        } else {
            openQuery = `SELECT TOP 1 AttendanceID, LoginTime FROM Attendance WHERE EmployeeID = @employeeId AND Date = CAST(GETDATE() AS DATE) AND LogoutTime IS NULL ORDER BY AttendanceID DESC`;
        }
        const open = await openReq.query(openQuery);

        if (open.recordset.length === 0) {
            return res.status(400).json({ error: 'No active login for today' });
        }

        const attId = open.recordset[0].AttendanceID;
        const updReq = pool.request().input('id', sql.Int, attId);
        let updateQuery;
        if (clientTime) {
            updReq.input('logoutTime', sql.DateTime, new Date(clientTime));
            updateQuery = `UPDATE Attendance SET LogoutTime = @logoutTime, TotalHours = ROUND(DATEDIFF(MINUTE, LoginTime, @logoutTime) / 60.0, 2) OUTPUT INSERTED.* WHERE AttendanceID = @id`;
        } else {
            updateQuery = `UPDATE Attendance SET LogoutTime = GETDATE(), TotalHours = ROUND(DATEDIFF(MINUTE, LoginTime, GETDATE()) / 60.0, 2) OUTPUT INSERTED.* WHERE AttendanceID = @id`;
        }
        const update = await updReq.query(updateQuery);
        res.json({ success: true, record: update.recordset[0] });
    } catch (error) {
        console.error('Attendance logout:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/attendance/toggle', authMiddleware, requireDb, async (req, res) => {
    try {
        const employeeId = req.user.employeeId;
        const clientDate = req.body?.clientDate || null;   // 'YYYY-MM-DD' local date
        const clientTime = req.body?.clientTime || null;   // ISO UTC string

        const openReq = pool.request().input('employeeId', sql.Int, employeeId);
        let openQuery;
        if (clientDate) {
            openReq.input('date', sql.Date, new Date(clientDate));
            openQuery = `SELECT TOP 1 AttendanceID FROM Attendance WHERE EmployeeID = @employeeId AND Date = @date AND LogoutTime IS NULL`;
        } else {
            openQuery = `SELECT TOP 1 AttendanceID FROM Attendance WHERE EmployeeID = @employeeId AND Date = CAST(GETDATE() AS DATE) AND LogoutTime IS NULL`;
        }
        const open = await openReq.query(openQuery);

        if (open.recordset.length === 0) {
            const insReq = pool.request().input('employeeId', sql.Int, employeeId);
            let insertQuery;
            if (clientDate && clientTime) {
                insReq.input('date', sql.Date, new Date(clientDate));
                insReq.input('loginTime', sql.DateTime, new Date(clientTime));
                insertQuery = `INSERT INTO Attendance (EmployeeID, Date, LoginTime) OUTPUT INSERTED.* VALUES (@employeeId, @date, @loginTime)`;
            } else {
                insertQuery = `INSERT INTO Attendance (EmployeeID, Date, LoginTime) OUTPUT INSERTED.* VALUES (@employeeId, CAST(GETDATE() AS DATE), GETDATE())`;
            }
            const insert = await insReq.query(insertQuery);
            return res.json({ success: true, action: 'login', record: insert.recordset[0] });
        }

        const attId = open.recordset[0].AttendanceID;
        const updReq = pool.request().input('id', sql.Int, attId);
        let updateQuery;
        if (clientTime) {
            updReq.input('logoutTime', sql.DateTime, new Date(clientTime));
            updateQuery = `UPDATE Attendance SET LogoutTime = @logoutTime, TotalHours = ROUND(DATEDIFF(MINUTE, LoginTime, @logoutTime) / 60.0, 2) OUTPUT INSERTED.* WHERE AttendanceID = @id`;
        } else {
            updateQuery = `UPDATE Attendance SET LogoutTime = GETDATE(), TotalHours = ROUND(DATEDIFF(MINUTE, LoginTime, GETDATE()) / 60.0, 2) OUTPUT INSERTED.* WHERE AttendanceID = @id`;
        }
        const update = await updReq.query(updateQuery);
        res.json({ success: true, action: 'logout', record: update.recordset[0] });
    } catch (error) {
        console.error('Attendance toggle:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/attendance/remote-toggle', authMiddleware, requireDb, async (req, res) => {
    try {
        const employeeId = req.user.employeeId;
        const clientDate = req.body?.clientDate || null;
        const clientTime = req.body?.clientTime || null;

        const openReq = pool.request().input('employeeId', sql.Int, employeeId);
        let openQuery;
        if (clientDate) {
            openReq.input('date', sql.Date, new Date(clientDate));
            openQuery = `SELECT TOP 1 AttendanceID FROM Attendance WHERE EmployeeID = @employeeId AND Date = @date AND LogoutTime IS NULL AND LoginType = 'Remote'`;
        } else {
            openQuery = `SELECT TOP 1 AttendanceID FROM Attendance WHERE EmployeeID = @employeeId AND Date = CAST(GETDATE() AS DATE) AND LogoutTime IS NULL AND LoginType = 'Remote'`;
        }
        const open = await openReq.query(openQuery);

        if (open.recordset.length === 0) {
            const insReq = pool.request().input('employeeId', sql.Int, employeeId);
            let insertQuery;
            if (clientDate && clientTime) {
                insReq.input('date', sql.Date, new Date(clientDate));
                insReq.input('loginTime', sql.DateTime, new Date(clientTime));
                insertQuery = `INSERT INTO Attendance (EmployeeID, Date, LoginTime, LoginType) OUTPUT INSERTED.* VALUES (@employeeId, @date, @loginTime, 'Remote')`;
            } else {
                insertQuery = `INSERT INTO Attendance (EmployeeID, Date, LoginTime, LoginType) OUTPUT INSERTED.* VALUES (@employeeId, CAST(GETDATE() AS DATE), GETDATE(), 'Remote')`;
            }
            const insert = await insReq.query(insertQuery);
            return res.json({ success: true, action: 'login', loginType: 'Remote', record: insert.recordset[0] });
        }

        const attId = open.recordset[0].AttendanceID;
        const updReq = pool.request().input('id', sql.Int, attId);
        let updateQuery;
        if (clientTime) {
            updReq.input('logoutTime', sql.DateTime, new Date(clientTime));
            updateQuery = `UPDATE Attendance SET LogoutTime = @logoutTime, TotalHours = ROUND(DATEDIFF(MINUTE, LoginTime, @logoutTime) / 60.0, 2) OUTPUT INSERTED.* WHERE AttendanceID = @id`;
        } else {
            updateQuery = `UPDATE Attendance SET LogoutTime = GETDATE(), TotalHours = ROUND(DATEDIFF(MINUTE, LoginTime, GETDATE()) / 60.0, 2) OUTPUT INSERTED.* WHERE AttendanceID = @id`;
        }
        const update = await updReq.query(updateQuery);
        res.json({ success: true, action: 'logout', loginType: 'Remote', record: update.recordset[0] });
    } catch (error) {
        console.error('Attendance remote-toggle:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/attendance/upload', authMiddleware, requireAdmin, requireDb, (req, res) => {
    attendanceUpload.single('file')(req, res, async (uploadErr) => {
        if (uploadErr) {
            return res.status(400).json({ error: uploadErr.message });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        try {
            const rows = parseAttendanceFile(req.file.buffer, req.file.originalname);
            const filterEmployeeId = req.body.employeeId
                ? parseInt(req.body.employeeId, 10)
                : null;

            if (filterEmployeeId && isNaN(filterEmployeeId)) {
                return res.status(400).json({ error: 'Invalid employeeId' });
            }

            let inserted = 0;
            let skippedWrongEmployee = 0;
            const errors = [];

            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];

                if (filterEmployeeId && row.employeeId !== filterEmployeeId) {
                    skippedWrongEmployee++;
                    continue;
                }

                try {
                    const emp = await pool.request()
                        .input('id', sql.Int, row.employeeId)
                        .query(`SELECT EmployeeID, Role FROM Employees WHERE EmployeeID = @id`);

                    if (!emp.recordset[0]) {
                        errors.push(`Row ${i + 2}: EmployeeID ${row.employeeId} not found`);
                        continue;
                    }
                    if (emp.recordset[0].Role === 'Admin') {
                        errors.push(`Row ${i + 2}: cannot import attendance for Admin accounts`);
                        continue;
                    }

                    const createdAt = row.createdAt || new Date();
                    const dateOnly = new Date(row.date);
                    dateOnly.setHours(0, 0, 0, 0);

                    const existing = await pool.request()
                        .input('employeeId', sql.Int, row.employeeId)
                        .input('date', sql.Date, dateOnly)
                        .query(`
                            SELECT TOP 1 AttendanceID FROM Attendance
                            WHERE EmployeeID = @employeeId AND Date = @date
                        `);

                    if (existing.recordset[0]) {
                        await pool.request()
                            .input('id', sql.Int, existing.recordset[0].AttendanceID)
                            .input('login', sql.DateTime, row.loginTime)
                            .input('logout', sql.DateTime, row.logoutTime)
                            .input('hours', sql.Decimal(5, 2), row.totalHours)
                            .query(`
                                UPDATE Attendance SET
                                    LoginTime = @login,
                                    LogoutTime = @logout,
                                    TotalHours = @hours
                                WHERE AttendanceID = @id
                            `);
                    } else {
                        await pool.request()
                            .input('employeeId', sql.Int, row.employeeId)
                            .input('date', sql.Date, dateOnly)
                            .input('login', sql.DateTime, row.loginTime)
                            .input('logout', sql.DateTime, row.logoutTime)
                            .input('hours', sql.Decimal(5, 2), row.totalHours)
                            .input('createdAt', sql.DateTime, createdAt)
                            .query(`
                                INSERT INTO Attendance (EmployeeID, Date, LoginTime, LogoutTime, TotalHours, CreatedAt)
                                VALUES (@employeeId, @date, @login, @logout, @hours, @createdAt)
                            `);
                    }
                    inserted++;
                } catch (rowErr) {
                    errors.push(`Row ${i + 2}: ${rowErr.message}`);
                }
            }

            let message = `Imported ${inserted} attendance record(s) for employee #${filterEmployeeId || 'all'}.`;
            if (skippedWrongEmployee > 0) {
                message += ` ${skippedWrongEmployee} row(s) skipped (different EmployeeID).`;
            }
            if (errors.length) {
                message += ` ${errors.length} row(s) had errors.`;
            }

            res.json({
                success: true,
                message,
                inserted,
                total: rows.length,
                employeeId: filterEmployeeId,
                skippedWrongEmployee,
                errors: errors.slice(0, 20)
            });
        } catch (error) {
            console.error('Attendance upload:', error);
            res.status(400).json({ error: error.message || 'Invalid file' });
        }
    });
});

// ===== Employees =====
// Must be before /:id so Express doesn't treat "directory" as an id param
app.get('/api/employees/directory', authMiddleware, requireDb, async (req, res) => {
    try {
        const result = await pool.request().query(`
            SELECT e.EmployeeID, e.Name, e.Role
            FROM Employees e
            WHERE ISNULL(e.IsActive, 1) = 1
            ORDER BY e.Name
        `);
        res.json({ success: true, employees: result.recordset });
    } catch (error) {
        console.error('Employee directory:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/employees/:id', authMiddleware, requireDb, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (id !== req.user.employeeId && !isAdminRole(req.user.role)) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const result = await pool.request()
            .input('id', sql.Int, id)
            .query(`SELECT ${EMPLOYEE_SELECT} ${EMPLOYEE_FROM} WHERE e.EmployeeID = @id`);

        if (!result.recordset[0]) {
            return res.status(404).json({ error: 'Employee not found' });
        }

        res.json({ success: true, employee: mapEmployee(result.recordset[0]) });
    } catch (error) {
        console.error('Get employee:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.put('/api/employees/:id', authMiddleware, requireDb, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (id !== req.user.employeeId) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const { name, contact, profileImageUrl } = req.body;
        const result = await pool.request()
            .input('id', sql.Int, id)
            .input('name', sql.NVarChar, name)
            .input('contact', sql.NVarChar, contact || '')
            .input('profileImageUrl', sql.NVarChar, profileImageUrl || null)
            .query(`
                UPDATE Employees SET
                    Name = @name,
                    Contact = @contact,
                    ProfileImageUrl = @profileImageUrl,
                    UpdatedAt = GETDATE()
                OUTPUT INSERTED.EmployeeID, INSERTED.Name, INSERTED.Email,
                    INSERTED.Role, INSERTED.Contact, INSERTED.ProfileImageUrl
                WHERE EmployeeID = @id
            `);

        const emp = result.recordset[0];
        const userRow = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT Username FROM Usernames WHERE EmployeeID = @id');
        if (userRow.recordset[0]) {
            emp.Username = userRow.recordset[0].Username;
        }

        res.json({ success: true, employee: mapEmployee(emp) });
    } catch (error) {
        console.error('Update employee:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/employees/:id/change-password', authMiddleware, requireDb, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (id !== req.user.employeeId) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const { currentPassword, newPassword } = req.body;
        const row = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT PasswordHash FROM Employees WHERE EmployeeID = @id');

        if (!row.recordset[0]) {
            return res.status(404).json({ error: 'Employee not found' });
        }

        const valid = await bcrypt.compare(currentPassword, row.recordset[0].PasswordHash);
        if (!valid) {
            return res.status(400).json({ error: 'Current password is incorrect' });
        }

        const hash = await bcrypt.hash(newPassword, 10);
        await pool.request()
            .input('id', sql.Int, id)
            .input('hash', sql.NVarChar, hash)
            .query('UPDATE Employees SET PasswordHash = @hash, UpdatedAt = GETDATE() WHERE EmployeeID = @id');

        res.json({ success: true, message: 'Password updated' });
    } catch (error) {
        console.error('Change password:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===== Employees (Admin / Manager) =====
app.get('/api/employees', authMiddleware, requireManagerOrAdmin, requireDb, async (req, res) => {
    try {
        const result = await pool.request().query(`
            SELECT ${EMPLOYEE_SELECT}
            ${EMPLOYEE_FROM}
            ORDER BY e.Name
        `);
        res.json({ success: true, employees: result.recordset.map(mapEmployee) });
    } catch (error) {
        console.error('List employees:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===== Teams (signup) =====
app.get('/api/teams', requireDb, async (req, res) => {
    try {
        const result = await pool.request().query('SELECT TeamID, TeamName FROM Teams ORDER BY TeamName');
        res.json({ success: true, teams: result.recordset });
    } catch (error) {
        console.error('List teams:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===== Admin: Teams CRUD =====
app.post('/api/admin/teams', authMiddleware, requireAdmin, requireDb, async (req, res) => {
    try {
        const name = (req.body.name || '').trim();
        if (!name) return res.status(400).json({ error: 'Team name is required' });
        const exists = await pool.request().input('n', sql.NVarChar, name)
            .query('SELECT TeamID FROM Teams WHERE TeamName = @n');
        if (exists.recordset.length) return res.status(400).json({ error: 'Team already exists' });
        const ins = await pool.request().input('n', sql.NVarChar, name)
            .query('INSERT INTO Teams (TeamName) OUTPUT INSERTED.TeamID, INSERTED.TeamName VALUES (@n)');
        res.status(201).json({ success: true, team: ins.recordset[0] });
    } catch (e) { console.error('Create team:', e); res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/admin/teams/:id', authMiddleware, requireAdmin, requireDb, async (req, res) => {
    try {
        const id   = parseInt(req.params.id, 10);
        const name = (req.body.name || '').trim();
        if (!name) return res.status(400).json({ error: 'Team name is required' });
        await pool.request().input('id', sql.Int, id).input('n', sql.NVarChar, name)
            .query('UPDATE Teams SET TeamName = @n WHERE TeamID = @id');
        res.json({ success: true });
    } catch (e) { console.error('Update team:', e); res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/admin/teams/:id', authMiddleware, requireAdmin, requireDb, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const inUse = await pool.request().input('id', sql.Int, id)
            .query('SELECT COUNT(*) AS c FROM Employees WHERE TeamID = @id');
        if (inUse.recordset[0].c > 0)
            return res.status(400).json({ error: `${inUse.recordset[0].c} employee(s) use this team. Reassign them first.` });
        await pool.request().input('id', sql.Int, id).query('DELETE FROM Teams WHERE TeamID = @id');
        res.json({ success: true });
    } catch (e) { console.error('Delete team:', e); res.status(500).json({ error: 'Server error' }); }
});

// ===== Clients (authenticated dropdown) =====
app.get('/api/clients', authMiddleware, requireDb, async (req, res) => {
    try {
        const result = await pool.request().query('SELECT cliClientID, cliClientName FROM Clients ORDER BY cliClientName');
        res.json({ success: true, clients: result.recordset });
    } catch (e) { console.error('List clients:', e); res.status(500).json({ error: 'Server error' }); }
});

// ===== Admin: Clients CRUD =====
app.post('/api/admin/clients', authMiddleware, requireAdmin, requireDb, async (req, res) => {
    try {
        const name = (req.body.name || '').trim();
        if (!name) return res.status(400).json({ error: 'Client name is required' });
        const exists = await pool.request().input('n', sql.NVarChar, name)
            .query('SELECT cliClientID FROM Clients WHERE cliClientName = @n');
        if (exists.recordset.length) return res.status(400).json({ error: 'Client already exists' });
        const ins = await pool.request().input('n', sql.NVarChar, name)
            .query('INSERT INTO Clients (cliClientName) OUTPUT INSERTED.cliClientID, INSERTED.cliClientName VALUES (@n)');
        res.status(201).json({ success: true, client: ins.recordset[0] });
    } catch (e) { console.error('Create client:', e); res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/admin/clients/:id', authMiddleware, requireAdmin, requireDb, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const name = (req.body.name || '').trim();
        if (!name) return res.status(400).json({ error: 'Client name is required' });
        await pool.request().input('id', sql.Int, id).input('n', sql.NVarChar, name)
            .query('UPDATE Clients SET cliClientName = @n WHERE cliClientID = @id');
        res.json({ success: true });
    } catch (e) { console.error('Update client:', e); res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/admin/clients/:id', authMiddleware, requireAdmin, requireDb, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const inUse = await pool.request().input('id', sql.Int, id)
            .query('SELECT COUNT(*) AS c FROM Employees WHERE ClientID = @id');
        if (inUse.recordset[0].c > 0)
            return res.status(400).json({ error: `${inUse.recordset[0].c} employee(s) are assigned to this client. Reassign them first.` });
        await pool.request().input('id', sql.Int, id).query('DELETE FROM Clients WHERE cliClientID = @id');
        res.json({ success: true });
    } catch (e) { console.error('Delete client:', e); res.status(500).json({ error: 'Server error' }); }
});

// ===== Admin employee overview =====
app.get('/api/admin/employees', authMiddleware, requireAdmin, requireDb, async (req, res) => {
    try {
        const result = await pool.request().query(`
            SELECT ${EMPLOYEE_SELECT}
            ${EMPLOYEE_FROM}
            WHERE e.Role <> 'Admin' AND ISNULL(e.IsActive, 1) = 1
            ORDER BY e.EmployeeID
        `);
        res.json({ success: true, employees: result.recordset.map(mapEmployee) });
    } catch (error) {
        console.error('Admin list employees:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===== Employee directory export (XLSX) — all or single =====
app.get('/api/admin/employees/export', authMiddleware, requireAdmin, requireDb, async (req, res) => {
    try {
        const singleId = parseInt(req.query.employeeId, 10);
        const isSingle = !isNaN(singleId) && singleId > 0;

        const req2 = pool.request();
        let whereClause = `WHERE e.Role <> 'Admin' AND ISNULL(e.IsActive,1) = 1`;
        if (isSingle) { req2.input('empId', sql.Int, singleId); whereClause = `WHERE e.EmployeeID = @empId`; }

        const result = await req2.query(`
            SELECT e.EmployeeID, e.Name, e.Email, e.Role, e.Designation, e.Contact,
                   e.FatherName, e.Qualification, e.Certifications,
                   e.AppointedOn, t.TeamName, c.cliClientName AS ClientName,
                   CASE WHEN ISNULL(e.IsActive,1)=1 THEN 'Active' ELSE 'Inactive' END AS Status
            FROM Employees e
            LEFT JOIN Teams t ON t.TeamID = e.TeamID
            LEFT JOIN Clients c ON c.cliClientID = e.ClientID
            ${whereClause}
            ORDER BY e.Name
        `);

        const rows = result.recordset.map((e, i) => ({
            '#':               i + 1,
            'Name':            e.Name || '',
            'Employee ID':     e.EmployeeID,
            'Email':           e.Email || '',
            'Role':            e.Role || '',
            'Designation':     e.Designation || '',
            'Contact':         e.Contact || '',
            "Father's Name":   e.FatherName || '',
            'Qualification':   e.Qualification || '',
            'Certifications':  e.Certifications || '',
            'Team':            e.TeamName || '',
            'Client':          e.ClientName || '',
            'Appointed On':    e.AppointedOn ? new Date(e.AppointedOn).toLocaleDateString('en-GB') : '',
            'Status':          e.Status,
        }));

        const ws = XLSX.utils.json_to_sheet(rows);
        ws['!cols'] = [
            {wch:4},{wch:22},{wch:10},{wch:28},{wch:14},{wch:18},{wch:14},
            {wch:16},{wch:16},{wch:20},{wch:20},{wch:18},{wch:16},{wch:14},
        ];

        const headerAoa = [
            ['Global Vision Portal — Employee Directory'],
            [`Exported: ${new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}   |   Total: ${rows.length} employees`],
            [],
        ];
        const dataAoa = [
            Object.keys(rows[0] || {}),
            ...rows.map(r => Object.values(r)),
        ];
        const fullAoa = [...headerAoa, ...dataAoa];
        const finalWs = XLSX.utils.aoa_to_sheet(fullAoa);
        finalWs['!cols'] = ws['!cols'];
        finalWs['!merges'] = [{ s:{r:0,c:0}, e:{r:0,c:13} }];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, finalWs, 'Employees');
        const buf = XLSX.write(wb, { type:'buffer', bookType:'xlsx' });
        const empName = isSingle && result.recordset[0] ? result.recordset[0].Name.replace(/\s+/g,'_') : null;
        const filename = empName
            ? `employee_${empName}_${new Date().toISOString().split('T')[0]}.xlsx`
            : `employees_all_${new Date().toISOString().split('T')[0]}.xlsx`;

        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
        res.send(buf);
    } catch (error) {
        console.error('Employee export:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/admin/employees/:id(\\d+)', authMiddleware, requireAdmin, requireDb, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const empResult = await pool.request()
            .input('id', sql.Int, id)
            .query(`SELECT ${EMPLOYEE_SELECT} ${EMPLOYEE_FROM} WHERE e.EmployeeID = @id AND e.Role <> 'Admin'`);

        if (!empResult.recordset[0]) {
            return res.status(404).json({ error: 'Employee not found' });
        }

        const attendance = await pool.request()
            .input('id', sql.Int, id)
            .query(`
                SELECT TOP 50 AttendanceID, EmployeeID, Date, LoginTime, LogoutTime, TotalHours, CreatedAt
                FROM Attendance WHERE EmployeeID = @id
                ORDER BY Date DESC, LoginTime DESC
            `);

        const tasks = await pool.request()
            .input('id', sql.Int, id)
            .query(`
                SELECT TOP 15 t.*, ab.Name AS AssignedByName
                FROM Tasks t
                LEFT JOIN Employees ab ON ab.EmployeeID = t.AssignedBy
                WHERE t.AssignedTo = @id
                ORDER BY t.CreatedAt DESC
            `);

        const inventory = await pool.request()
            .input('id', sql.Int, id)
            .query(`
                SELECT i.ItemID, i.ItemName, i.Status, i.IssueDate, i.ReturnDate, i.DeskNo
                FROM Inventory i
                WHERE i.IssuedTo = @id
                ORDER BY i.IssueDate DESC
            `);

        res.json({
            success: true,
            employee: mapEmployee(empResult.recordset[0]),
            attendance: attendance.recordset,
            tasks: tasks.recordset.map(mapTask),
            inventory: inventory.recordset.map(mapInventory)
        });
    } catch (error) {
        console.error('Admin employee detail:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===== Tasks =====
app.get('/api/tasks', authMiddleware, requireDb, async (req, res) => {
    try {
        const { assignedTo, assignedBy, status, all } = req.query;
        const isStaff = isAdminRole(req.user.role) || req.user.role === 'Manager';
        const showAll = isStaff && (all === 'true' || all === '1');
        const myId    = req.user.employeeId;

        let query = `
            SELECT t.*, e.Name AS AssignedToName, ab.Name AS AssignedByName,
                   ab.Role AS AssignedByRole,
                   tm.TeamName, c.cliClientName AS ClientName
            FROM Tasks t
            LEFT JOIN Employees e  ON t.AssignedTo = e.EmployeeID
            LEFT JOIN Employees ab ON t.AssignedBy = ab.EmployeeID
            LEFT JOIN Teams tm     ON tm.TeamID = t.TeamID
            LEFT JOIN Clients c    ON c.cliClientID = t.ClientID
            WHERE 1=1
        `;
        const request = pool.request();

        if (assignedBy) {
            // "tasks I assigned" — only allow own ID unless staff
            const byId = parseInt(assignedBy, 10);
            if (byId === myId || isStaff) {
                query += ' AND t.AssignedBy = @assignedBy';
                request.input('assignedBy', sql.Int, byId);
                // exclude tasks assigned to self so list = "assigned to others"
                if (!isStaff) {
                    query += ' AND t.AssignedTo <> @selfId';
                    request.input('selfId', sql.Int, myId);
                }
            }
        } else if (!showAll) {
            const targetId = assignedTo ? parseInt(assignedTo, 10) : myId;
            query += ' AND t.AssignedTo = @assignedTo';
            request.input('assignedTo', sql.Int, targetId);
        } else if (assignedTo) {
            query += ' AND t.AssignedTo = @assignedTo';
            request.input('assignedTo', sql.Int, parseInt(assignedTo, 10));
        }

        if (status) {
            query += ' AND t.Status = @status';
            request.input('status', sql.NVarChar, status);
        }

        query += ' ORDER BY t.Deadline ASC';
        const result = await request.query(query);
        res.json({ success: true, tasks: result.recordset.map(mapTask) });
    } catch (error) {
        console.error('Get tasks:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Any authenticated employee can assign a task to another employee
app.post('/api/tasks', authMiddleware, requireDb, async (req, res) => {
    try {
        const { title, description, assignedTo, priority, deadline, status,
                teamId, clientId, project, notes, startTime, endTime } = req.body;
        if (!title || !assignedTo) {
            return res.status(400).json({ error: 'Title and assigned employee are required' });
        }

        const teamIdVal   = teamId   ? parseInt(teamId, 10)   : null;
        const clientIdVal = clientId ? parseInt(clientId, 10) : null;
        const startVal    = startTime ? new Date(`1970-01-01T${startTime}:00`) : null;
        const endVal      = endTime   ? new Date(`1970-01-01T${endTime}:00`)   : null;

        const insert = await pool.request()
            .input('title',       sql.NVarChar,       title)
            .input('description', sql.NVarChar,       description || '')
            .input('project',     sql.NVarChar(100),  project || null)
            .input('notes',       sql.NVarChar(sql.MAX), notes || null)
            .input('assignedTo',  sql.Int,            parseInt(assignedTo, 10))
            .input('assignedBy',  sql.Int,            req.user.employeeId)
            .input('status',      sql.NVarChar,       status || 'To Be Started')
            .input('priority',    sql.NVarChar,       priority || 'Medium')
            .input('deadline',    sql.DateTime,       deadline ? new Date(deadline) : new Date(Date.now() + 7 * 86400000))
            .input('teamId',      sql.Int,            teamIdVal)
            .input('clientId',    sql.Int,            clientIdVal)
            .input('startTime',   sql.DateTime2,      startVal)
            .input('endTime',     sql.DateTime2,      endVal)
            .query(`
                INSERT INTO Tasks (Title, Description, Project, Notes, AssignedTo, AssignedBy, Status, Priority, Deadline, TeamID, ClientID, StartTime, EndTime)
                OUTPUT INSERTED.*
                VALUES (@title, @description, @project, @notes, @assignedTo, @assignedBy, @status, @priority, @deadline, @teamId, @clientId, @startTime, @endTime)
            `);

        const task = mapTask(insert.recordset[0]);

        const nameRow = await pool.request()
            .input('id', sql.Int, task.AssignedTo)
            .query('SELECT Name FROM Employees WHERE EmployeeID = @id');
        task.AssignedToName = nameRow.recordset[0]?.Name || null;

        const assignerRow = await pool.request()
            .input('id', sql.Int, req.user.employeeId)
            .query('SELECT Name FROM Employees WHERE EmployeeID = @id');
        task.AssignedByName = assignerRow.recordset[0]?.Name || null;

        if (teamIdVal) {
            const teamRow = await pool.request()
                .input('id', sql.Int, teamIdVal)
                .query('SELECT TeamName FROM Teams WHERE TeamID = @id');
            task.TeamName = teamRow.recordset[0]?.TeamName || null;
        }
        if (clientIdVal) {
            const clientRow = await pool.request()
                .input('id', sql.Int, clientIdVal)
                .query('SELECT cliClientName FROM Clients WHERE cliClientID = @id');
            task.ClientName = clientRow.recordset[0]?.cliClientName || null;
        }

        // Auto-create a DailyTaskLog entry for today so the task appears in the assignee's Activity Tracker
        try {
            const activityText = description
                ? `${title}: ${description}`.substring(0, 500)
                : title.substring(0, 500);
            await pool.request()
                .input('empId',    sql.Int,              parseInt(assignedTo, 10))
                .input('activity', sql.NVarChar(500),     activityText)
                .input('project',  sql.NVarChar(50),      title.substring(0, 50))
                .input('notes',    sql.NVarChar(sql.MAX), `Assigned by ${task.AssignedByName || 'a colleague'} · TaskID #${task.TaskID}`)
                .input('taskId',   sql.Int,               task.TaskID)
                .query(`
                    INSERT INTO DailyTaskLogs (EmployeeID, LogDate, Activity, Project, Notes, Status, TaskID)
                    VALUES (@empId, CAST(GETDATE() AS DATE), @activity, @project, @notes, 'Pending', @taskId)
                `);
        } catch (logErr) {
            console.warn('Could not auto-create DailyTaskLog for assigned task:', logErr.message);
        }

        res.status(201).json({ success: true, task });
    } catch (error) {
        console.error('Create task:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.put('/api/tasks/:id', authMiddleware, requireDb, async (req, res) => {
    try {
        const taskId = parseInt(req.params.id, 10);
        const { Status } = req.body;

        const check = await pool.request()
            .input('id', sql.Int, taskId)
            .query(`SELECT t.AssignedTo, t.AssignedBy, t.Title, e.Name AS AssigneeName
                    FROM Tasks t
                    LEFT JOIN Employees e ON e.EmployeeID = t.AssignedTo
                    WHERE t.TaskID = @id`);

        if (!check.recordset[0]) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const taskRow = check.recordset[0];
        if (taskRow.AssignedTo !== req.user.employeeId && !isAdminRole(req.user.role) && req.user.role !== 'Manager') {
            return res.status(403).json({ error: 'Forbidden' });
        }

        if (!Status) return res.status(400).json({ error: 'Status is required' });

        const isCompleted = Status === 'Completed';
        await pool.request()
            .input('id',          sql.Int,      taskId)
            .input('status',      sql.NVarChar, Status)
            .input('completedAt', sql.DateTime, isCompleted ? new Date() : null)
            .query(`
                UPDATE Tasks
                SET Status = @status, UpdatedAt = GETDATE(), CompletedDate = @completedAt
                WHERE TaskID = @id
            `);

        // Sync status to DailyTaskLogs linked to this task
        try {
            await pool.request()
                .input('taskId', sql.Int,      taskId)
                .input('status', sql.NVarChar, Status)
                .query(`
                    UPDATE DailyTaskLogs
                    SET Status = @status, UpdatedAt = GETDATE()
                    WHERE TaskID = @taskId
                `);
        } catch (syncErr) {
            console.warn('Could not sync status to DailyTaskLogs:', syncErr.message);
        }

        // Notify the task assigner about the status change
        if (taskRow.AssignedBy && taskRow.AssignedBy !== req.user.employeeId) {
            try {
                await notifyTaskStatusChange(pool, sql, {
                    taskId,
                    taskTitle:           taskRow.Title,
                    newStatus:           Status,
                    assignedByEmployeeId: taskRow.AssignedBy,
                    assigneeEmployeeName: taskRow.AssigneeName || 'Employee',
                });
            } catch (notifErr) {
                console.warn('Could not send task status notification:', notifErr.message);
            }
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Update task:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/tasks/:id', authMiddleware, requireManagerOrAdmin, requireDb, async (req, res) => {
    try {
        const taskId = parseInt(req.params.id, 10);
        if (isNaN(taskId)) return res.status(400).json({ error: 'Invalid task id' });

        const existing = await pool.request()
            .input('id', sql.Int, taskId)
            .query('SELECT TaskID, Title FROM Tasks WHERE TaskID = @id');

        if (!existing.recordset[0]) return res.status(404).json({ error: 'Task not found' });

        await pool.request()
            .input('id', sql.Int, taskId)
            .query('DELETE FROM Tasks WHERE TaskID = @id');

        res.json({ success: true, message: `Deleted "${existing.recordset[0].Title}"` });
    } catch (error) {
        console.error('Delete task:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===== Inventory =====
app.get('/api/inventory', authMiddleware, requireDb, async (req, res) => {
    try {
        const { issuedTo, all } = req.query;
        const isAdmin = isAdminRole(req.user.role);
        let query = `
            SELECT i.*, e.Name AS IssuedToName, e.Email AS IssuedToEmail, u.Username AS IssuedToUsername
            FROM Inventory i
            LEFT JOIN Employees e ON i.IssuedTo = e.EmployeeID
            LEFT JOIN Usernames u ON u.EmployeeID = e.EmployeeID
        `;
        const request = pool.request();

        if (isAdmin && (all === 'true' || all === '1')) {
            // Admin: full list
        } else if (isAdmin && issuedTo) {
            query += ' WHERE i.IssuedTo = @issuedTo';
            request.input('issuedTo', sql.Int, parseInt(issuedTo, 10));
        } else if (isAdmin) {
            // Admin default: all items
        } else {
            // Employee: only items issued to them
            query += ' WHERE i.IssuedTo = @employeeId';
            request.input('employeeId', sql.Int, req.user.employeeId);
        }

        query += ' ORDER BY i.ItemName';
        const result = await request.query(query);
        res.json({ success: true, items: result.recordset.map(mapInventory) });
    } catch (error) {
        console.error('Get inventory:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/inventory', authMiddleware, requireAdmin, requireDb, async (req, res) => {
    try {
        const { itemName, quantity, availableQuantity, status } = req.body;
        if (!itemName || quantity === undefined) {
            return res.status(400).json({ error: 'ItemName and Quantity are required' });
        }

        const qty = parseInt(quantity, 10);
        const avail = availableQuantity !== undefined ? parseInt(availableQuantity, 10) : qty;
        if (isNaN(qty) || qty < 0 || isNaN(avail) || avail < 0) {
            return res.status(400).json({ error: 'Invalid quantity values' });
        }

        const insert = await pool.request()
            .input('name', sql.NVarChar, itemName)
            .input('qty', sql.Int, qty)
            .input('avail', sql.Int, avail)
            .input('status', sql.NVarChar, status || 'Available')
            .query(`
                INSERT INTO Inventory (ItemName, Quantity, AvailableQuantity, Status)
                OUTPUT INSERTED.*
                VALUES (@name, @qty, @avail, @status)
            `);

        res.status(201).json({ success: true, item: mapInventory(insert.recordset[0]) });
    } catch (error) {
        console.error('Create inventory:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.put('/api/inventory/:id', authMiddleware, requireAdmin, requireDb, async (req, res) => {
    try {
        const itemId = parseInt(req.params.id, 10);
        const { itemName, quantity, availableQuantity, status } = req.body;

        const existing = await pool.request()
            .input('id', sql.Int, itemId)
            .query('SELECT * FROM Inventory WHERE ItemID = @id');

        if (!existing.recordset[0]) {
            return res.status(404).json({ error: 'Item not found' });
        }

        const row = existing.recordset[0];
        const name = itemName ?? row.ItemName;
        const qty = quantity !== undefined ? parseInt(quantity, 10) : row.Quantity;
        const avail = availableQuantity !== undefined ? parseInt(availableQuantity, 10) : row.AvailableQuantity;
        const stat = status ?? row.Status;

        const update = await pool.request()
            .input('id', sql.Int, itemId)
            .input('name', sql.NVarChar, name)
            .input('qty', sql.Int, qty)
            .input('avail', sql.Int, avail)
            .input('status', sql.NVarChar, stat)
            .query(`
                UPDATE Inventory SET
                    ItemName = @name,
                    Quantity = @qty,
                    AvailableQuantity = @avail,
                    Status = @status,
                    UpdatedAt = GETDATE()
                OUTPUT INSERTED.*
                WHERE ItemID = @id
            `);

        res.json({ success: true, item: mapInventory(update.recordset[0]) });
    } catch (error) {
        console.error('Update inventory:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/inventory/:id', authMiddleware, requireAdmin, requireDb, deleteInventoryHandler);
app.post('/api/inventory/:id/delete', authMiddleware, requireAdmin, requireDb, deleteInventoryHandler);

async function deleteInventoryHandler(req, res) {
    try {
        const itemId = parseInt(req.params.id, 10);
        if (isNaN(itemId)) {
            return res.status(400).json({ error: 'Invalid item id' });
        }

        const existing = await pool.request()
            .input('id', sql.Int, itemId)
            .query('SELECT ItemID, ItemName FROM Inventory WHERE ItemID = @id');

        if (!existing.recordset[0]) {
            return res.status(404).json({ error: 'Item not found' });
        }

        await pool.request()
            .input('id', sql.Int, itemId)
            .query('DELETE FROM Notifications WHERE ItemID = @id');

        await pool.request()
            .input('id', sql.Int, itemId)
            .query('DELETE FROM Inventory WHERE ItemID = @id');

        res.json({
            success: true,
            message: `Deleted "${existing.recordset[0].ItemName}"`
        });
    } catch (error) {
        console.error('Delete inventory:', error);
        res.status(500).json({ error: error.message || 'Could not delete item' });
    }
}

app.post('/api/inventory/:id/approve-request', authMiddleware, requireAdmin, requireDb, async (req, res) => {
    try {
        const itemId = parseInt(req.params.id, 10);
        const update = await pool.request()
            .input('id', sql.Int, itemId)
            .query(`
                UPDATE Inventory SET
                    Status = 'Issued',
                    IssueDate = GETDATE(),
                    Quantity = 1,
                    AvailableQuantity = 0,
                    UpdatedAt = GETDATE()
                OUTPUT INSERTED.*
                WHERE ItemID = @id AND Status = 'Requested' AND IssuedTo IS NOT NULL
            `);

        if (!update.recordset[0]) {
            return res.status(400).json({ error: 'Request not found or already processed' });
        }

        const row = update.recordset[0];
        const nameRow = await pool.request()
            .input('id', sql.Int, row.IssuedTo)
            .query('SELECT Name FROM Employees WHERE EmployeeID = @id');

        const item = mapInventory(row);
        item.IssuedToName = nameRow.recordset[0]?.Name || null;

        res.json({ success: true, item, message: 'Request approved and issued to employee' });
    } catch (error) {
        console.error('Approve inventory request:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/inventory/:id/issue', authMiddleware, requireAdmin, requireDb, async (req, res) => {
    try {
        const itemId = parseInt(req.params.id, 10);
        const employeeId = parseInt(req.body.employeeId, 10);

        if (!employeeId) {
            return res.status(400).json({ error: 'employeeId is required' });
        }

        const emp = await pool.request()
            .input('id', sql.Int, employeeId)
            .query('SELECT EmployeeID FROM Employees WHERE EmployeeID = @id');

        if (!emp.recordset[0]) {
            return res.status(404).json({ error: 'Employee not found' });
        }

        const update = await pool.request()
            .input('id', sql.Int, itemId)
            .input('employeeId', sql.Int, employeeId)
            .query(`
                UPDATE Inventory SET
                    IssuedTo = @employeeId,
                    IssueDate = GETDATE(),
                    ReturnDate = NULL,
                    Status = 'Issued',
                    AvailableQuantity = CASE WHEN AvailableQuantity > 0 THEN AvailableQuantity - 1 ELSE 0 END,
                    UpdatedAt = GETDATE()
                OUTPUT INSERTED.*
                WHERE ItemID = @id AND (Status = 'Available' OR Status = 'Issued')
                  AND AvailableQuantity > 0
            `);

        if (!update.recordset[0]) {
            return res.status(400).json({ error: 'Item not available to issue' });
        }

        const item = mapInventory(update.recordset[0]);
        const nameRow = await pool.request()
            .input('id', sql.Int, employeeId)
            .query('SELECT Name FROM Employees WHERE EmployeeID = @id');
        item.IssuedToName = nameRow.recordset[0]?.Name || null;

        res.json({ success: true, item });
    } catch (error) {
        console.error('Admin issue inventory:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/inventory/upload-csv', authMiddleware, requireAdmin, requireDb, (req, res) => {
    inventoryUpload.single('file')(req, res, async (uploadErr) => {
        if (uploadErr) {
            return res.status(400).json({ error: uploadErr.message });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'CSV or Excel file is required (field name: file)' });
        }

        try {
            const rows = parseInventoryFile(req.file.buffer, req.file.originalname);
            let inserted = 0;
            let updated = 0;

            for (const row of rows) {
                const existing = await pool.request()
                    .input('name', sql.NVarChar, row.itemName)
                    .query('SELECT ItemID FROM Inventory WHERE ItemName = @name');

                if (existing.recordset[0]) {
                    await pool.request()
                        .input('id', sql.Int, existing.recordset[0].ItemID)
                        .input('qty', sql.Int, row.quantity)
                        .input('avail', sql.Int, row.availableQuantity)
                        .input('status', sql.NVarChar, row.status)
                        .query(`
                            UPDATE Inventory SET
                                Quantity = @qty,
                                AvailableQuantity = @avail,
                                Status = @status,
                                UpdatedAt = GETDATE()
                            WHERE ItemID = @id
                        `);
                    updated++;
                } else {
                    await pool.request()
                        .input('name', sql.NVarChar, row.itemName)
                        .input('qty', sql.Int, row.quantity)
                        .input('avail', sql.Int, row.availableQuantity)
                        .input('status', sql.NVarChar, row.status)
                        .query(`
                            INSERT INTO Inventory (ItemName, Quantity, AvailableQuantity, Status)
                            VALUES (@name, @qty, @avail, @status)
                        `);
                    inserted++;
                }
            }

            res.json({
                success: true,
                message: `Imported ${rows.length} row(s): ${inserted} added, ${updated} updated`,
                inserted,
                updated,
                total: rows.length
            });
        } catch (error) {
            console.error('CSV upload:', error);
            res.status(400).json({ error: error.message || 'Invalid CSV file' });
        }
    });
});

app.post('/api/inventory/request-new', authMiddleware, requireDb, async (req, res) => {
    try {
        if (isAdminRole(req.user.role)) {
            return res.status(403).json({ error: 'Admins cannot submit inventory requests' });
        }

        const itemName = (req.body.itemName || '').trim();
        const requestedQty = Math.max(1, parseInt(req.body.quantity, 10) || 1);
        const notes = (req.body.notes || '').trim();
        if (!itemName) {
            return res.status(400).json({ error: 'Item name is required' });
        }

        const employeeId = req.user.employeeId;
        const empRow = await pool.request()
            .input('id', sql.Int, employeeId)
            .query('SELECT Name FROM Employees WHERE EmployeeID = @id');
        const employeeName = empRow.recordset[0]?.Name || 'Employee';

        const insert = await pool.request()
            .input('name', sql.NVarChar, itemName)
            .input('qty', sql.Int, requestedQty)
            .input('employeeId', sql.Int, employeeId)
            .input('notes', sql.NVarChar, notes || null)
            .query(`
                INSERT INTO Inventory (ItemName, Quantity, AvailableQuantity, Status, IssuedTo)
                OUTPUT INSERTED.*
                VALUES (@name, @qty, 0, 'Requested', @employeeId)
            `);

        let item = insert.recordset[0];
        if (!item) {
            return res.status(500).json({ error: 'Could not create inventory request' });
        }

        if (notes) {
            try {
                await pool.request()
                    .input('id', sql.Int, item.ItemID)
                    .input('notes', sql.NVarChar, notes)
                    .query('UPDATE Inventory SET RequestNotes = @notes WHERE ItemID = @id');
                item.RequestNotes = notes;
            } catch (noteErr) {
                console.warn('RequestNotes update skipped:', noteErr.message);
            }
        }

        await notifyNewInventoryRequest(pool, sql, {
            itemId: item.ItemID,
            itemName,
            quantity: requestedQty,
            notes,
            employeeId,
            employeeName
        });

        res.json({
            success: true,
            message: 'Your inventory request has been sent to admin',
            item: mapInventory(item)
        });
    } catch (error) {
        console.error('New inventory request:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/inventory/:id/request', authMiddleware, requireDb, async (req, res) => {
    try {
        const itemId = parseInt(req.params.id, 10);
        const employeeId = req.body.employeeId || req.user.employeeId;

        const item = await pool.request()
            .input('id', sql.Int, itemId)
            .query('SELECT * FROM Inventory WHERE ItemID = @id');

        const row = item.recordset[0];
        if (!row) return res.status(404).json({ error: 'Item not found' });
        if (row.AvailableQuantity <= 0 || row.Status !== 'Available') {
            return res.status(400).json({ error: 'Item not available' });
        }

        const update = await pool.request()
            .input('id', sql.Int, itemId)
            .input('employeeId', sql.Int, employeeId)
            .query(`
                UPDATE Inventory SET
                    IssuedTo = @employeeId,
                    IssueDate = GETDATE(),
                    Status = 'Issued',
                    AvailableQuantity = AvailableQuantity - 1,
                    UpdatedAt = GETDATE()
                OUTPUT INSERTED.*
                WHERE ItemID = @id AND AvailableQuantity > 0 AND Status = 'Available'
            `);

        if (!update.recordset[0]) {
            return res.status(400).json({ error: 'Could not issue item' });
        }

        const empRow = await pool.request()
            .input('id', sql.Int, employeeId)
            .query('SELECT Name FROM Employees WHERE EmployeeID = @id');
        const employeeName = empRow.recordset[0]?.Name || 'Employee';

        await notifyInventoryRequest(pool, sql, {
            itemId,
            itemName: row.ItemName,
            employeeId,
            employeeName
        });

        res.json({ success: true, item: mapInventory(update.recordset[0]) });
    } catch (error) {
        console.error('Request inventory:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/inventory/:id/return', authMiddleware, requireDb, async (req, res) => {
    try {
        const itemId = parseInt(req.params.id, 10);
        const employeeId = req.user.employeeId;
        const { notes } = req.body;

        const update = await pool.request()
            .input('id', sql.Int, itemId)
            .input('employeeId', sql.Int, employeeId)
            .query(`
                UPDATE Inventory SET
                    IssuedTo = NULL,
                    ReturnDate = GETDATE(),
                    Status = 'Available',
                    AvailableQuantity = AvailableQuantity + 1,
                    UpdatedAt = GETDATE()
                OUTPUT INSERTED.*
                WHERE ItemID = @id AND IssuedTo = @employeeId AND Status = 'Issued'
            `);

        if (!update.recordset[0]) {
            return res.status(400).json({ error: 'Could not return item' });
        }

        const itemRow = await pool.request()
            .input('id', sql.Int, itemId)
            .query('SELECT ItemName FROM Inventory WHERE ItemID = @id');
        const empRow = await pool.request()
            .input('id', sql.Int, employeeId)
            .query('SELECT Name FROM Employees WHERE EmployeeID = @id');

        await notifyInventoryReturn(pool, sql, {
            itemId,
            itemName: itemRow.recordset[0]?.ItemName || 'Item',
            employeeId,
            employeeName: empRow.recordset[0]?.Name || 'Employee'
        });

        res.json({ success: true, item: mapInventory(update.recordset[0]), notes: notes || '' });
    } catch (error) {
        console.error('Return inventory:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===== Knowledge Base =====
app.get('/api/knowledge-base', authMiddleware, requireDb, async (req, res) => {
    try {
        const { search, category } = req.query;
        let query = 'SELECT * FROM KnowledgeBase WHERE 1=1';
        const request = pool.request();

        if (search) {
            query += ' AND (Title LIKE @search OR Description LIKE @search OR Solution LIKE @search)';
            request.input('search', sql.NVarChar, `%${search}%`);
        }
        if (category) {
            query += ' AND Category = @category';
            request.input('category', sql.NVarChar, category);
        }

        query += ' ORDER BY ViewCount DESC, CreatedAt DESC';
        const result = await request.query(query);
        res.json({ success: true, articles: result.recordset.map(mapKB) });
    } catch (error) {
        console.error('Get KB:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/knowledge-base', authMiddleware, requireDb, async (req, res) => {
    try {
        const { title, description, solution, category } = req.body;
        if (!title || !description || !solution) {
            return res.status(400).json({ error: 'Title, problem, and solution required' });
        }

        const insert = await pool.request()
            .input('title', sql.NVarChar, title)
            .input('description', sql.NVarChar, description)
            .input('solution', sql.NVarChar, solution)
            .input('category', sql.NVarChar, category || 'Other')
            .input('addedBy', sql.Int, req.user.employeeId)
            .query(`
                INSERT INTO KnowledgeBase (Title, Description, Solution, Category, AddedBy)
                OUTPUT INSERTED.*
                VALUES (@title, @description, @solution, @category, @addedBy)
            `);

        res.status(201).json({ success: true, article: mapKB(insert.recordset[0]) });
    } catch (error) {
        console.error('Create KB:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/knowledge-base/:id/increment-views', authMiddleware, requireDb, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const result = await pool.request()
            .input('id', sql.Int, id)
            .query(`
                UPDATE KnowledgeBase SET ViewCount = ViewCount + 1
                OUTPUT INSERTED.*
                WHERE ProblemID = @id
            `);
        res.json({ success: true, article: mapKB(result.recordset[0]) });
    } catch (error) {
        console.error('KB views:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===== Notifications =====
// Admin sees all inventory/general notifications; any user sees their task_status notifications
app.get('/api/notifications', authMiddleware, requireDb, async (req, res) => {
    try {
        const isAdminUser = isAdminRole(req.user.role);
        const empId = req.user.employeeId;
        let result, unread;

        if (isAdminUser) {
            // Admin: all notifications (inventory + general) plus any addressed to them
            result = await pool.request().query(`
                SELECT TOP 50 * FROM Notifications
                WHERE RecipientEmployeeID IS NULL OR RecipientEmployeeID = ${empId}
                ORDER BY IsRead ASC, CreatedAt DESC
            `);
            unread = await pool.request().query(`
                SELECT COUNT(*) AS cnt FROM Notifications
                WHERE IsRead = 0 AND (RecipientEmployeeID IS NULL OR RecipientEmployeeID = ${empId})
            `);
        } else {
            // Non-admin: only task_status notifications addressed to them
            result = await pool.request()
                .input('empId', sql.Int, empId)
                .query(`
                    SELECT TOP 50 * FROM Notifications
                    WHERE RecipientEmployeeID = @empId
                    ORDER BY IsRead ASC, CreatedAt DESC
                `);
            unread = await pool.request()
                .input('empId', sql.Int, empId)
                .query('SELECT COUNT(*) AS cnt FROM Notifications WHERE IsRead = 0 AND RecipientEmployeeID = @empId');
        }

        res.json({
            success: true,
            notifications: result.recordset.map(mapNotification),
            unreadCount: unread.recordset[0].cnt
        });
    } catch (error) {
        console.error('Get notifications:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.put('/api/notifications/:id/read', authMiddleware, requireDb, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        await pool.request()
            .input('id', sql.Int, id)
            .query('UPDATE Notifications SET IsRead = 1 WHERE NotificationID = @id');
        res.json({ success: true });
    } catch (error) {
        console.error('Mark notification read:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.put('/api/notifications/read-all', authMiddleware, requireDb, async (req, res) => {
    try {
        const empId = req.user.employeeId;
        const isAdminUser = isAdminRole(req.user.role);
        if (isAdminUser) {
            await pool.request().query('UPDATE Notifications SET IsRead = 1 WHERE IsRead = 0');
        } else {
            await pool.request()
                .input('empId', sql.Int, empId)
                .query('UPDATE Notifications SET IsRead = 1 WHERE IsRead = 0 AND RecipientEmployeeID = @empId');
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Mark all read:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/notifications', authMiddleware, requireAdmin, requireDb, async (req, res) => {
    try {
        const result = await pool.request().query('DELETE FROM Notifications');
        res.json({ success: true, deleted: result.rowsAffected[0] });
    } catch (error) {
        console.error('Clear notifications:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===== Who is present today — all employees (admin) =====
app.get('/api/admin/attendance/today-all', authMiddleware, requireAdmin, requireDb, async (req, res) => {
    try {
        // Accept client's local date to avoid UTC midnight mismatches
        const dateParam = (req.query.date || '').trim();
        const dateExpr  = dateParam ? `CAST(@clientDate AS DATE)` : `CAST(GETDATE() AS DATE)`;
        const req2 = pool.request();
        if (dateParam) req2.input('clientDate', sql.Date, new Date(dateParam));

        const result = await req2.query(`
            SELECT e.EmployeeID, e.Name, e.Role, e.ProfileImageUrl, e.Designation,
                   e.ShiftStart,
                   t.TeamName,
                   a.LoginTime, a.TotalHours, a.LoginType,
                   a.StillIn
            FROM Employees e
            LEFT JOIN Teams t ON t.TeamID = e.TeamID
            LEFT JOIN (
                SELECT EmployeeID,
                       MIN(LoginTime)  AS LoginTime,
                       SUM(ISNULL(CAST(TotalHours AS FLOAT), 0)) AS TotalHours,
                       MAX(LoginType)  AS LoginType,
                       MAX(CASE WHEN LogoutTime IS NULL AND LoginTime IS NOT NULL THEN 1 ELSE 0 END) AS StillIn
                FROM Attendance
                WHERE Date = ${dateExpr}
                GROUP BY EmployeeID
            ) a ON a.EmployeeID = e.EmployeeID
            WHERE ISNULL(e.IsActive, 1) = 1
            ORDER BY CASE WHEN a.LoginTime IS NOT NULL THEN 0 ELSE 1 END, e.Name
        `);
        res.json({ success: true, employees: result.recordset });
    } catch (error) {
        console.error('Today-all attendance:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===== Attendance Export (XLSX) =====
app.get('/api/admin/attendance/export', authMiddleware, requireAdmin, requireDb, async (req, res) => {
    try {
        const yearMonth   = (req.query.month || '').trim(); // "YYYY-MM"
        const singleDate  = (req.query.date  || '').trim(); // "YYYY-MM-DD" — day-wise export
        const employeeIdQ = parseInt(req.query.employeeId, 10);
        const isDayWise   = /^\d{4}-\d{2}-\d{2}$/.test(singleDate);
        const isMonthWise = /^\d{4}-\d{2}$/.test(yearMonth);

        if (!isDayWise && !isMonthWise) {
            return res.status(400).json({ error: 'Provide month (YYYY-MM) or date (YYYY-MM-DD)' });
        }

        // Day-wise: export ALL employees for a specific date (no employeeId required)
        if (isDayWise) {
            const dateObj = new Date(singleDate);
            const result = await pool.request()
                .input('date', sql.Date, dateObj)
                .query(`
                    SELECT e.EmployeeID, e.Name, e.Role, e.Designation,
                           a.LoginTime, a.LogoutTime, a.TotalHours, a.LoginType
                    FROM Employees e
                    LEFT JOIN Attendance a ON a.EmployeeID = e.EmployeeID AND a.Date = @date
                    WHERE ISNULL(e.IsActive,1) = 1 AND e.Role <> 'Admin'
                    ORDER BY e.Name
                `);

            const dateLabel = dateObj.toLocaleDateString('en-GB', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });
            const fmt = (dt) => dt ? new Date(dt).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' }) : '—';

            const rows = result.recordset.map((r, i) => ({
                '#':            i + 1,
                'Name':         r.Name || '',
                'Role':         r.Role || '',
                'Login Time':   fmt(r.LoginTime),
                'Logout Time':  fmt(r.LogoutTime),
                'Hours':        r.TotalHours != null ? parseFloat(r.TotalHours).toFixed(2) : '—',
                'Type':         r.LoginType || (r.LoginTime ? 'Office' : 'Absent'),
                'Status':       r.LoginTime ? (r.LogoutTime ? 'Completed' : 'Present') : 'Absent',
            }));

            const present = rows.filter(r => r['Login Time'] !== '—').length;
            rows.push({});
            rows.push({ '#': 'Summary', 'Name': `Present: ${present}`, 'Role': `Absent: ${result.recordset.length - present}`, 'Login Time': '', 'Logout Time': '', 'Hours': '', 'Type': '', 'Status': '' });

            const headerAoa = [
                ['Global Vision Portal — Daily Attendance Report'],
                [`Date: ${dateLabel}   |   Total Employees: ${result.recordset.length}   |   Present: ${present}`],
                [],
                ['#', 'Name', 'Role', 'Login Time', 'Logout Time', 'Hours', 'Type', 'Status'],
            ];
            const dataAoa = rows.map(r => [r['#'], r['Name'], r['Role'], r['Login Time'], r['Logout Time'], r['Hours'], r['Type'], r['Status']]);
            const finalWs = XLSX.utils.aoa_to_sheet([...headerAoa, ...dataAoa]);
            finalWs['!cols'] = [{wch:4},{wch:22},{wch:14},{wch:12},{wch:14},{wch:8},{wch:10},{wch:12}];
            finalWs['!merges'] = [{ s:{r:0,c:0}, e:{r:0,c:7} }];

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, finalWs, 'Attendance');
            const buf = XLSX.write(wb, { type:'buffer', bookType:'xlsx' });
            const filename = `attendance_daily_${singleDate}.xlsx`;
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
            return res.send(buf);
        }

        // Month-wise ALL employees (no employeeId given)
        if (isMonthWise && (isNaN(employeeIdQ) || !employeeIdQ)) {
            const [year, month] = yearMonth.split('-').map(Number);
            const allResult = await pool.request()
                .input('year',  sql.Int, year)
                .input('month', sql.Int, month)
                .query(`
                    SELECT e.Name, e.Role, e.Designation,
                           a.Date, a.LoginTime, a.LogoutTime, a.TotalHours, a.LoginType
                    FROM Employees e
                    LEFT JOIN Attendance a ON a.EmployeeID = e.EmployeeID
                        AND YEAR(a.Date) = @year AND MONTH(a.Date) = @month
                    WHERE ISNULL(e.IsActive, 1) = 1 AND e.Role <> 'Admin'
                    ORDER BY e.Name, a.Date
                `);

            const monthLabel = new Date(year, month - 1, 1).toLocaleString('default', { month:'long', year:'numeric' });
            const fmt = dt => dt ? new Date(dt).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' }) : '—';
            const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB') : '—';

            const rows = allResult.recordset.map((r, i) => ({
                '#':            i + 1,
                'Name':         r.Name || '',
                'Role':         r.Role || '',
                'Date':         fmtDate(r.Date),
                'Login Time':   fmt(r.LoginTime),
                'Logout Time':  fmt(r.LogoutTime),
                'Hours':        r.TotalHours != null ? parseFloat(r.TotalHours).toFixed(2) : (r.Date ? '0.00' : '—'),
                'Type':         r.LoginType || (r.LoginTime ? 'Office' : (r.Date ? 'Absent' : '—')),
            }));

            const totalPresent = allResult.recordset.filter(r => r.LoginTime).length;
            rows.push({});
            rows.push({ '#': 'Summary', 'Name': `Records: ${allResult.recordset.filter(r=>r.Date).length}`, 'Role': `Present entries: ${totalPresent}` });

            const headerAoa = [
                ['Global Vision Portal — Monthly Attendance Report (All Employees)'],
                [`Month: ${monthLabel}   |   Exported: ${new Date().toLocaleDateString('en-GB')}`],
                [],
                ['#','Name','Role','Date','Login Time','Logout Time','Hours','Type'],
            ];
            const dataAoa = rows.map(r => [r['#'],r['Name'],r['Role'],r['Date'],r['Login Time'],r['Logout Time'],r['Hours'],r['Type']]);
            const finalWs = XLSX.utils.aoa_to_sheet([...headerAoa, ...dataAoa]);
            finalWs['!cols'] = [{wch:4},{wch:22},{wch:14},{wch:14},{wch:12},{wch:14},{wch:8},{wch:10}];
            finalWs['!merges'] = [{ s:{r:0,c:0}, e:{r:0,c:7} }];
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, finalWs, 'Attendance');
            const buf = XLSX.write(wb, { type:'buffer', bookType:'xlsx' });
            const filename = `attendance_all_employees_${yearMonth}.xlsx`;
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
            return res.send(buf);
        }

        // Month-wise: single employee (requires employeeId)
        const employeeId = employeeIdQ;

        const [year, month] = yearMonth.split('-').map(Number);

        // Fetch employee name
        const empRow = await pool.request()
            .input('id', sql.Int, employeeId)
            .query('SELECT Name FROM Employees WHERE EmployeeID = @id');
        if (!empRow.recordset[0]) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        const { Name: empName } = empRow.recordset[0];

        // Fetch attendance for that month
        const result = await pool.request()
            .input('empId', sql.Int, employeeId)
            .input('year',  sql.Int, year)
            .input('month', sql.Int, month)
            .query(`
                SELECT Date, LoginTime, LogoutTime, TotalHours
                FROM Attendance
                WHERE EmployeeID = @empId
                  AND YEAR(Date) = @year
                  AND MONTH(Date) = @month
                ORDER BY Date ASC
            `);

        const monthLabel = new Date(year, month - 1, 1)
            .toLocaleString('default', { month: 'long', year: 'numeric' });

        // Build worksheet rows
        const rows = result.recordset.map((r, i) => {
            const date     = r.Date      ? new Date(r.Date).toLocaleDateString('en-GB')      : '—';
            const loginT   = r.LoginTime  ? new Date(r.LoginTime).toLocaleTimeString('en-GB',  { hour: '2-digit', minute: '2-digit' }) : '—';
            const logoutT  = r.LogoutTime ? new Date(r.LogoutTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—';
            const hours    = r.TotalHours != null ? parseFloat(r.TotalHours).toFixed(2) : '—';
            return {
                '#':            i + 1,
                'Date':         date,
                'Login Time':   loginT,
                'Logout Time':  logoutT,
                'Total Hours':  hours,
            };
        });

        // Summary row
        const totalHours = result.recordset.reduce((sum, r) => sum + (parseFloat(r.TotalHours) || 0), 0);
        const daysPresent = result.recordset.filter(r => r.LoginTime).length;
        rows.push({});  // blank row
        rows.push({ '#': 'Summary', 'Date': `Days present: ${daysPresent}`, 'Login Time': '', 'Logout Time': 'Total hours:', 'Total Hours': totalHours.toFixed(2) });

        const headerAoa = [
            ['Global Vision Portal — Monthly Attendance Report'],
            [`Employee: ${empName}   |   Month: ${monthLabel}`],
            [],
            ['#', 'Date', 'Login Time', 'Logout Time', 'Total Hours'],
        ];
        const dataAoa = rows.map(r => [r['#'], r['Date'], r['Login Time'], r['Logout Time'], r['Total Hours']]);
        const fullAoa = [...headerAoa, ...dataAoa];

        const finalWs = XLSX.utils.aoa_to_sheet(fullAoa);
        finalWs['!cols'] = [{ wch: 4 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 13 }];
        finalWs['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, finalWs, 'Attendance');

        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        const filename = `attendance_${empName.replace(/\s+/g, '_')}_${yearMonth}.xlsx`;

        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
        res.send(buf);
    } catch (error) {
        console.error('Attendance export:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===== Single employee attendance records for a month (on-screen view) =====
app.get('/api/admin/attendance/records', authMiddleware, requireAdmin, requireDb, async (req, res) => {
    try {
        const employeeId = parseInt(req.query.employeeId, 10);
        const yearMonth  = (req.query.month || '').trim();
        if (!employeeId || isNaN(employeeId)) return res.status(400).json({ error: 'employeeId required' });
        if (!/^\d{4}-\d{2}$/.test(yearMonth))  return res.status(400).json({ error: 'month must be YYYY-MM' });
        const [year, month] = yearMonth.split('-').map(Number);
        const result = await pool.request()
            .input('empId', sql.Int, employeeId)
            .input('year',  sql.Int, year)
            .input('month', sql.Int, month)
            .query(`
                SELECT Date, LoginTime, LogoutTime, TotalHours, LoginType
                FROM Attendance
                WHERE EmployeeID = @empId AND YEAR(Date) = @year AND MONTH(Date) = @month
                ORDER BY Date ASC
            `);
        const totHours    = result.recordset.reduce((s, r) => s + (parseFloat(r.TotalHours) || 0), 0);
        const daysPresent = result.recordset.filter(r => r.LoginTime).length;
        res.json({ success: true, records: result.recordset, totalHours: totHours.toFixed(2), daysPresent });
    } catch (error) {
        console.error('Attendance records:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===== All employees monthly attendance summary (on-screen view) =====
app.get('/api/admin/attendance/summary', authMiddleware, requireAdmin, requireDb, async (req, res) => {
    try {
        const yearMonth = (req.query.month || '').trim();
        if (!/^\d{4}-\d{2}$/.test(yearMonth)) return res.status(400).json({ error: 'month must be YYYY-MM' });
        const [year, month] = yearMonth.split('-').map(Number);
        const result = await pool.request()
            .input('year',  sql.Int, year)
            .input('month', sql.Int, month)
            .query(`
                SELECT e.EmployeeID, e.Name, e.Role, e.Designation, t.TeamName,
                       COUNT(a.AttendanceID)                         AS DaysPresent,
                       ISNULL(SUM(
                           CASE
                               WHEN a.TotalHours IS NOT NULL THEN CAST(a.TotalHours AS FLOAT)
                               WHEN a.LogoutTime IS NOT NULL AND a.LoginTime IS NOT NULL
                                   THEN ROUND(DATEDIFF(MINUTE, a.LoginTime, a.LogoutTime) / 60.0, 2)
                               ELSE 0
                           END
                       ), 0)                                        AS TotalHours,
                       MIN(a.LoginTime)                              AS FirstLogin,
                       MAX(a.LogoutTime)                             AS LastLogout
                FROM Employees e
                LEFT JOIN Teams t ON t.TeamID = e.TeamID
                LEFT JOIN Attendance a ON a.EmployeeID = e.EmployeeID
                    AND YEAR(a.Date) = @year AND MONTH(a.Date) = @month
                WHERE ISNULL(e.IsActive, 1) = 1 AND e.Role <> 'Admin'
                GROUP BY e.EmployeeID, e.Name, e.Role, e.Designation, t.TeamName
                ORDER BY e.Name
            `);
        res.json({ success: true, employees: result.recordset });
    } catch (error) {
        console.error('Attendance summary:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

registerChatRoutes(app, {
    get pool() { return pool; },
    express,
    authMiddleware,
    requireDb,
    get io() { return io; },
});
registerChatSocket(io, { get pool() { return pool; } });

registerAdminManagementRoutes(app, {
    get pool() { return pool; },
    get dbConnected() { return dbConnected; },
    mapEmployee,
    EMPLOYEE_SELECT,
    EMPLOYEE_FROM,
});

registerTeamDashboardRoutes(app, {
    get pool() { return pool; },
    get dbConnected() { return dbConnected; },
});

registerHrPortalRoutes(app, {
    get pool() { return pool; },
    get dbConnected() { return dbConnected; },
    mapEmployee,
    EMPLOYEE_SELECT,
    EMPLOYEE_FROM,
});

registerTaskLogRoutes(app, {
    get pool() { return pool; },
    sql,
    authMiddleware,
    requireDb,
});

registerFinanceRoutes(app, {
    get pool() { return pool; },
    get dbConnected() { return dbConnected; },
});

app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

async function startServer() {
    await connectToDatabase();
    httpServer.listen(PORT, () => {
        console.log(`Server: http://localhost:${PORT}`);
        console.log(`Health: http://localhost:${PORT}/api/health`);
        console.log(`DB: ${dbConnected ? 'Connected' : 'Disconnected'}`);
        if (!dbConnected) {
            console.log('Run: node scripts/init-database.js');
        }
    });
}

startServer().catch((err) => {
    console.error('Failed to start:', err);
    process.exit(1);
});

process.on('SIGINT', async () => {
    if (pool) await pool.close();
    process.exit(0);
});