/**
 * Creates GlobalVisionPortal DB and core tables.
 * Seeds ONE bootstrap admin only when the database has no employees.
 * Run: npm run init-db
 */
const bcrypt = require('bcryptjs');
const { sql, masterConfig, dbConfig, DB_NAME } = require('../config/database');
const mssql = sql;

const BOOTSTRAP_EMAIL = (process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@globalvision.com').trim().toLowerCase();
const BOOTSTRAP_PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'ChangeMe123!';

async function run() {
    console.log('Connecting to (localdb)\\MSSQLLocalDB ...');
    let pool = await sql.connect(masterConfig);

    const dbExists = await pool.request().query(`
        SELECT name FROM sys.databases WHERE name = '${DB_NAME}'
    `);

    if (dbExists.recordset.length === 0) {
        console.log(`Creating database ${DB_NAME}...`);
        await pool.request().query(`CREATE DATABASE [${DB_NAME}]`);
    } else {
        console.log(`Database ${DB_NAME} already exists.`);
    }

    await pool.close();
    pool = await sql.connect(dbConfig);

    console.log('Creating tables...');
    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Teams')
        CREATE TABLE Teams (
            TeamID INT PRIMARY KEY IDENTITY(1,1),
            TeamName NVARCHAR(100) NOT NULL UNIQUE
        );

        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Employees')
        CREATE TABLE Employees (
            EmployeeID INT PRIMARY KEY IDENTITY(1,1),
            Name NVARCHAR(100) NOT NULL,
            Email NVARCHAR(100) UNIQUE NOT NULL,
            Department NVARCHAR(50) NOT NULL,
            Role NVARCHAR(50) NOT NULL,
            Contact NVARCHAR(20),
            PasswordHash NVARCHAR(255) NOT NULL,
            ProfileImageUrl NVARCHAR(MAX) NULL,
            FatherName NVARCHAR(100) NULL,
            Qualification NVARCHAR(200) NULL,
            Certifications NVARCHAR(MAX) NULL,
            CVFile NVARCHAR(MAX) NULL,
            AppointedOn DATE NULL,
            Designation NVARCHAR(100) NULL,
            TeamID INT NULL,
            IsActive BIT NOT NULL DEFAULT 1,
            CreatedAt DATETIME DEFAULT GETDATE(),
            UpdatedAt DATETIME DEFAULT GETDATE(),
            CONSTRAINT FK_Employees_Team FOREIGN KEY (TeamID) REFERENCES Teams(TeamID)
        );

        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Employees') AND name = 'IsActive')
            ALTER TABLE Employees ADD IsActive BIT NOT NULL DEFAULT 1;

        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Usernames')
        CREATE TABLE Usernames (
            UsernameID INT PRIMARY KEY IDENTITY(1,1),
            EmployeeID INT NOT NULL UNIQUE,
            Username NVARCHAR(100) NOT NULL UNIQUE,
            CONSTRAINT FK_Usernames_Employee FOREIGN KEY (EmployeeID)
                REFERENCES Employees(EmployeeID) ON DELETE CASCADE
        );

        IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IDX_Usernames_Username')
        CREATE INDEX IDX_Usernames_Username ON Usernames(Username);

        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Attendance')
        CREATE TABLE Attendance (
            AttendanceID INT PRIMARY KEY IDENTITY(1,1),
            EmployeeID INT NOT NULL FOREIGN KEY REFERENCES Employees(EmployeeID),
            Date DATE NOT NULL,
            LoginTime DATETIME NOT NULL,
            LogoutTime DATETIME,
            TotalHours DECIMAL(5,2),
            CreatedAt DATETIME DEFAULT GETDATE()
        );

        IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IDX_Attendance_EmployeeDate')
        CREATE INDEX IDX_Attendance_EmployeeDate ON Attendance(EmployeeID, Date);

        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Inventory')
        CREATE TABLE Inventory (
            ItemID INT PRIMARY KEY IDENTITY(1,1),
            ItemName NVARCHAR(100) NOT NULL,
            Quantity INT NOT NULL,
            AvailableQuantity INT NOT NULL,
            IssuedTo INT NULL,
            IssueDate DATETIME,
            ReturnDate DATETIME,
            Status NVARCHAR(50),
            CreatedAt DATETIME DEFAULT GETDATE(),
            UpdatedAt DATETIME DEFAULT GETDATE(),
            CONSTRAINT FK_Inventory_IssuedTo_Employee FOREIGN KEY (IssuedTo)
                REFERENCES Employees(EmployeeID)
        );

        IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IDX_Inventory_IssuedTo')
        CREATE INDEX IDX_Inventory_IssuedTo ON Inventory(IssuedTo);

        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'KnowledgeBase')
        CREATE TABLE KnowledgeBase (
            ProblemID INT PRIMARY KEY IDENTITY(1,1),
            Title NVARCHAR(200) NOT NULL,
            Description NVARCHAR(MAX) NOT NULL,
            Solution NVARCHAR(MAX) NOT NULL,
            Category NVARCHAR(100),
            AddedBy INT NOT NULL FOREIGN KEY REFERENCES Employees(EmployeeID),
            ViewCount INT DEFAULT 0,
            CreatedAt DATETIME DEFAULT GETDATE(),
            UpdatedAt DATETIME DEFAULT GETDATE()
        );

        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Tasks')
        CREATE TABLE Tasks (
            TaskID INT PRIMARY KEY IDENTITY(1,1),
            Title NVARCHAR(200) NOT NULL,
            Description NVARCHAR(MAX),
            AssignedTo INT NOT NULL FOREIGN KEY REFERENCES Employees(EmployeeID),
            AssignedBy INT NOT NULL FOREIGN KEY REFERENCES Employees(EmployeeID),
            Status NVARCHAR(50) NOT NULL,
            Priority NVARCHAR(50),
            Deadline DATETIME,
            CompletedDate DATETIME,
            CreatedAt DATETIME DEFAULT GETDATE(),
            UpdatedAt DATETIME DEFAULT GETDATE()
        );
    `);

    const countResult = await pool.request().query('SELECT COUNT(*) AS cnt FROM Employees');
    const employeeCount = countResult.recordset[0].cnt;

    if (employeeCount === 0) {
        console.log('No employees found — creating bootstrap administrator...');
        const hash = await bcrypt.hash(BOOTSTRAP_PASSWORD, 10);
        await pool.request()
            .input('hash', mssql.NVarChar, hash)
            .input('email', mssql.NVarChar, BOOTSTRAP_EMAIL)
            .query(`
            IF NOT EXISTS (SELECT 1 FROM Teams)
            INSERT INTO Teams (TeamName) VALUES ('IT'), ('Operations');

            INSERT INTO Employees (Name, Email, Department, Role, Contact, PasswordHash, Designation, TeamID, IsActive)
            VALUES ('Portal Administrator', @email, 'IT', 'Admin', '', @hash, 'Administrator', 1, 1);

            INSERT INTO Usernames (EmployeeID, Username)
            SELECT EmployeeID, LOWER(LEFT(Email, CHARINDEX('@', Email) - 1))
            FROM Employees WHERE Email = @email;
        `);
        console.log(`Bootstrap admin: ${BOOTSTRAP_EMAIL}`);
        console.log(`Bootstrap password: ${BOOTSTRAP_PASSWORD} (change after first login)`);
    } else {
        console.log(`${employeeCount} employee(s) already exist — passwords were NOT changed.`);
        console.log('To reset one user: npm run set-password -- email@company.com NewPass');
        console.log('To reset all active users: npm run sync-passwords -- NewPass');
    }

    await pool.close();
    console.log('Database ready.');
}

run().catch((err) => {
    console.error('Init failed:', err.message);
    if (err.message.includes('certificate') || err.message.includes('encrypt')) {
        console.error('Tip: Set TRUST_SERVER_CERTIFICATE=true in backend/.env for LocalDB.');
    }
    process.exit(1);
});
