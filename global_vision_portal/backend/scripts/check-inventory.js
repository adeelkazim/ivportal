const { sql, dbConfig } = require('../config/database');

(async () => {
    const pool = await sql.connect(dbConfig);
    const cols = await pool.request().query(`
        SELECT c.name FROM sys.columns c
        INNER JOIN sys.tables t ON c.object_id = t.object_id
        WHERE t.name = 'Inventory'
    `);
    console.log('Columns:', cols.recordset.map((r) => r.name).join(', '));

    const items = await pool.request().query(
        "SELECT ItemID, ItemName, Status FROM Inventory WHERE Status = 'Requested'"
    );
    console.log('Requested items:', items.recordset);

    await pool.close();
})().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
