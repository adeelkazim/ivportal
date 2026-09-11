/**
 * Set the same bcrypt password for every active employee.
 * Usage: node scripts/sync-all-passwords.js YourPasswordHere
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const { sql, dbConfig } = require('../config/database');

async function run() {
    const password = process.argv[2];
    if (!password || password.length < 6) {
        console.error('Usage: node scripts/sync-all-passwords.js <password-min-6-chars>');
        process.exit(1);
    }

    const pool = await sql.connect(dbConfig);
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.request()
        .input('hash', sql.NVarChar, hash)
        .query(`
            UPDATE Employees SET PasswordHash = @hash, UpdatedAt = GETDATE()
            WHERE IsActive = 1 OR IsActive IS NULL
        `);

    console.log(`Updated passwords for ${result.rowsAffected[0]} employee(s).`);
    await pool.close();
}

run().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
});
