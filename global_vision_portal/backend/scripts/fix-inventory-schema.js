const { sql, dbConfig } = require('../config/database');

(async () => {
    const pool = await sql.connect(dbConfig);
    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Inventory') AND name = 'RequestNotes')
            ALTER TABLE Inventory ADD RequestNotes NVARCHAR(MAX) NULL;
    `);
    console.log('RequestNotes column ensured.');
    await pool.close();
})().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
