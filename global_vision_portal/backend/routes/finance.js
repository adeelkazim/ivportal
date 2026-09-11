const XLSX = require('xlsx');
const { sql } = require('../config/database');
const { authMiddleware, requireFinanceManager } = require('../middleware/auth');

function registerFinanceRoutes(app, deps) {
    function requireDb(req, res, next) {
        if (!deps.dbConnected || !deps.pool) {
            return res.status(503).json({ error: 'Database unavailable' });
        }
        next();
    }

    const mw = [authMiddleware, requireFinanceManager, requireDb];

    // ===== Dashboard stats =====
    app.get('/api/finance/stats', ...mw, async (req, res) => {
        try {
            const [loanRes, balRes] = await Promise.all([
                deps.pool.request().query(`
                    SELECT
                        COUNT(*)                                          AS TotalLoans,
                        SUM(CASE WHEN Status='Active' THEN 1 ELSE 0 END) AS ActiveLoans,
                        ISNULL(SUM(LoanAmount), 0)                        AS TotalIssued,
                        ISNULL(SUM(PaidAmount), 0)                        AS TotalPaid,
                        ISNULL(SUM(CASE WHEN Status='Active'
                            THEN LoanAmount - PaidAmount ELSE 0 END), 0)  AS TotalOutstanding
                    FROM FinanceLoans
                `),
                deps.pool.request().query(`
                    SELECT
                        COUNT(*)                        AS TotalEmployees,
                        ISNULL(SUM(Balance), 0)         AS TotalMedical,
                        ISNULL(SUM(LoanBalance), 0)     AS TotalLoanBalance
                    FROM MedicalBalances
                `),
            ]);
            res.json({ success: true, loans: loanRes.recordset[0], balances: balRes.recordset[0] });
        } catch (e) {
            console.error('Finance stats:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ===== Loans — list =====
    app.get('/api/finance/loans', ...mw, async (req, res) => {
        try {
            const result = await deps.pool.request().query(`
                SELECT l.LoanID, l.EmployeeID, e.Name AS EmployeeName, e.Designation, t.TeamName,
                       l.LoanAmount, l.PaidAmount,
                       ROUND(l.LoanAmount - l.PaidAmount, 2) AS Remaining,
                       l.Purpose, l.IssuedDate, l.DueDate, l.Status, l.Notes,
                       l.CreatedAt, l.UpdatedAt,
                       c.Name AS CreatedByName
                FROM FinanceLoans l
                INNER JOIN Employees e ON e.EmployeeID = l.EmployeeID
                LEFT JOIN Teams t ON t.TeamID = e.TeamID
                LEFT JOIN Employees c ON c.EmployeeID = l.CreatedBy
                ORDER BY l.CreatedAt DESC
            `);
            res.json({ success: true, loans: result.recordset });
        } catch (e) {
            console.error('Finance loans list:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ===== Loans — create =====
    app.post('/api/finance/loans', ...mw, async (req, res) => {
        try {
            const { employeeId, loanAmount, purpose, issuedDate, dueDate, notes } = req.body;
            if (!employeeId || !loanAmount) {
                return res.status(400).json({ error: 'employeeId and loanAmount are required' });
            }
            const amount = parseFloat(loanAmount);
            if (isNaN(amount) || amount <= 0) {
                return res.status(400).json({ error: 'loanAmount must be a positive number' });
            }

            const result = await deps.pool.request()
                .input('empId',     sql.Int,            parseInt(employeeId, 10))
                .input('amount',    sql.Decimal(12, 2), amount)
                .input('purpose',   sql.NVarChar(500),  purpose   || null)
                .input('issued',    sql.Date,           issuedDate ? new Date(issuedDate) : new Date())
                .input('due',       sql.Date,           dueDate    ? new Date(dueDate)    : null)
                .input('notes',     sql.NVarChar(sql.MAX), notes   || null)
                .input('createdBy', sql.Int,            req.user.employeeId)
                .query(`
                    INSERT INTO FinanceLoans (EmployeeID, LoanAmount, Purpose, IssuedDate, DueDate, Notes, CreatedBy)
                    OUTPUT INSERTED.*
                    VALUES (@empId, @amount, @purpose, @issued, @due, @notes, @createdBy)
                `);
            res.status(201).json({ success: true, loan: result.recordset[0] });
        } catch (e) {
            console.error('Finance create loan:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ===== Loans — update (record payment / edit / change status) =====
    app.put('/api/finance/loans/:id(\\d+)', ...mw, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            const { paidAmount, loanAmount, purpose, dueDate, status, notes } = req.body;

            const existing = await deps.pool.request()
                .input('id', sql.Int, id)
                .query('SELECT * FROM FinanceLoans WHERE LoanID = @id');
            if (!existing.recordset[0]) return res.status(404).json({ error: 'Loan not found' });

            const cur = existing.recordset[0];
            const newPaid   = paidAmount  != null ? parseFloat(paidAmount)  : cur.PaidAmount;
            const newAmount = loanAmount  != null ? parseFloat(loanAmount)  : cur.LoanAmount;
            const newStatus = status      || (newPaid >= newAmount ? 'Paid' : cur.Status);

            await deps.pool.request()
                .input('id',         sql.Int,            id)
                .input('paid',       sql.Decimal(12, 2), newPaid)
                .input('amount',     sql.Decimal(12, 2), newAmount)
                .input('purpose',    sql.NVarChar(500),  purpose  ?? cur.Purpose)
                .input('due',        sql.Date,           dueDate  ? new Date(dueDate) : cur.DueDate)
                .input('status',     sql.NVarChar(20),   newStatus)
                .input('notes',      sql.NVarChar(sql.MAX), notes ?? cur.Notes)
                .query(`
                    UPDATE FinanceLoans SET
                        PaidAmount = @paid, LoanAmount = @amount,
                        Purpose = @purpose, DueDate = @due,
                        Status = @status, Notes = @notes,
                        UpdatedAt = GETDATE()
                    WHERE LoanID = @id
                `);
            res.json({ success: true });
        } catch (e) {
            console.error('Finance update loan:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ===== Loans — delete/cancel =====
    app.delete('/api/finance/loans/:id(\\d+)', ...mw, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            await deps.pool.request()
                .input('id', sql.Int, id)
                .query(`UPDATE FinanceLoans SET Status = 'Cancelled', UpdatedAt = GETDATE() WHERE LoanID = @id`);
            res.json({ success: true });
        } catch (e) {
            console.error('Finance cancel loan:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ===== Medical balances — list all =====
    app.get('/api/finance/medical-balances', ...mw, async (req, res) => {
        try {
            const result = await deps.pool.request().query(`
                SELECT e.EmployeeID, e.Name, e.Designation, t.TeamName,
                       ISNULL(m.Balance, 0)      AS MedicalBalance,
                       ISNULL(m.LoanBalance, 0)  AS LoanBalance,
                       m.UpdatedAt
                FROM Employees e
                LEFT JOIN Teams t ON t.TeamID = e.TeamID
                LEFT JOIN MedicalBalances m ON m.EmployeeID = e.EmployeeID
                WHERE ISNULL(e.IsActive, 1) = 1 AND e.Role <> 'Admin'
                ORDER BY e.Name
            `);
            res.json({ success: true, balances: result.recordset });
        } catch (e) {
            console.error('Finance medical balances:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ===== Medical balances — update single employee =====
    app.put('/api/finance/medical-balances/:employeeId(\\d+)', ...mw, async (req, res) => {
        try {
            const empId   = parseInt(req.params.employeeId, 10);
            const balance = req.body.balance != null ? parseFloat(req.body.balance) : null;
            const loan    = req.body.loanBalance != null ? parseFloat(req.body.loanBalance) : null;

            if (balance === null && loan === null) {
                return res.status(400).json({ error: 'Provide balance or loanBalance' });
            }

            await deps.pool.request()
                .input('empId',   sql.Int,            empId)
                .input('bal',     sql.Decimal(12, 2), balance ?? 0)
                .input('loan',    sql.Decimal(12, 2), loan    ?? 0)
                .input('updBy',   sql.Int,            req.user.employeeId)
                .query(`
                    MERGE MedicalBalances AS target
                    USING (SELECT @empId AS EmployeeID) AS src ON target.EmployeeID = src.EmployeeID
                    WHEN MATCHED THEN
                        UPDATE SET Balance = @bal, LoanBalance = @loan, UpdatedBy = @updBy, UpdatedAt = GETDATE()
                    WHEN NOT MATCHED THEN
                        INSERT (EmployeeID, Balance, LoanBalance, UpdatedBy)
                        VALUES (@empId, @bal, @loan, @updBy);
                `);
            res.json({ success: true });
        } catch (e) {
            console.error('Finance update medical balance:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ===== Export XLSX =====
    app.get('/api/finance/export', ...mw, async (req, res) => {
        try {
            const [loanRes, balRes] = await Promise.all([
                deps.pool.request().query(`
                    SELECT e.Name, e.Designation, t.TeamName,
                           l.LoanAmount, l.PaidAmount,
                           ROUND(l.LoanAmount - l.PaidAmount, 2) AS Remaining,
                           l.Purpose, l.Status,
                           CONVERT(VARCHAR,l.IssuedDate,23) AS IssuedDate,
                           CONVERT(VARCHAR,l.DueDate,23)    AS DueDate,
                           l.Notes
                    FROM FinanceLoans l
                    INNER JOIN Employees e ON e.EmployeeID = l.EmployeeID
                    LEFT JOIN Teams t ON t.TeamID = e.TeamID
                    ORDER BY l.CreatedAt DESC
                `),
                deps.pool.request().query(`
                    SELECT e.Name, e.Designation, t.TeamName,
                           ISNULL(m.Balance,0)     AS MedicalBalance,
                           ISNULL(m.LoanBalance,0) AS LoanBalance
                    FROM Employees e
                    LEFT JOIN Teams t ON t.TeamID = e.TeamID
                    LEFT JOIN MedicalBalances m ON m.EmployeeID = e.EmployeeID
                    WHERE ISNULL(e.IsActive,1)=1 AND e.Role <> 'Admin'
                    ORDER BY e.Name
                `),
            ]);

            const wb = XLSX.utils.book_new();

            const loanRows = loanRes.recordset.map((r, i) => ({
                '#': i + 1, 'Employee': r.Name, 'Designation': r.Designation,
                'Team': r.TeamName || '', 'Loan Amount': r.LoanAmount,
                'Paid': r.PaidAmount, 'Remaining': r.Remaining,
                'Purpose': r.Purpose || '', 'Status': r.Status,
                'Issued': r.IssuedDate || '', 'Due': r.DueDate || '',
                'Notes': r.Notes || '',
            }));
            const wsLoans = XLSX.utils.json_to_sheet(loanRows.length ? loanRows : [{}]);
            wsLoans['!cols'] = [{wch:4},{wch:22},{wch:18},{wch:16},{wch:14},{wch:12},{wch:12},{wch:24},{wch:12},{wch:14},{wch:14},{wch:24}];
            XLSX.utils.book_append_sheet(wb, wsLoans, 'Loans');

            const balRows = balRes.recordset.map((r, i) => ({
                '#': i + 1, 'Employee': r.Name, 'Designation': r.Designation,
                'Team': r.TeamName || '', 'Medical Balance': r.MedicalBalance, 'Loan Balance': r.LoanBalance,
            }));
            const wsBal = XLSX.utils.json_to_sheet(balRows.length ? balRows : [{}]);
            wsBal['!cols'] = [{wch:4},{wch:22},{wch:18},{wch:16},{wch:16},{wch:14}];
            XLSX.utils.book_append_sheet(wb, wsBal, 'Medical Balances');

            const buf = XLSX.write(wb, { type:'buffer', bookType:'xlsx' });
            const date = new Date().toISOString().split('T')[0];
            res.setHeader('Content-Disposition', `attachment; filename="finance_report_${date}.xlsx"`);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
            res.send(buf);
        } catch (e) {
            console.error('Finance export:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });
}

module.exports = { registerFinanceRoutes };
