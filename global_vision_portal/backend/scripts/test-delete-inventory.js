const { sql, dbConfig } = require('../config/database');

(async () => {
    const pool = await sql.connect(dbConfig);
    const id = 12;
    try {
        await pool.request().input('id', sql.Int, id).query('DELETE FROM Inventory WHERE ItemID = @id');
        console.log('Delete OK', id);
    } catch (e) {
        console.error('Delete failed:', e.message);
    }
    await pool.close();
})();
