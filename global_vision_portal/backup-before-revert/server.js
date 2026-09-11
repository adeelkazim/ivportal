const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const { sql, dbConfig, DB_NAME } = require('./config/database');
const multer = require('multer');
const { parseInventoryCsv } = require('./utils/parseCsv');
const { signToken, authMiddleware, requireAdmin, requireManagerOrAdmin } = require('./middleware/auth');

const csvUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/csv' || file.originalname.toLowerCase().endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV files are allowed'));
        }
    }
});

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

let pool;
let dbConnected = false;

function mapEmployee(row) {
    return {
        id: row.EmployeeID,
        EmployeeID: row.EmployeeID,
        name: row.Name,
        Name: row.Name,
        email: row.Email,
        Email: row.Email,
        department: row.Department,
        Department: row.Department,
        role: row.Role,
        Role: row.Role,
        contact: row.Contact,
        Contact: row.Contact
    };
}

function mapTask(row) {
    return {
        TaskID: row.TaskID,
        Title: row.Title,
        Description: row.Description,
        AssignedTo: row.AssignedTo,
        AssignedToName: row.AssignedToName || null,
        AssignedBy: row.AssignedBy,
        Status: row.Status,
        Priority: row.Priority,
        Deadline: row.Deadline,
        CompletedDate: row.CompletedDate,
        CreatedAt: row.CreatedAt
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
        Status: row.Status
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
        console.log(`Database connected: (localdb)\\MSSQLLocalDB / ${DB_NAME}`);
    } catch (error) {
        dbConnected = false;
        console.error('Database connection failed:', error.message);
        console.error('Run: npm run init-db');
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
        server: '(localdb)\\MSSQLLocalDB',
        databaseName: dbConfig.database
    });
});

