require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const { sql, dbConfig } = require('../config/database');

async function run() {
    const pool = await sql.connect(dbConfig);
    const r = await pool.request().query(`
        SELECT e.EmployeeID, e.Email, e.PasswordHash, e.IsActive, e.Role, u.Username
        FROM Employees e
        LEFT JOIN Usernames u ON u.EmployeeID = e.EmployeeID
        WHERE e.Email LIKE '%faizan%' OR u.Username LIKE '%faizan%'
    `);
    console.log('Found:', r.recordset);
    for (const row of r.recordset) {
        const ok = await bcrypt.compare('12345678', row.PasswordHash);
        console.log(`Password 12345678 matches for ${row.Email}:`, ok);
    }
    await pool.close();
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
