/**
 * Remove legacy demo accounts (john, alice, bob). Keeps admin@globalvision.com unless --all-demo.
 * Usage: node scripts/remove-demo-users.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { sql, dbConfig } = require('../config/database');

const DEMO_EMAILS = [
    'john@globalvision.com',
    'alice@globalvision.com',
    'bob@globalvision.com',
];

async function run() {
    const removeAdmin = process.argv.includes('--all-demo');
    const emails = removeAdmin
        ? [...DEMO_EMAILS, 'admin@globalvision.com']
        : DEMO_EMAILS;

    const pool = await sql.connect(dbConfig);

    const adminRow = await pool.request().query(`
        SELECT TOP 1 EmployeeID FROM Employees WHERE LOWER(Role) = 'admin' ORDER BY EmployeeID
    `);
    const fallbackAdminId = adminRow.recordset[0]?.EmployeeID;

    for (const email of emails) {
        const found = await pool.request()
            .input('email', sql.NVarChar, email.toLowerCase())
            .query('SELECT EmployeeID, Name FROM Employees WHERE LOWER(Email) = @email');

        const row = found.recordset[0];
        if (!row) {
            console.log('Skip (not found):', email);
            continue;
        }

        const id = row.EmployeeID;
        const reassignTo = fallbackAdminId && fallbackAdminId !== id ? fallbackAdminId : null;

        if (reassignTo) {
            await pool.request()
                .input('id', sql.Int, id)
                .input('adminId', sql.Int, reassignTo)
                .query(`
                    UPDATE Tasks SET AssignedTo = @adminId WHERE AssignedTo = @id;
                    UPDATE Tasks SET AssignedBy = @adminId WHERE AssignedBy = @id;
                    UPDATE Inventory SET IssuedTo = NULL WHERE IssuedTo = @id;
                    UPDATE KnowledgeBase SET AddedBy = @adminId WHERE AddedBy = @id;
                `);
        } else {
            await pool.request()
                .input('id', sql.Int, id)
                .query(`
                    DELETE FROM Tasks WHERE AssignedTo = @id OR AssignedBy = @id;
                    UPDATE Inventory SET IssuedTo = NULL WHERE IssuedTo = @id;
                `);
        }

        await pool.request()
            .input('id', sql.Int, id)
            .query(`
                DELETE FROM Attendance WHERE EmployeeID = @id;
                DELETE FROM TrainingEnrollments WHERE EmployeeID = @id;
                DELETE FROM MedicalBalances WHERE EmployeeID = @id;
                DELETE FROM FeedbackItems WHERE EmployeeID = @id;
                DELETE FROM AnnouncementRecipients WHERE EmployeeID = @id;
            `);

        await pool.request()
            .input('id', sql.Int, id)
            .query('DELETE FROM Employees WHERE EmployeeID = @id');

        console.log('Removed:', row.Name, email);
    }

    const remaining = await pool.request().query('SELECT COUNT(*) AS c FROM Employees');
    console.log('Employees remaining:', remaining.recordset[0].c);
    await pool.close();
}

run().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
});
