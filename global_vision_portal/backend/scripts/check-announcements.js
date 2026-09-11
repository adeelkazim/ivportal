require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const sql = require('mssql');

async function main() {
    const pool = await sql.connect({
        server: process.env.DB_SERVER || '(localdb)\\MSSQLLocalDB',
        database: process.env.DB_NAME || 'GlobalVisionPortal',
        options: { trustServerCertificate: true, enableArithAbort: true },
    });

    const ann = await pool.request().query(`
        SELECT TOP 15 AnnouncementID, Title, TargetType, IsActive, ExpiresAt, CreatedAt
        FROM Announcements ORDER BY AnnouncementID DESC
    `);
    console.log('Announcements:', ann.recordset);

    const rec = await pool.request().query(`
        SELECT r.AnnouncementID, r.EmployeeID, e.Name, e.Email
        FROM AnnouncementRecipients r
        LEFT JOIN Employees e ON e.EmployeeID = r.EmployeeID
        ORDER BY r.AnnouncementID DESC
    `);
    console.log('Recipients:', rec.recordset);

    const emps = await pool.request().query(`
        SELECT EmployeeID, Name, Email, Role FROM Employees ORDER BY EmployeeID
    `);
    console.log('Employees:', emps.recordset);

    await pool.close();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
