/**
 * SQL Server LocalDB via ODBC — SQL Server Authentication
 * Server=(localdb)\MSSQLLocalDB; UID=globalvision; PWD=***
 */
const dotenv = require('dotenv');
dotenv.config();

const sql = require('mssql/msnodesqlv8');

const DB_SERVER  = process.env.DB_SERVER   || '(localdb)\\MSSQLLocalDB';
const DB_NAME    = process.env.DB_NAME     || 'GlobalVisionPortal';
const DB_USER    = process.env.DB_USER     || 'globalvision';
const DB_PASS    = process.env.DB_PASSWORD || '123';
const DRIVER     = process.env.ODBC_DRIVER || 'ODBC Driver 18 for SQL Server';
const TRUST_CERT = process.env.TRUST_SERVER_CERTIFICATE !== 'false';
const ENCRYPT    = process.env.DB_ENCRYPT  !== 'false';

function buildConnectionString(database) {
    return (
        `Driver={${DRIVER}};` +
        `Server=${DB_SERVER};` +
        `Database=${database};` +
        `UID=${DB_USER};` +
        `PWD=${DB_PASS};` +
        `Encrypt=${ENCRYPT ? 'Yes' : 'No'};` +
        `TrustServerCertificate=${TRUST_CERT ? 'Yes' : 'No'};`
    );
}

const connectionString       = buildConnectionString(DB_NAME);
const masterConnectionString = buildConnectionString('master');

const dbConfig     = { connectionString };
const masterConfig = { connectionString: masterConnectionString };

module.exports = {
    sql,
    dbConfig,
    masterConfig,
    DB_NAME,
    buildConnectionString
};
