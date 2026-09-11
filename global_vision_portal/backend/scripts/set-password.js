/**
 * Reset an employee password (bcrypt).
 * Usage: node scripts/set-password.js faizanzeeshan444@gmail.com 12345678
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const { sql, dbConfig } = require('../config/database');

async function run() {
    const login = (process.argv[2] || '').trim().toLowerCase();
    const password = process.argv[3];
    if (!login || !password) {
        console.error('Usage: node scripts/set-password.js <email-or-username> <new-password>');
        process.exit(1);
    }

    const pool = await sql.connect(dbConfig);
    const found = await pool.request()
        .input('loginKey', sql.NVarChar, login)
        .query(`
            SELECT e.EmployeeID, e.Email, e.Name
            FROM Employees e
            LEFT JOIN Usernames u ON u.EmployeeID = e.EmployeeID
            WHERE LOWER(LTRIM(e.Email)) = @loginKey OR LOWER(LTRIM(u.Username)) = @loginKey
        `);

    const row = found.recordset[0];
    if (!row) {
        console.error('No employee found for:', login);
        process.exit(1);
    }

    const hash = await bcrypt.hash(password, 10);
    await pool.request()
        .input('id', sql.Int, row.EmployeeID)
        .input('hash', sql.NVarChar, hash)
        .query('UPDATE Employees SET PasswordHash = @hash, UpdatedAt = GETDATE() WHERE EmployeeID = @id');

    console.log(`Password updated for ${row.Name} (${row.Email})`);
    await pool.close();
}

run().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
});
