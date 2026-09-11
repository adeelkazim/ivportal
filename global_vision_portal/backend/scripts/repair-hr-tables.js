/**
 * Drops broken HR tables (if any) and recreates them.
 * Use when startup fails with constraint/index errors on MedicalBalances etc.
 * Run: node scripts/repair-hr-tables.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { sql, dbConfig } = require('../config/database');
const { ensureHrPortalTables } = require('../services/hrPortal');

async function run() {
    const pool = await sql.connect(dbConfig);
    console.log('Dropping HR tables (if present)...');
    await pool.request().query(`
        IF OBJECT_ID('TrainingEnrollments', 'U') IS NOT NULL DROP TABLE TrainingEnrollments;
        IF OBJECT_ID('TrainingCourses', 'U') IS NOT NULL DROP TABLE TrainingCourses;
        IF OBJECT_ID('JobOpenings', 'U') IS NOT NULL DROP TABLE JobOpenings;
        IF OBJECT_ID('FeedbackItems', 'U') IS NOT NULL DROP TABLE FeedbackItems;
        IF OBJECT_ID('MedicalBalances', 'U') IS NOT NULL DROP TABLE MedicalBalances;
    `);
    console.log('Recreating HR tables...');
    await ensureHrPortalTables(pool);
    console.log('Done. Restart the backend (npm start).');
    await pool.close();
}

run().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
});