// ===== Auth =====
app.post('/api/auth/login', requireDb, async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        const result = await pool.request()
            .input('email', sql.NVarChar, email)
            .query('SELECT * FROM Employees WHERE Email = @email');

        const row = result.recordset[0];
        if (!row) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const valid = await bcrypt.compare(password, row.PasswordHash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid credentials' });
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
    try {
        const { name, email, department, contact, password, role } = req.body;
        if (!name || !email || !department || !password) {
            return res.status(400).json({ error: 'Required fields missing' });
        }

        const existing = await pool.request()
            .input('email', sql.NVarChar, email)
            .query('SELECT EmployeeID FROM Employees WHERE Email = @email');

        if (existing.recordset.length > 0) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        const hash = await bcrypt.hash(password, 10);
        const insert = await pool.request()
            .input('name', sql.NVarChar, name)
            .input('email', sql.NVarChar, email)
            .input('department', sql.NVarChar, department)
            .input('contact', sql.NVarChar, contact || '')
            .input('role', sql.NVarChar, role || 'Employee')
            .input('hash', sql.NVarChar, hash)
            .query(`
                INSERT INTO Employees (Name, Email, Department, Role, Contact, PasswordHash)
                OUTPUT INSERTED.*
                VALUES (@name, @email, @department, @role, @contact, @hash)
            `);

        const user = mapEmployee(insert.recordset[0]);
        res.status(201).json({ success: true, user });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/auth/logout', authMiddleware, (req, res) => {
    res.json({ success: true, message: 'Logged out' });
});

// ===== Attendance =====
app.get('/api/attendance', authMiddleware, requireDb, async (req, res) => {
    try {
        const employeeId = req.user.employeeId;
        const result = await pool.request()
            .input('employeeId', sql.Int, employeeId)
            .query(`
                SELECT AttendanceID, EmployeeID, Date, LoginTime, LogoutTime, TotalHours
                FROM Attendance WHERE EmployeeID = @employeeId
                ORDER BY Date DESC
            `);
        res.json({ success: true, records: result.recordset });
    } catch (error) {
        console.error('Attendance fetch:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/attendance/today', authMiddleware, requireDb, async (req, res) => {
    try {
        const employeeId = req.user.employeeId;
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
        const employeeId = req.user.employeeId;
        const result = await pool.request()
            .input('employeeId', sql.Int, employeeId)
            .query(`
                SELECT ISNULL(SUM(TotalHours), 0) AS monthlyHours
                FROM Attendance
                WHERE EmployeeID = @employeeId
                  AND LogoutTime IS NOT NULL
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
        const employeeId = req.body.employeeId || req.user.employeeId;
        const today = await pool.request()
            .input('employeeId', sql.Int, employeeId)
            .query(`
                SELECT TOP 1 * FROM Attendance
                WHERE EmployeeID = @employeeId AND Date = CAST(GETDATE() AS DATE) AND LogoutTime IS NULL
            `);

        if (today.recordset.length > 0) {
            return res.json({ success: true, record: today.recordset[0], message: 'Already logged in' });
        }

        const insert = await pool.request()
            .input('employeeId', sql.Int, employeeId)
            .query(`
                INSERT INTO Attendance (EmployeeID, Date, LoginTime)
                OUTPUT INSERTED.*
                VALUES (@employeeId, CAST(GETDATE() AS DATE), GETDATE())
            `);

        res.json({ success: true, record: insert.recordset[0] });
    } catch (error) {
        console.error('Attendance login:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/attendance/logout', authMiddleware, requireDb, async (req, res) => {
    try {
        const employeeId = req.body.employeeId || req.user.employeeId;
        const open = await pool.request()
            .input('employeeId', sql.Int, employeeId)
            .query(`
                SELECT TOP 1 AttendanceID, LoginTime FROM Attendance
                WHERE EmployeeID = @employeeId AND Date = CAST(GETDATE() AS DATE) AND LogoutTime IS NULL
                ORDER BY AttendanceID DESC
            `);

        if (open.recordset.length === 0) {
            return res.status(400).json({ error: 'No active login for today' });
        }

        const attId = open.recordset[0].AttendanceID;
        const update = await pool.request()
            .input('id', sql.Int, attId)
            .query(`
                UPDATE Attendance SET
                    LogoutTime = GETDATE(),
                    TotalHours = ROUND(DATEDIFF(MINUTE, LoginTime, GETDATE()) / 60.0, 2)
                OUTPUT INSERTED.*
                WHERE AttendanceID = @id
            `);

        res.json({ success: true, record: update.recordset[0] });
    } catch (error) {
        console.error('Attendance logout:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/attendance/toggle', authMiddleware, requireDb, async (req, res) => {
    try {
        const employeeId = req.user.employeeId;
        const open = await pool.request()
            .input('employeeId', sql.Int, employeeId)
            .query(`
                SELECT TOP 1 AttendanceID FROM Attendance
                WHERE EmployeeID = @employeeId AND Date = CAST(GETDATE() AS DATE) AND LogoutTime IS NULL
            `);

        if (open.recordset.length === 0) {
            const insert = await pool.request()
                .input('employeeId', sql.Int, employeeId)
                .query(`
                    INSERT INTO Attendance (EmployeeID, Date, LoginTime)
                    OUTPUT INSERTED.*
                    VALUES (@employeeId, CAST(GETDATE() AS DATE), GETDATE())
                `);
            return res.json({ success: true, action: 'login', record: insert.recordset[0] });
        }

        const attId = open.recordset[0].AttendanceID;
        const update = await pool.request()
            .input('id', sql.Int, attId)
            .query(`
                UPDATE Attendance SET
                    LogoutTime = GETDATE(),
                    TotalHours = ROUND(DATEDIFF(MINUTE, LoginTime, GETDATE()) / 60.0, 2)
                OUTPUT INSERTED.*
                WHERE AttendanceID = @id
            `);
        res.json({ success: true, action: 'logout', record: update.recordset[0] });
    } catch (error) {
        console.error('Attendance toggle:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===== Employees =====
app.get('/api/employees/:id', authMiddleware, requireDb, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (id !== req.user.employeeId && req.user.role !== 'Admin') {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const result = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT EmployeeID, Name, Email, Department, Role, Contact FROM Employees WHERE EmployeeID = @id');

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

        const { name, contact } = req.body;
        const result = await pool.request()
            .input('id', sql.Int, id)
            .input('name', sql.NVarChar, name)
            .input('contact', sql.NVarChar, contact || '')
            .query(`
                UPDATE Employees SET Name = @name, Contact = @contact, UpdatedAt = GETDATE()
                OUTPUT INSERTED.EmployeeID, INSERTED.Name, INSERTED.Email, INSERTED.Department, INSERTED.Role, INSERTED.Contact
                WHERE EmployeeID = @id
            `);

        res.json({ success: true, employee: mapEmployee(result.recordset[0]) });
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
            SELECT EmployeeID, Name, Email, Department, Role, Contact
            FROM Employees ORDER BY Name
        `);
        res.json({ success: true, employees: result.recordset.map(mapEmployee) });
    } catch (error) {
        console.error('List employees:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===== Tasks =====
app.get('/api/tasks', authMiddleware, requireDb, async (req, res) => {
    try {
        const { assignedTo, status, all } = req.query;
        const isStaff = req.user.role === 'Admin' || req.user.role === 'Manager';
        const showAll = isStaff && (all === 'true' || all === '1');

        let query = `
            SELECT t.*, e.Name AS AssignedToName
            FROM Tasks t
            LEFT JOIN Employees e ON t.AssignedTo = e.EmployeeID
            WHERE 1=1
        `;
        const request = pool.request();

        if (!showAll) {
            const targetId = assignedTo ? parseInt(assignedTo, 10) : req.user.employeeId;
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

app.post('/api/tasks', authMiddleware, requireManagerOrAdmin, requireDb, async (req, res) => {
    try {
        const { title, description, assignedTo, priority, deadline, status } = req.body;
        if (!title || !assignedTo) {
            return res.status(400).json({ error: 'Title and assigned employee are required' });
        }

        const insert = await pool.request()
            .input('title', sql.NVarChar, title)
            .input('description', sql.NVarChar, description || '')
            .input('assignedTo', sql.Int, parseInt(assignedTo, 10))
            .input('assignedBy', sql.Int, req.user.employeeId)
            .input('status', sql.NVarChar, status || 'Pending')
            .input('priority', sql.NVarChar, priority || 'Medium')
            .input('deadline', sql.DateTime, deadline ? new Date(deadline) : new Date(Date.now() + 7 * 86400000))
            .query(`
                INSERT INTO Tasks (Title, Description, AssignedTo, AssignedBy, Status, Priority, Deadline)
                OUTPUT INSERTED.*
                VALUES (@title, @description, @assignedTo, @assignedBy, @status, @priority, @deadline)
            `);

        const task = mapTask(insert.recordset[0]);
        const nameRow = await pool.request()
            .input('id', sql.Int, task.AssignedTo)
            .query('SELECT Name FROM Employees WHERE EmployeeID = @id');
        task.AssignedToName = nameRow.recordset[0]?.Name || null;

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
            .query('SELECT AssignedTo FROM Tasks WHERE TaskID = @id');

        if (!check.recordset[0]) {
            return res.status(404).json({ error: 'Task not found' });
        }

        if (check.recordset[0].AssignedTo !== req.user.employeeId && req.user.role === 'Employee') {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const updateSql = Status === 'Completed'
            ? `UPDATE Tasks SET Status = @status, UpdatedAt = GETDATE(), CompletedDate = GETDATE()
               OUTPUT INSERTED.* WHERE TaskID = @id`
            : `UPDATE Tasks SET Status = @status, UpdatedAt = GETDATE(), CompletedDate = NULL
               OUTPUT INSERTED.* WHERE TaskID = @id`;

        const result = await pool.request()
            .input('id', sql.Int, taskId)
            .input('status', sql.NVarChar, Status)
            .query(updateSql);

        res.json({ success: true, task: mapTask(result.recordset[0]) });
    } catch (error) {
        console.error('Update task:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===== Inventory =====
app.get('/api/inventory', authMiddleware, requireDb, async (req, res) => {
    try {
        const { issuedTo } = req.query;
        let query = `
            SELECT i.*, e.Name AS IssuedToName
            FROM Inventory i
            LEFT JOIN Employees e ON i.IssuedTo = e.EmployeeID
        `;
        const request = pool.request();

        if (issuedTo) {
            query += ' WHERE i.IssuedTo = @issuedTo';
            request.input('issuedTo', sql.Int, parseInt(issuedTo, 10));
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
    csvUpload.single('file')(req, res, async (uploadErr) => {
        if (uploadErr) {
            return res.status(400).json({ error: uploadErr.message });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'CSV file is required (field name: file)' });
        }

        try {
            const rows = parseInventoryCsv(req.file.buffer);
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

app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

async function startServer() {
    await connectToDatabase();
    app.listen(PORT, () => {
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
