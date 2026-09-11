const { sql, masterConfig } = require('../config/database');

(async () => {
    try {
        console.log('Connecting:', masterConfig.connectionString);
        const pool = await sql.connect(masterConfig);
        const r = await pool.request().query('SELECT @@SERVERNAME AS s, DB_NAME() AS db');
        console.log('SUCCESS:', r.recordset[0]);
        await pool.close();
        process.exit(0);
    } catch (e) {
        console.error('FAIL:', e.message || e);
        if (e.originalError) console.error('Original:', e.originalError.message || e.originalError);
        process.exit(1);
    }
})();
