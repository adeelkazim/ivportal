const multer = require('multer');
const { sql } = require('../config/database');
const { authMiddleware, requireAdmin, requireManagerOrAdmin, requireFinanceAccess, isAdminRole } = require('../middleware/auth');
const { parseExpiresAt } = require('../services/announcements');

function parseDeadline(value) {
    if (value === null || value === undefined || value === '') return { date: null };
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return { error: 'Invalid deadline date' };
    return { date: d };
}
const {
    mapMedicalBalance,
    mapFeedback,
    mapJobOpening,
    mapCourse,
    mapEnrollment,
    upsertMedicalBalance,
} = require('../services/hrPortal');
const { parseMedicalBalanceFile } = require('../utils/parseMedicalBalanceFile');

const medicalUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter(req, file, cb) {
        const ok = /\.(xlsx|xls|csv)$/i.test(file.originalname || '');
        cb(ok ? null : new Error('Only .xlsx, .xls, or .csv files are allowed'), ok);
    },
});

function registerHrPortalRoutes(app, deps) {
    const { mapEmployee, EMPLOYEE_SELECT, EMPLOYEE_FROM } = deps;

    function requireDb(req, res, next) {
        if (!deps.dbConnected || !deps.pool) {
            return res.status(503).json({ error: 'Database unavailable' });
        }
        next();
    }

    async function applyMedicalRows(rows, updatedBy, restrictToEmployeeId = null) {
        let updated = 0;
        const skipped = [];
        for (const row of rows) {
            if (restrictToEmployeeId && row.employeeId !== restrictToEmployeeId) {
                skipped.push(row.employeeId);
                continue;
            }
            const exists = await deps.pool.request()
                .input('id', sql.Int, row.employeeId)
                .query('SELECT EmployeeID FROM Employees WHERE EmployeeID = @id');
            if (!exists.recordset.length) {
                skipped.push(row.employeeId);
                continue;
            }
            await upsertMedicalBalance(deps.pool, row.employeeId, row.balance, updatedBy, row.loanBalance, row.leavesRemaining);
            updated += 1;
        }
        return { updated, skipped };
    }

    // ===== Working hours (employee reads own) =====
    app.get('/api/me/working-hours', authMiddleware, requireDb, async (req, res) => {
        try {
            const empId = parseInt(req.user.employeeId, 10);
            const result = await deps.pool.request()
                .input('id', sql.Int, empId)
                .query(`SELECT ShiftStart, ShiftEnd FROM Employees WHERE EmployeeID = @id`);
            const row = result.recordset[0] || {};
            res.json({ success: true, shiftStart: row.ShiftStart || null, shiftEnd: row.ShiftEnd || null });
        } catch (e) {
            console.error('Me working hours:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ===== Medical balance =====
    app.get('/api/medical-balance', authMiddleware, requireDb, async (req, res) => {
        try {
            const employeeId = parseInt(req.user.employeeId, 10);
            const result = await deps.pool.request()
                .input('id', sql.Int, employeeId)
                .query(`
                    SELECT m.*, e.Name AS EmployeeName, e.Email,
                        u.Name AS UpdatedByName
                    FROM Employees e
                    LEFT JOIN MedicalBalances m ON m.EmployeeID = e.EmployeeID
                    LEFT JOIN Employees u ON u.EmployeeID = m.UpdatedBy
                    WHERE e.EmployeeID = @id
                `);
            const row = result.recordset[0];
            if (!row) return res.status(404).json({ error: 'Employee not found' });
            res.json({
                success: true,
                balance: mapMedicalBalance({
                    ...row,
                    Balance:         row.Balance         != null ? row.Balance         : 0,
                    LoanBalance:     row.LoanBalance     != null ? row.LoanBalance     : 0,
                    LeavesRemaining: row.LeavesRemaining != null ? row.LeavesRemaining : 0,
                    LastUpdatedOn:   row.LastUpdatedOn   || null,
                }),
            });
        } catch (error) {
            console.error('Medical balance:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.get('/api/admin/medical-balances', authMiddleware, requireFinanceAccess, requireDb, async (req, res) => {
        try {
            const result = await deps.pool.request().query(`
                SELECT e.EmployeeID, e.Name AS EmployeeName, e.Email,
                    ISNULL(m.Balance, 0)          AS Balance,
                    ISNULL(m.LoanBalance, 0)      AS LoanBalance,
                    ISNULL(m.LeavesRemaining, 0)  AS LeavesRemaining,
                    m.LastUpdatedOn, ub.Name AS UpdatedByName
                FROM Employees e
                LEFT JOIN MedicalBalances m ON m.EmployeeID = e.EmployeeID
                LEFT JOIN Employees ub ON ub.EmployeeID = m.UpdatedBy
                WHERE e.Role <> 'Admin'
                ORDER BY e.Name
            `);
            res.json({
                success: true,
                balances: result.recordset.map(mapMedicalBalance),
            });
        } catch (error) {
            console.error('Medical balances list:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.put('/api/admin/medical-balances/:employeeId', authMiddleware, requireFinanceAccess, requireDb, async (req, res) => {
        try {
            const employeeId    = parseInt(req.params.employeeId, 10);
            const balance       = parseFloat(req.body.balance);
            const loanBalance   = req.body.loanBalance   != null ? parseFloat(req.body.loanBalance)   : null;
            const leavesRemaining = req.body.leavesRemaining != null ? parseInt(req.body.leavesRemaining, 10) : null;
            if (!employeeId || isNaN(balance)) {
                return res.status(400).json({ error: 'Valid employee ID and balance are required' });
            }
            await upsertMedicalBalance(deps.pool, employeeId, balance, req.user.employeeId, loanBalance, leavesRemaining);
            res.json({ success: true });
        } catch (error) {
            console.error('Medical balance update:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    function handleMedicalUpload(restrictToEmployeeId) {
        return (req, res) => {
            medicalUpload.single('file')(req, res, async (uploadErr) => {
                if (uploadErr) return res.status(400).json({ error: uploadErr.message });
                if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
                try {
                    const parsed = parseMedicalBalanceFile(req.file.buffer, req.file.originalname);
                    const result = await applyMedicalRows(
                        parsed.rows,
                        req.user.employeeId,
                        restrictToEmployeeId
                    );
                    res.json({
                        success: true,
                        updated: result.updated,
                        skipped: result.skipped,
                        errors: parsed.errors,
                    });
                } catch (error) {
                    res.status(400).json({ error: error.message || 'Upload failed' });
                }
            });
        };
    }

    app.post('/api/admin/medical-balances/upload', authMiddleware, requireFinanceAccess, requireDb, handleMedicalUpload(null));

    app.post('/api/medical-balance/upload', authMiddleware, requireDb, (req, res) => {
        const employeeId = parseInt(req.user.employeeId, 10);
        medicalUpload.single('file')(req, res, async (uploadErr) => {
            if (uploadErr) return res.status(400).json({ error: uploadErr.message });
            if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
            try {
                const parsed = parseMedicalBalanceFile(req.file.buffer, req.file.originalname);
                const result = await applyMedicalRows(parsed.rows, req.user.employeeId, employeeId);
                if (!result.updated) {
                    return res.status(400).json({
                        error: 'File must contain your EmployeeID only. Use one row with your ID and balance.',
                    });
                }
                res.json({ success: true, updated: result.updated, errors: parsed.errors });
            } catch (error) {
                res.status(400).json({ error: error.message || 'Upload failed' });
            }
        });
    });

    // ===== Custom Balance Cards =====

    // Employee: get all active card types with their own amounts
    app.get('/api/balance-cards', authMiddleware, requireDb, async (req, res) => {
        try {
            const employeeId = parseInt(req.user.employeeId, 10);
            const result = await deps.pool.request()
                .input('empId', sql.Int, employeeId)
                .query(`
                    SELECT
                        ct.CardTypeID, ct.Label, ct.Icon, ct.Color, ct.IsDeduction,
                        ISNULL(ct.Unit, 'PKR') AS Unit,
                        ISNULL(v.Amount, 0) AS Amount,
                        v.UpdatedAt,
                        updater.Name AS UpdatedByName
                    FROM BalanceCardTypes ct
                    LEFT JOIN EmployeeBalanceValues v
                        ON v.CardTypeID = ct.CardTypeID AND v.EmployeeID = @empId
                    LEFT JOIN Employees updater ON updater.EmployeeID = v.UpdatedBy
                    WHERE ct.IsActive = 1
                    ORDER BY ct.IsDeduction ASC, ct.CardTypeID ASC
                `);
            res.json({ success: true, cards: result.recordset });
        } catch (err) {
            console.error('Balance cards:', err);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // Admin: list all card type definitions
    app.get('/api/admin/balance-card-types', authMiddleware, requireFinanceAccess, requireDb, async (req, res) => {
        try {
            const result = await deps.pool.request().query(`
                SELECT ct.CardTypeID, ct.Label, ct.Icon, ct.Color, ct.IsActive, ct.IsDeduction,
                       ISNULL(ct.Unit, 'PKR') AS Unit, ct.CreatedAt,
                       e.Name AS CreatedByName
                FROM BalanceCardTypes ct
                LEFT JOIN Employees e ON e.EmployeeID = ct.CreatedBy
                ORDER BY ct.IsDeduction ASC, ct.CardTypeID ASC
            `);
            res.json({ success: true, cardTypes: result.recordset });
        } catch (err) {
            console.error('Admin balance card types:', err);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // Admin: create a new card type
    app.post('/api/admin/balance-card-types', authMiddleware, requireFinanceAccess, requireDb, async (req, res) => {
        try {
            const label       = (req.body.label || '').trim();
            const icon        = (req.body.icon  || '💳').trim() || '💳';
            const color       = (req.body.color || '').trim() || null;
            const isDeduction = req.body.isDeduction ? 1 : 0;
            const unit        = req.body.unit === 'Days' ? 'Days' : 'PKR';
            if (!label) return res.status(400).json({ error: 'Label is required' });

            const insert = await deps.pool.request()
                .input('label',       sql.NVarChar, label)
                .input('icon',        sql.NVarChar, icon)
                .input('color',       sql.NVarChar, color)
                .input('isDeduction', sql.Bit,      isDeduction)
                .input('unit',        sql.NVarChar, unit)
                .input('createdBy',   sql.Int,      req.user.employeeId)
                .query(`
                    INSERT INTO BalanceCardTypes (Label, Icon, Color, IsDeduction, Unit, CreatedBy)
                    OUTPUT INSERTED.CardTypeID
                    VALUES (@label, @icon, @color, @isDeduction, @unit, @createdBy)
                `);
            res.status(201).json({ success: true, id: insert.recordset[0].CardTypeID });
        } catch (err) {
            console.error('Create balance card type:', err);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // Admin: update a card type
    app.put('/api/admin/balance-card-types/:id', authMiddleware, requireFinanceAccess, requireDb, async (req, res) => {
        try {
            const id          = parseInt(req.params.id, 10);
            const label       = (req.body.label || '').trim();
            const icon        = (req.body.icon  || '💳').trim() || '💳';
            const color       = (req.body.color || '').trim() || null;
            const isActive    = req.body.isActive    === false ? 0 : 1;
            const isDeduction = req.body.isDeduction ? 1 : 0;
            const unit        = req.body.unit === 'Days' ? 'Days' : 'PKR';
            if (!label) return res.status(400).json({ error: 'Label is required' });

            await deps.pool.request()
                .input('id',          sql.Int,      id)
                .input('label',       sql.NVarChar, label)
                .input('icon',        sql.NVarChar, icon)
                .input('color',       sql.NVarChar, color)
                .input('isActive',    sql.Bit,      isActive)
                .input('isDeduction', sql.Bit,      isDeduction)
                .input('unit',        sql.NVarChar, unit)
                .query(`
                    UPDATE BalanceCardTypes
                    SET Label = @label, Icon = @icon, Color = @color, IsActive = @isActive,
                        IsDeduction = @isDeduction, Unit = @unit
                    WHERE CardTypeID = @id
                `);
            res.json({ success: true });
        } catch (err) {
            console.error('Update balance card type:', err);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // Admin: delete a card type (cascades to all employee values)
    app.delete('/api/admin/balance-card-types/:id', authMiddleware, requireFinanceAccess, requireDb, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            await deps.pool.request()
                .input('id', sql.Int, id)
                .query('DELETE FROM BalanceCardTypes WHERE CardTypeID = @id');
            res.json({ success: true });
        } catch (err) {
            console.error('Delete balance card type:', err);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // Admin: get all employee values for a specific card type
    app.get('/api/admin/balance-card-types/:id/values', authMiddleware, requireFinanceAccess, requireDb, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            const result = await deps.pool.request()
                .input('id', sql.Int, id)
                .query(`
                    SELECT
                        e.EmployeeID, e.Name AS EmployeeName,
                        ISNULL(v.Amount, 0) AS Amount,
                        v.UpdatedAt,
                        updater.Name AS UpdatedByName
                    FROM Employees e
                    LEFT JOIN EmployeeBalanceValues v
                        ON v.CardTypeID = @id AND v.EmployeeID = e.EmployeeID
                    LEFT JOIN Employees updater ON updater.EmployeeID = v.UpdatedBy
                    WHERE e.Role <> 'Admin'
                    ORDER BY e.Name ASC
                `);
            res.json({ success: true, values: result.recordset });
        } catch (err) {
            console.error('Balance card values:', err);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // Admin: set a single employee's amount for a card type
    app.put('/api/admin/balance-card-types/:id/values/:employeeId', authMiddleware, requireFinanceAccess, requireDb, async (req, res) => {
        try {
            const cardId     = parseInt(req.params.id, 10);
            const employeeId = parseInt(req.params.employeeId, 10);
            const amount     = parseFloat(req.body.amount);
            if (isNaN(amount)) return res.status(400).json({ error: 'Valid amount is required' });

            await deps.pool.request()
                .input('cardId',     sql.Int,            cardId)
                .input('empId',      sql.Int,            employeeId)
                .input('amount',     sql.Decimal(18, 2), amount)
                .input('updatedBy',  sql.Int,            req.user.employeeId)
                .query(`
                    IF EXISTS (
                        SELECT 1 FROM EmployeeBalanceValues
                        WHERE CardTypeID = @cardId AND EmployeeID = @empId
                    )
                        UPDATE EmployeeBalanceValues
                        SET Amount = @amount, UpdatedBy = @updatedBy, UpdatedAt = GETDATE()
                        WHERE CardTypeID = @cardId AND EmployeeID = @empId
                    ELSE
                        INSERT INTO EmployeeBalanceValues (CardTypeID, EmployeeID, Amount, UpdatedBy, UpdatedAt)
                        VALUES (@cardId, @empId, @amount, @updatedBy, GETDATE())
                `);
            res.json({ success: true });
        } catch (err) {
            console.error('Set balance card value:', err);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // Admin overview: all employees x all balance types in one call
    app.get('/api/admin/balances-overview', authMiddleware, requireFinanceAccess, requireDb, async (req, res) => {
        try {
            // Card types
            const ctResult = await deps.pool.request().query(`
                SELECT CardTypeID, Label, Icon, Color, IsDeduction,
                       ISNULL(Unit, 'PKR') AS Unit
                FROM BalanceCardTypes WHERE IsActive = 1
                ORDER BY IsDeduction ASC, CardTypeID ASC
            `);
            const cardTypes = ctResult.recordset;

            // Medical balances (non-admin employees only)
            const medResult = await deps.pool.request().query(`
                SELECT e.EmployeeID, e.Name,
                    ISNULL(m.Balance, 0)          AS MedicalBalance,
                    ISNULL(m.LoanBalance, 0)      AS LoanBalance,
                    ISNULL(m.LeavesRemaining, 0)  AS LeavesRemaining,
                    m.LastUpdatedOn AS MedUpdatedAt
                FROM Employees e
                LEFT JOIN MedicalBalances m ON m.EmployeeID = e.EmployeeID
                WHERE e.Role <> 'Admin'
                ORDER BY e.Name
            `);
            const empRows = medResult.recordset;

            // Custom card values (all at once)
            let valueMap = {};
            if (cardTypes.length) {
                const vResult = await deps.pool.request().query(`
                    SELECT v.CardTypeID, v.EmployeeID, v.Amount
                    FROM EmployeeBalanceValues v
                    INNER JOIN BalanceCardTypes ct ON ct.CardTypeID = v.CardTypeID
                    WHERE ct.IsActive = 1
                `);
                vResult.recordset.forEach(r => {
                    if (!valueMap[r.EmployeeID]) valueMap[r.EmployeeID] = {};
                    valueMap[r.EmployeeID][r.CardTypeID] = r.Amount;
                });
            }

            const employees = empRows.map(e => ({
                employeeId:     e.EmployeeID,
                name:           e.Name,
                medicalBalance: e.MedicalBalance,
                loanBalance:    e.LoanBalance,
                leavesRemaining: e.LeavesRemaining,
                medUpdatedAt:   e.MedUpdatedAt,
                cardAmounts:    cardTypes.reduce((acc, ct) => {
                    acc[ct.CardTypeID] = (valueMap[e.EmployeeID] || {})[ct.CardTypeID] ?? 0;
                    return acc;
                }, {}),
            }));

            res.json({ success: true, cardTypes, employees });
        } catch (err) {
            console.error('Balances overview:', err);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ===== Feedback =====
    app.get('/api/feedback/mine', authMiddleware, requireDb, async (req, res) => {
        try {
            const result = await deps.pool.request()
                .input('id', sql.Int, req.user.employeeId)
                .query(`
                    SELECT f.*, e.Name AS EmployeeName, r.Name AS ReviewedByName
                    FROM FeedbackItems f
                    INNER JOIN Employees e ON e.EmployeeID = f.EmployeeID
                    LEFT JOIN Employees r ON r.EmployeeID = f.ReviewedBy
                    WHERE f.EmployeeID = @id
                    ORDER BY f.DateSubmitted DESC
                `);
            res.json({ success: true, items: result.recordset.map(mapFeedback) });
        } catch (error) {
            console.error('Feedback mine:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.post('/api/feedback', authMiddleware, requireDb, async (req, res) => {
        try {
            const { category, title, description } = req.body;
            const cat = (category || '').trim();
            if (!['Suggestion', 'Complaint'].includes(cat)) {
                return res.status(400).json({ error: 'Category must be Suggestion or Complaint' });
            }
            if (!(title || '').trim() || !(description || '').trim()) {
                return res.status(400).json({ error: 'Title and description are required' });
            }
            const insert = await deps.pool.request()
                .input('employeeId', sql.Int, req.user.employeeId)
                .input('category', sql.NVarChar, cat)
                .input('title', sql.NVarChar, title.trim())
                .input('description', sql.NVarChar, description.trim())
                .query(`
                    INSERT INTO FeedbackItems (EmployeeID, Category, Title, Description)
                    OUTPUT INSERTED.FeedbackID
                    VALUES (@employeeId, @category, @title, @description)
                `);
            res.status(201).json({ success: true, id: insert.recordset[0].FeedbackID });
        } catch (error) {
            console.error('Feedback create:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.get('/api/feedback', authMiddleware, requireManagerOrAdmin, requireDb, async (req, res) => {
        try {
            const status = (req.query.status || '').trim();
            const request = deps.pool.request();
            let where = '1=1';
            if (status) {
                request.input('status', sql.NVarChar, status);
                where += ' AND f.Status = @status';
            }
            const result = await request.query(`
                SELECT f.*, e.Name AS EmployeeName, r.Name AS ReviewedByName
                FROM FeedbackItems f
                INNER JOIN Employees e ON e.EmployeeID = f.EmployeeID
                LEFT JOIN Employees r ON r.EmployeeID = f.ReviewedBy
                WHERE ${where}
                ORDER BY f.DateSubmitted DESC
            `);
            res.json({ success: true, items: result.recordset.map(mapFeedback) });
        } catch (error) {
            console.error('Feedback list:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.put('/api/feedback/:id', authMiddleware, requireManagerOrAdmin, requireDb, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            const status = (req.body.status || '').trim();
            const response = (req.body.response || '').trim();
            const allowed = ['Pending', 'Reviewed', 'Resolved'];
            if (status && !allowed.includes(status)) {
                return res.status(400).json({ error: 'Invalid status' });
            }
            await deps.pool.request()
                .input('id', sql.Int, id)
                .input('status', sql.NVarChar, status || 'Reviewed')
                .input('response', sql.NVarChar, response || null)
                .input('reviewedBy', sql.Int, req.user.employeeId)
                .query(`
                    UPDATE FeedbackItems SET
                        Status = COALESCE(NULLIF(@status, ''), Status),
                        Response = COALESCE(@response, Response),
                        ReviewedBy = @reviewedBy,
                        ReviewedAt = GETDATE()
                    WHERE FeedbackID = @id
                `);
            res.json({ success: true });
        } catch (error) {
            console.error('Feedback update:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ===== Job openings =====
    app.get('/api/jobs', authMiddleware, requireDb, async (req, res) => {
        try {
            const department = (req.query.department || '').trim();
            const search = (req.query.search || '').trim();
            const request = deps.pool.request();
            let where = `j.IsActive = 1 AND (j.ExpiryDate IS NULL OR j.ExpiryDate > GETDATE())`;
            if (department) {
                request.input('dept', sql.NVarChar, department);
                where += ' AND j.Department = @dept';
            }
            if (search) {
                request.input('search', sql.NVarChar, `%${search}%`);
                where += ' AND (j.Title LIKE @search OR j.Description LIKE @search OR j.Department LIKE @search)';
            }
            const result = await request.query(`
                SELECT j.*, e.Name AS PostedByName
                FROM JobOpenings j
                LEFT JOIN Employees e ON e.EmployeeID = j.PostedBy
                WHERE ${where}
                ORDER BY j.DatePosted DESC
            `);
            res.json({ success: true, jobs: result.recordset.map(mapJobOpening) });
        } catch (error) {
            console.error('Jobs list:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.get('/api/admin/jobs', authMiddleware, requireManagerOrAdmin, requireDb, async (req, res) => {
        try {
            const result = await deps.pool.request().query(`
                SELECT j.*, e.Name AS PostedByName FROM JobOpenings j
                LEFT JOIN Employees e ON e.EmployeeID = j.PostedBy
                ORDER BY j.DatePosted DESC
            `);
            res.json({ success: true, jobs: result.recordset.map(mapJobOpening) });
        } catch (error) {
            console.error('Admin jobs:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.post('/api/admin/jobs', authMiddleware, requireManagerOrAdmin, requireDb, async (req, res) => {
        try {
            const { title, department, description, qualifications, employmentType, expiryDate, isActive } = req.body;
            if (!(title || '').trim() || !(department || '').trim() || !(description || '').trim()) {
                return res.status(400).json({ error: 'Title, department, and description are required' });
            }
            const expiry = parseDeadline(expiryDate);
            if (expiry.error) return res.status(400).json({ error: expiry.error });

            const insert = await deps.pool.request()
                .input('title', sql.NVarChar, title.trim())
                .input('department', sql.NVarChar, department.trim())
                .input('description', sql.NVarChar, description.trim())
                .input('qualifications', sql.NVarChar, (qualifications || '').trim() || null)
                .input('employmentType', sql.NVarChar, (employmentType || '').trim() || null)
                .input('expiry', sql.DateTime2, expiry.date)
                .input('postedBy', sql.Int, req.user.employeeId)
                .input('isActive', sql.Bit, isActive === false ? 0 : 1)
                .query(`
                    INSERT INTO JobOpenings (Title, Department, Description, Qualifications, EmploymentType, ExpiryDate, PostedBy, IsActive)
                    OUTPUT INSERTED.JobID
                    VALUES (@title, @department, @description, @qualifications, @employmentType, @expiry, @postedBy, @isActive)
                `);
            res.status(201).json({ success: true, id: insert.recordset[0].JobID });
        } catch (error) {
            console.error('Job create:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.put('/api/admin/jobs/:id', authMiddleware, requireManagerOrAdmin, requireDb, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            const { title, department, description, qualifications, employmentType, expiryDate, isActive } = req.body;
            const expiry = parseDeadline(expiryDate);
            if (expiry.error) return res.status(400).json({ error: expiry.error });

            await deps.pool.request()
                .input('id', sql.Int, id)
                .input('title', sql.NVarChar, (title || '').trim())
                .input('department', sql.NVarChar, (department || '').trim())
                .input('description', sql.NVarChar, (description || '').trim())
                .input('qualifications', sql.NVarChar, (qualifications || '').trim() || null)
                .input('employmentType', sql.NVarChar, (employmentType || '').trim() || null)
                .input('expiry', sql.DateTime2, expiry.date)
                .input('isActive', sql.Bit, isActive === false ? 0 : 1)
                .query(`
                    UPDATE JobOpenings SET
                        Title = @title, Department = @department, Description = @description,
                        Qualifications = @qualifications, EmploymentType = @employmentType,
                        ExpiryDate = @expiry, IsActive = @isActive
                    WHERE JobID = @id
                `);
            res.json({ success: true });
        } catch (error) {
            console.error('Job update:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.delete('/api/admin/jobs/:id', authMiddleware, requireManagerOrAdmin, requireDb, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            await deps.pool.request()
                .input('id', sql.Int, id)
                .query('DELETE FROM JobOpenings WHERE JobID = @id');
            res.json({ success: true });
        } catch (error) {
            console.error('Job delete:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // CV upload multer — PDF/DOC/DOCX only, 10 MB, saved to uploads/cvs/
    const cvUpload = multer({
        storage: multer.diskStorage({
            destination(req, file, cb) {
                const dir = require('path').join(__dirname, '..', 'uploads', 'cvs');
                require('fs').mkdirSync(dir, { recursive: true });
                cb(null, dir);
            },
            filename(req, file, cb) {
                const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
                cb(null, `${req.user.employeeId}_${Date.now()}_${safe}`);
            },
        }),
        limits: { fileSize: 10 * 1024 * 1024 },
        fileFilter(req, file, cb) {
            const ok = /\.(pdf|doc|docx)$/i.test(file.originalname || '');
            cb(ok ? null : new Error('Only PDF or Word documents are allowed'), ok);
        },
    });

    // ── POST /api/jobs/:id/recommend — employee submits a referral (with optional CV) ──
    app.post('/api/jobs/:id/recommend', authMiddleware, requireDb, (req, res) => {
        cvUpload.single('cv')(req, res, async (uploadErr) => {
            if (uploadErr) return res.status(400).json({ error: uploadErr.message });
            try {
                const jobId = parseInt(req.params.id, 10);
                const { candidateName, fatherName, contactNo, email, linkedIn, recommendedBy } = req.body;

                if (!(candidateName || '').trim()) return res.status(400).json({ error: 'Candidate name is required' });
                if (!(fatherName   || '').trim()) return res.status(400).json({ error: 'Father name is required' });
                if (!(contactNo    || '').trim()) return res.status(400).json({ error: 'Contact number is required' });

                const jobCheck = await deps.pool.request()
                    .input('id', sql.Int, jobId)
                    .query(`SELECT JobID FROM JobOpenings WHERE JobID = @id AND IsActive = 1
                              AND (ExpiryDate IS NULL OR ExpiryDate > GETDATE())`);
                if (!jobCheck.recordset.length) return res.status(404).json({ error: 'Job not found or no longer active' });

                const cvPath = req.file ? `uploads/cvs/${req.file.filename}` : null;

                await deps.pool.request()
                    .input('jobId',          sql.Int,          jobId)
                    .input('candidateName',  sql.NVarChar,     candidateName.trim())
                    .input('fatherName',     sql.NVarChar,     fatherName.trim())
                    .input('contactNo',      sql.NVarChar,     contactNo.trim())
                    .input('email',          sql.NVarChar,     (email || '').trim() || null)
                    .input('linkedIn',       sql.NVarChar,     (linkedIn || '').trim() || null)
                    .input('recommendedBy',  sql.NVarChar,     (recommendedBy || '').trim() || null)
                    .input('submittedById',  sql.Int,          req.user.employeeId)
                    .input('cvPath',         sql.NVarChar(500),(cvPath || null))
                    .query(`
                        INSERT INTO JobRecommendations
                            (JobID, CandidateName, FatherName, ContactNo, Email, LinkedIn, RecommendedBy, SubmittedByID, CvFilePath)
                        VALUES
                            (@jobId, @candidateName, @fatherName, @contactNo, @email, @linkedIn, @recommendedBy, @submittedById, @cvPath)
                    `);

                res.status(201).json({ success: true, message: 'Recommendation submitted successfully' });
            } catch (error) {
                console.error('Job recommend:', error);
                res.status(500).json({ error: 'Server error' });
            }
        });
    });

    // ── GET /api/admin/jobs/:id/recommendations — admin views referrals ──
    app.get('/api/admin/jobs/:id/recommendations', authMiddleware, requireManagerOrAdmin, requireDb, async (req, res) => {
        try {
            const jobId = parseInt(req.params.id, 10);

            const jobRow = await deps.pool.request()
                .input('id', sql.Int, jobId)
                .query('SELECT Title, Department FROM JobOpenings WHERE JobID = @id');
            if (!jobRow.recordset.length) return res.status(404).json({ error: 'Job not found' });

            const result = await deps.pool.request()
                .input('jobId', sql.Int, jobId)
                .query(`
                    SELECT r.RecommendationID, r.CandidateName, r.FatherName, r.ContactNo,
                           r.Email, r.LinkedIn, r.RecommendedBy, r.SubmittedAt, r.CvFilePath,
                           e.Name AS SubmittedByName, e.Email AS SubmittedByEmail
                    FROM JobRecommendations r
                    LEFT JOIN Employees e ON e.EmployeeID = r.SubmittedByID
                    WHERE r.JobID = @jobId
                    ORDER BY r.SubmittedAt DESC
                `);

            res.json({
                success: true,
                job: jobRow.recordset[0],
                recommendations: result.recordset,
            });
        } catch (error) {
            console.error('Job recommendations:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ── GET /api/jobs/recommendations/:recId/cv — admin downloads candidate CV ──
    app.get('/api/jobs/recommendations/:recId/cv', authMiddleware, requireManagerOrAdmin, requireDb, async (req, res) => {
        try {
            const recId = parseInt(req.params.recId, 10);
            const row = await deps.pool.request()
                .input('id', sql.Int, recId)
                .query('SELECT CvFilePath, CandidateName FROM JobRecommendations WHERE RecommendationID = @id');
            if (!row.recordset[0] || !row.recordset[0].CvFilePath)
                return res.status(404).json({ error: 'CV not found' });

            const { CvFilePath, CandidateName } = row.recordset[0];
            const path = require('path');
            const fs   = require('fs');
            const fullPath = path.resolve(path.join(__dirname, '..', CvFilePath));

            if (!fs.existsSync(fullPath))
                return res.status(404).json({ error: 'File no longer on disk' });

            const ext      = path.extname(CvFilePath);
            const safeName = `CV_${CandidateName.replace(/[^a-zA-Z0-9]/g, '_')}${ext}`;
            const stat     = fs.statSync(fullPath);

            res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Length', stat.size);

            fs.createReadStream(fullPath).pipe(res);
        } catch (error) {
            console.error('CV download:', error);
            if (!res.headersSent) res.status(500).json({ error: 'Server error' });
        }
    });

    // GET /api/admin/task-logs — admin/manager reads all logs
    app.get('/api/admin/task-logs', authMiddleware, requireManagerOrAdmin, requireDb, async (req, res) => {
        try {
            const { date, employeeId } = req.query;
            let where = 'WHERE 1=1';
            const request = deps.pool.request();

            if (date) {
                request.input('date', sql.Date, new Date(date));
                where += ' AND l.LogDate = @date';
            }
            if (employeeId) {
                request.input('empId', sql.Int, parseInt(employeeId, 10));
                where += ' AND l.EmployeeID = @empId';
            }

            const result = await request.query(`
                SELECT l.LogID, l.LogDate, l.Client, l.Project, l.Activity,
                       l.StartTime, l.EndTime, l.Status, l.Notes, l.CreatedAt,
                       e.Name AS EmployeeName, e.EmployeeID
                FROM DailyTaskLogs l
                JOIN Employees e ON e.EmployeeID = l.EmployeeID
                ${where}
                ORDER BY l.LogDate DESC, e.Name, l.LogID DESC
            `);
            res.json({ success: true, logs: result.recordset });
        } catch (e) {
            console.error('Admin task logs:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ===== Training =====
    app.get('/api/training/courses', authMiddleware, requireDb, async (req, res) => {
        try {
            const result = await deps.pool.request().query(`
                SELECT c.*,
                    (SELECT COUNT(*) FROM TrainingEnrollments e WHERE e.CourseID = c.CourseID) AS EnrollmentCount
                FROM TrainingCourses c
                WHERE c.IsActive = 1
                ORDER BY c.CreatedAt DESC
            `);
            res.json({ success: true, courses: result.recordset.map(mapCourse) });
        } catch (error) {
            console.error('Training courses:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.get('/api/training/my-enrollments', authMiddleware, requireDb, async (req, res) => {
        try {
            const result = await deps.pool.request()
                .input('id', sql.Int, req.user.employeeId)
                .query(`
                    SELECT e.*, c.Title AS CourseTitle, c.Trainer, c.Category
                    FROM TrainingEnrollments e
                    INNER JOIN TrainingCourses c ON c.CourseID = e.CourseID
                    WHERE e.EmployeeID = @id
                    ORDER BY e.EnrolledAt DESC
                `);
            res.json({ success: true, enrollments: result.recordset.map(mapEnrollment) });
        } catch (error) {
            console.error('My enrollments:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.post('/api/training/enroll/:courseId', authMiddleware, requireDb, async (req, res) => {
        try {
            const courseId = parseInt(req.params.courseId, 10);
            const course = await deps.pool.request()
                .input('id', sql.Int, courseId)
                .query('SELECT * FROM TrainingCourses WHERE CourseID = @id AND IsActive = 1');
            if (!course.recordset[0]) {
                return res.status(404).json({ error: 'Course not found' });
            }
            const c = course.recordset[0];
            if (c.EnrollmentLimit) {
                const count = await deps.pool.request()
                    .input('id', sql.Int, courseId)
                    .query('SELECT COUNT(*) AS cnt FROM TrainingEnrollments WHERE CourseID = @id');
                if (count.recordset[0].cnt >= c.EnrollmentLimit) {
                    return res.status(400).json({ error: 'Course is full' });
                }
            }
            await deps.pool.request()
                .input('courseId', sql.Int, courseId)
                .input('employeeId', sql.Int, req.user.employeeId)
                .query(`
                    IF NOT EXISTS (SELECT 1 FROM TrainingEnrollments WHERE CourseID = @courseId AND EmployeeID = @employeeId)
                    INSERT INTO TrainingEnrollments (CourseID, EmployeeID) VALUES (@courseId, @employeeId)
                `);
            res.status(201).json({ success: true });
        } catch (error) {
            console.error('Enroll:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.get('/api/admin/training/courses', authMiddleware, requireAdmin, requireDb, async (req, res) => {
        try {
            const result = await deps.pool.request().query(`
                SELECT c.*,
                    (SELECT COUNT(*) FROM TrainingEnrollments e WHERE e.CourseID = c.CourseID) AS EnrollmentCount
                FROM TrainingCourses c ORDER BY c.CreatedAt DESC
            `);
            res.json({ success: true, courses: result.recordset.map(mapCourse) });
        } catch (error) {
            console.error('Admin courses:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.post('/api/admin/training/courses', authMiddleware, requireAdmin, requireDb, async (req, res) => {
        try {
            const {
                title, description, trainer, schedule, duration, category, enrollmentLimit, isActive,
            } = req.body;
            if (!(title || '').trim() || !(description || '').trim()) {
                return res.status(400).json({ error: 'Title and description are required' });
            }
            const insert = await deps.pool.request()
                .input('title', sql.NVarChar, title.trim())
                .input('description', sql.NVarChar, description.trim())
                .input('trainer', sql.NVarChar, (trainer || '').trim() || null)
                .input('schedule', sql.NVarChar, (schedule || '').trim() || null)
                .input('duration', sql.NVarChar, (duration || '').trim() || null)
                .input('category', sql.NVarChar, (category || '').trim() || null)
                .input('limit', sql.Int, enrollmentLimit ? parseInt(enrollmentLimit, 10) : null)
                .input('isActive', sql.Bit, isActive === false ? 0 : 1)
                .query(`
                    INSERT INTO TrainingCourses (Title, Description, Trainer, Schedule, Duration, Category, EnrollmentLimit, IsActive)
                    OUTPUT INSERTED.CourseID
                    VALUES (@title, @description, @trainer, @schedule, @duration, @category, @limit, @isActive)
                `);
            res.status(201).json({ success: true, id: insert.recordset[0].CourseID });
        } catch (error) {
            console.error('Course create:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.put('/api/admin/training/courses/:id', authMiddleware, requireAdmin, requireDb, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            const {
                title, description, trainer, schedule, duration, category, enrollmentLimit, isActive,
            } = req.body;
            await deps.pool.request()
                .input('id', sql.Int, id)
                .input('title', sql.NVarChar, (title || '').trim())
                .input('description', sql.NVarChar, (description || '').trim())
                .input('trainer', sql.NVarChar, (trainer || '').trim() || null)
                .input('schedule', sql.NVarChar, (schedule || '').trim() || null)
                .input('duration', sql.NVarChar, (duration || '').trim() || null)
                .input('category', sql.NVarChar, (category || '').trim() || null)
                .input('limit', sql.Int, enrollmentLimit ? parseInt(enrollmentLimit, 10) : null)
                .input('isActive', sql.Bit, isActive === false ? 0 : 1)
                .query(`
                    UPDATE TrainingCourses SET
                        Title = @title, Description = @description, Trainer = @trainer,
                        Schedule = @schedule, Duration = @duration, Category = @category,
                        EnrollmentLimit = @limit, IsActive = @isActive, UpdatedAt = GETDATE()
                    WHERE CourseID = @id
                `);
            res.json({ success: true });
        } catch (error) {
            console.error('Course update:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.delete('/api/admin/training/courses/:id', authMiddleware, requireAdmin, requireDb, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            await deps.pool.request()
                .input('id', sql.Int, id)
                .query('DELETE FROM TrainingCourses WHERE CourseID = @id');
            res.json({ success: true });
        } catch (error) {
            console.error('Course delete:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.get('/api/admin/training/progress', authMiddleware, requireManagerOrAdmin, requireDb, async (req, res) => {
        try {
            const courseId = req.query.courseId ? parseInt(req.query.courseId, 10) : null;
            const request = deps.pool.request();
            let where = '1=1';
            if (courseId) {
                request.input('courseId', sql.Int, courseId);
                where += ' AND e.CourseID = @courseId';
            }
            const result = await request.query(`
                SELECT en.*, c.Title AS CourseTitle, c.Trainer, c.Category, emp.Name AS EmployeeName
                FROM TrainingEnrollments en
                INNER JOIN TrainingCourses c ON c.CourseID = en.CourseID
                INNER JOIN Employees emp ON emp.EmployeeID = en.EmployeeID
                WHERE ${where}
                ORDER BY c.Title, emp.Name
            `);
            res.json({ success: true, enrollments: result.recordset.map(mapEnrollment) });
        } catch (error) {
            console.error('Training progress:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.put('/api/admin/training/enrollments/:id', authMiddleware, requireManagerOrAdmin, requireDb, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            const {
                status, progressPct, completionDate, certificationStatus,
            } = req.body;
            const pct = progressPct != null ? Math.min(100, Math.max(0, parseInt(progressPct, 10))) : null;
            await deps.pool.request()
                .input('id', sql.Int, id)
                .input('status', sql.NVarChar, status || null)
                .input('pct', sql.Int, pct)
                .input('completion', sql.DateTime2, completionDate ? new Date(completionDate) : null)
                .input('cert', sql.NVarChar, certificationStatus || null)
                .query(`
                    UPDATE TrainingEnrollments SET
                        Status = COALESCE(@status, Status),
                        ProgressPct = COALESCE(@pct, ProgressPct),
                        CompletionDate = COALESCE(@completion, CompletionDate),
                        CertificationStatus = COALESCE(@cert, CertificationStatus)
                    WHERE EnrollmentID = @id
                `);
            res.json({ success: true });
        } catch (error) {
            console.error('Enrollment update:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    /* ── Employee Document Upload (Recommendations / CVs) ── */

    const docUpload = multer({
        storage: multer.diskStorage({
            destination(req, file, cb) {
                const dir = require('path').join(__dirname, '..', 'uploads', 'docs');
                require('fs').mkdirSync(dir, { recursive: true });
                cb(null, dir);
            },
            filename(req, file, cb) {
                const ts   = Date.now();
                const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
                cb(null, `${req.user.employeeId}_${ts}_${safe}`);
            },
        }),
        limits: { fileSize: 10 * 1024 * 1024 },
        fileFilter(req, file, cb) {
            const ok = /\.(pdf|doc|docx|jpg|jpeg|png)$/i.test(file.originalname || '');
            cb(ok ? null : new Error('Only PDF, Word, or image files are allowed'), ok);
        },
    });

    // POST /api/documents — employee uploads a document
    app.post('/api/documents', authMiddleware, requireDb, (req, res) => {
        docUpload.single('file')(req, res, async (err) => {
            if (err) return res.status(400).json({ error: err.message });
            if (!req.file) return res.status(400).json({ error: 'No file provided' });

            try {
                const relPath  = `uploads/docs/${req.file.filename}`;
                const fileSizeKB = Math.ceil(req.file.size / 1024);

                const ins = await deps.pool.request()
                    .input('empId',  sql.Int,           req.user.employeeId)
                    .input('name',   sql.NVarChar(255),  req.file.originalname)
                    .input('path',   sql.NVarChar(500),  relPath)
                    .input('type',   sql.NVarChar(50),   req.file.mimetype || null)
                    .input('size',   sql.Int,            fileSizeKB)
                    .query(`
                        INSERT INTO EmployeeDocuments
                            (EmployeeID, FileName, FilePath, FileType, FileSizeKB)
                        OUTPUT INSERTED.*
                        VALUES (@empId, @name, @path, @type, @size)
                    `);
                res.status(201).json({ success: true, document: ins.recordset[0] });
            } catch (e) {
                console.error('Doc upload:', e);
                res.status(500).json({ error: 'Server error' });
            }
        });
    });

    // GET /api/documents — employee's own uploads
    app.get('/api/documents', authMiddleware, requireDb, async (req, res) => {
        try {
            const result = await deps.pool.request()
                .input('empId', sql.Int, req.user.employeeId)
                .query(`
                    SELECT DocID, FileName, FileSizeKB, FileType,
                           UploadDate, ReviewStatus, Notes
                    FROM EmployeeDocuments
                    WHERE EmployeeID = @empId
                    ORDER BY UploadDate DESC
                `);
            res.json({ success: true, documents: result.recordset });
        } catch (e) {
            console.error('List own docs:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // DELETE /api/documents/:id — employee deletes own upload
    app.delete('/api/documents/:id', authMiddleware, requireDb, async (req, res) => {
        try {
            const docId = parseInt(req.params.id, 10);
            const row = await deps.pool.request()
                .input('id',    sql.Int, docId)
                .input('empId', sql.Int, req.user.employeeId)
                .query('SELECT DocID, FilePath FROM EmployeeDocuments WHERE DocID = @id AND EmployeeID = @empId');
            if (!row.recordset[0]) return res.status(404).json({ error: 'Document not found' });

            // Remove file from disk
            try {
                const fullPath = require('path').join(__dirname, '..', row.recordset[0].FilePath);
                require('fs').unlinkSync(fullPath);
            } catch (_) {}

            await deps.pool.request()
                .input('id', sql.Int, docId)
                .query('DELETE FROM EmployeeDocuments WHERE DocID = @id');
            res.json({ success: true });
        } catch (e) {
            console.error('Delete doc:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // GET /api/documents/:id/download — admin downloads any file; employee downloads own
    app.get('/api/documents/:id/download', authMiddleware, requireDb, async (req, res) => {
        try {
            const docId = parseInt(req.params.id, 10);
            const isAdmin = isAdminRole(req.user.role) || req.user.role === 'Manager';

            const req2 = deps.pool.request().input('id', sql.Int, docId);
            if (!isAdmin) req2.input('empId', sql.Int, req.user.employeeId);

            const query = isAdmin
                ? 'SELECT * FROM EmployeeDocuments WHERE DocID = @id'
                : 'SELECT * FROM EmployeeDocuments WHERE DocID = @id AND EmployeeID = @empId';

            const row = await req2.query(query);
            if (!row.recordset[0]) return res.status(404).json({ error: 'Document not found' });

            const doc      = row.recordset[0];
            const fullPath = require('path').join(__dirname, '..', doc.FilePath);
            if (!require('fs').existsSync(fullPath))
                return res.status(404).json({ error: 'File no longer on disk' });

            res.setHeader('Content-Disposition', `attachment; filename="${doc.FileName}"`);
            res.setHeader('Content-Type', doc.FileType || 'application/octet-stream');
            res.sendFile(fullPath);
        } catch (e) {
            console.error('Download doc:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });
}

module.exports = { registerHrPortalRoutes };
