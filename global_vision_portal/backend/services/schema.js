/**
 * Ensures database tables/columns exist on server startup
 */

async function ensureUsernamesTable(pool) {
    await pool.request().query(`
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
    `);

    await pool.request().query(`
        INSERT INTO Usernames (EmployeeID, Username)
        SELECT e.EmployeeID,
            LOWER(LEFT(e.Email, NULLIF(CHARINDEX('@', e.Email), 0) - 1))
        FROM Employees e
        WHERE CHARINDEX('@', e.Email) > 1
          AND NOT EXISTS (SELECT 1 FROM Usernames u WHERE u.EmployeeID = e.EmployeeID);
    `);
}

async function ensureEmployeeProfileColumns(pool) {
    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Employees') AND name = 'ProfileImageUrl')
            ALTER TABLE Employees ADD ProfileImageUrl NVARCHAR(MAX) NULL;

        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Employees') AND name = 'FatherName')
            ALTER TABLE Employees ADD FatherName NVARCHAR(100) NULL;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Employees') AND name = 'Qualification')
            ALTER TABLE Employees ADD Qualification NVARCHAR(200) NULL;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Employees') AND name = 'Certifications')
            ALTER TABLE Employees ADD Certifications NVARCHAR(MAX) NULL;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Employees') AND name = 'CVFile')
            ALTER TABLE Employees ADD CVFile NVARCHAR(MAX) NULL;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Employees') AND name = 'AppointedOn')
            ALTER TABLE Employees ADD AppointedOn DATE NULL;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Employees') AND name = 'Designation')
            ALTER TABLE Employees ADD Designation NVARCHAR(100) NULL;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Employees') AND name = 'TeamID')
            ALTER TABLE Employees ADD TeamID INT NULL;
    `);
}

async function ensureTeamsTable(pool) {
    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Teams')
        CREATE TABLE Teams (
            TeamID INT PRIMARY KEY IDENTITY(1,1),
            TeamName NVARCHAR(100) NOT NULL UNIQUE
        );
    `);

    await pool.request().query(`
        IF NOT EXISTS (SELECT 1 FROM Teams)
        INSERT INTO Teams (TeamName) VALUES
            ('Engineering'), ('Sales'), ('Marketing'), ('HR'), ('Finance'), ('IT'), ('Operations');
    `);
}

async function ensureInventoryColumns(pool) {
    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Inventory') AND name = 'DeskNo')
            ALTER TABLE Inventory ADD DeskNo NVARCHAR(50) NULL;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Inventory') AND name = 'ExternalItemId')
            ALTER TABLE Inventory ADD ExternalItemId NVARCHAR(50) NULL;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Inventory') AND name = 'RequestNotes')
            ALTER TABLE Inventory ADD RequestNotes NVARCHAR(MAX) NULL;
    `);
}

async function ensureInventoryEmployeeLink(pool) {
    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IDX_Inventory_IssuedTo')
            CREATE INDEX IDX_Inventory_IssuedTo ON Inventory(IssuedTo);
    `);
}

async function removeDepartmentColumn(pool) {
    await pool.request().query(`
        DECLARE @con NVARCHAR(256);
        SELECT @con = dc.name
        FROM sys.default_constraints dc
        INNER JOIN sys.columns c ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
        WHERE c.object_id = OBJECT_ID('Employees') AND c.name = 'Department';
        IF @con IS NOT NULL EXEC('ALTER TABLE Employees DROP CONSTRAINT [' + @con + ']');
    `);
    await pool.request().query(`
        IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Employees') AND name = 'Department')
            ALTER TABLE Employees DROP COLUMN Department;
    `);
    await pool.request().query(`
        IF EXISTS (SELECT * FROM sys.tables WHERE name = 'Departments')
            DROP TABLE Departments;
    `);
}

async function ensureClientsTable(pool) {
    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Clients')
        CREATE TABLE Clients (
            cliClientID INT PRIMARY KEY IDENTITY(1,1),
            cliClientName NVARCHAR(100) NOT NULL UNIQUE
        );
    `);

    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Employees') AND name = 'ClientID')
            ALTER TABLE Employees ADD ClientID INT NULL;
    `);

    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_Employees_Client')
            ALTER TABLE Employees ADD CONSTRAINT FK_Employees_Client FOREIGN KEY (ClientID) REFERENCES Clients(cliClientID);
    `);
}

async function ensureAnnouncementCategories(pool) {
    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AnnouncementCategories')
        CREATE TABLE AnnouncementCategories (
            CategoryID   INT PRIMARY KEY IDENTITY(1,1),
            CategoryName NVARCHAR(100) NOT NULL UNIQUE,
            CreatedAt    DATETIME2 NOT NULL DEFAULT GETDATE()
        );

        IF NOT EXISTS (SELECT 1 FROM AnnouncementCategories)
        INSERT INTO AnnouncementCategories (CategoryName) VALUES
            ('General'), ('Policy Update'), ('HR Notice'), ('IT & Systems'), ('Events');

        IF NOT EXISTS (SELECT * FROM sys.columns
                       WHERE object_id = OBJECT_ID('Announcements') AND name = 'Category')
            ALTER TABLE Announcements ADD Category NVARCHAR(100) NULL;
    `);
}

async function ensureTasksExtendedColumns(pool) {
    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Tasks') AND name = 'StartTime')
            ALTER TABLE Tasks ADD StartTime DATETIME2 NULL;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Tasks') AND name = 'EndTime')
            ALTER TABLE Tasks ADD EndTime DATETIME2 NULL;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Tasks') AND name = 'TeamID')
            ALTER TABLE Tasks ADD TeamID INT NULL;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Tasks') AND name = 'ClientID')
            ALTER TABLE Tasks ADD ClientID INT NULL;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Tasks') AND name = 'Project')
            ALTER TABLE Tasks ADD Project NVARCHAR(100) NULL;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Tasks') AND name = 'Notes')
            ALTER TABLE Tasks ADD Notes NVARCHAR(MAX) NULL;
    `);
    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('DailyTaskLogs') AND name = 'TaskID')
            ALTER TABLE DailyTaskLogs ADD TaskID INT NULL;
    `);
}

async function ensureEmployeeDocumentsTable(pool) {
    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'EmployeeDocuments')
        CREATE TABLE EmployeeDocuments (
            DocID        INT PRIMARY KEY IDENTITY(1,1),
            EmployeeID   INT NOT NULL,
            FileName     NVARCHAR(255) NOT NULL,
            FilePath     NVARCHAR(500) NOT NULL,
            FileType     NVARCHAR(50)  NULL,
            FileSizeKB   INT           NULL,
            UploadDate   DATETIME2 NOT NULL DEFAULT GETDATE(),
            ReviewStatus NVARCHAR(20) NOT NULL DEFAULT 'Pending',
            ReviewedBy   INT NULL,
            ReviewedAt   DATETIME2 NULL,
            Notes        NVARCHAR(MAX) NULL,
            CONSTRAINT FK_EmpDocs_Employee FOREIGN KEY (EmployeeID)
                REFERENCES Employees(EmployeeID) ON DELETE NO ACTION,
            CONSTRAINT FK_EmpDocs_Reviewer FOREIGN KEY (ReviewedBy)
                REFERENCES Employees(EmployeeID) ON DELETE NO ACTION
        );
        IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IDX_EmpDocs_Employee')
            CREATE INDEX IDX_EmpDocs_Employee ON EmployeeDocuments(EmployeeID, UploadDate DESC);
    `);
}

async function ensureJobRecommendationCvColumn(pool) {
    await pool.request().query(`
        IF NOT EXISTS (
            SELECT 1 FROM sys.columns
            WHERE object_id = OBJECT_ID('JobRecommendations') AND name = 'CvFilePath'
        )
        ALTER TABLE JobRecommendations ADD CvFilePath NVARCHAR(500) NULL;
    `);
}

async function ensureBalanceCards(pool) {
    // Batch 1: table + column structure
    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'BalanceCardTypes')
        CREATE TABLE BalanceCardTypes (
            CardTypeID   INT PRIMARY KEY IDENTITY(1,1),
            Label        NVARCHAR(100) NOT NULL,
            Icon         NVARCHAR(10)  NOT NULL DEFAULT N'💳',
            Color        NVARCHAR(30)  NULL,
            IsActive     BIT           NOT NULL DEFAULT 1,
            IsDeduction  BIT           NOT NULL DEFAULT 0,
            CreatedBy    INT           NULL,
            CreatedAt    DATETIME2     DEFAULT GETDATE(),
            CONSTRAINT FK_BalCardTypes_CreatedBy FOREIGN KEY (CreatedBy)
                REFERENCES Employees(EmployeeID) ON DELETE SET NULL
        );
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('BalanceCardTypes') AND name = 'IsDeduction')
            ALTER TABLE BalanceCardTypes ADD IsDeduction BIT NOT NULL DEFAULT 0;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('BalanceCardTypes') AND name = 'Unit')
            ALTER TABLE BalanceCardTypes ADD Unit NVARCHAR(20) NOT NULL DEFAULT 'PKR';
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'EmployeeBalanceValues')
        CREATE TABLE EmployeeBalanceValues (
            CardTypeID   INT             NOT NULL,
            EmployeeID   INT             NOT NULL,
            Amount       DECIMAL(18,2)   NOT NULL DEFAULT 0,
            UpdatedBy    INT             NULL,
            UpdatedAt    DATETIME2       NULL,
            PRIMARY KEY (CardTypeID, EmployeeID),
            CONSTRAINT FK_EmpBalVal_CardType FOREIGN KEY (CardTypeID)
                REFERENCES BalanceCardTypes(CardTypeID) ON DELETE CASCADE,
            CONSTRAINT FK_EmpBalVal_Employee FOREIGN KEY (EmployeeID)
                REFERENCES Employees(EmployeeID) ON DELETE CASCADE
        );
    `);

    // Batch 2: data fix — separate call so SQL Server compiles it AFTER the Unit column exists
    await pool.request().query(`
        UPDATE BalanceCardTypes SET Unit = 'Days'
        WHERE Unit = 'PKR' AND LOWER(Label) LIKE '%leave%';
    `);
}

async function ensureAttendanceLoginType(pool) {
    await pool.request().query(`
        IF NOT EXISTS (
            SELECT 1 FROM sys.columns
            WHERE object_id = OBJECT_ID('Attendance') AND name = 'LoginType'
        )
        ALTER TABLE Attendance ADD LoginType NVARCHAR(20) NOT NULL DEFAULT 'Office';
    `);
}

async function ensureTaskLogEndDate(pool) {
    await pool.request().query(`
        IF NOT EXISTS (
            SELECT 1 FROM sys.columns
            WHERE object_id = OBJECT_ID('DailyTaskLogs') AND name = 'EndDate'
        )
        ALTER TABLE DailyTaskLogs ADD EndDate DATE NULL;
    `);
}

async function ensureWorkingHoursColumns(pool) {
    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Employees') AND name = 'ShiftStart')
            ALTER TABLE Employees ADD ShiftStart NVARCHAR(5) NULL;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Employees') AND name = 'ShiftEnd')
            ALTER TABLE Employees ADD ShiftEnd NVARCHAR(5) NULL;
    `);
}

async function ensureManagerTeamsTable(pool) {
    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ManagerTeams')
        CREATE TABLE ManagerTeams (
            ManagerID INT NOT NULL,
            TeamID    INT NOT NULL,
            PRIMARY KEY (ManagerID, TeamID),
            CONSTRAINT FK_ManagerTeams_Manager FOREIGN KEY (ManagerID) REFERENCES Employees(EmployeeID) ON DELETE CASCADE,
            CONSTRAINT FK_ManagerTeams_Team    FOREIGN KEY (TeamID)    REFERENCES Teams(TeamID)         ON DELETE CASCADE
        );
    `);
}

async function ensureLateRemarksTable(pool) {
    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'LateRemarks')
        CREATE TABLE LateRemarks (
            RemarkID    INT PRIMARY KEY IDENTITY(1,1),
            EmployeeID  INT NOT NULL,
            Date        DATE NOT NULL,
            TeamID      INT NULL,
            ClientID    INT NULL,
            Reason      NVARCHAR(MAX) NULL,
            RecordedBy  INT NULL,
            CreatedAt   DATETIME2 NOT NULL DEFAULT GETDATE(),
            CONSTRAINT FK_LateRemarks_Employee   FOREIGN KEY (EmployeeID)  REFERENCES Employees(EmployeeID) ON DELETE CASCADE,
            CONSTRAINT FK_LateRemarks_Team       FOREIGN KEY (TeamID)      REFERENCES Teams(TeamID) ON DELETE SET NULL,
            CONSTRAINT FK_LateRemarks_Client     FOREIGN KEY (ClientID)    REFERENCES Clients(cliClientID) ON DELETE SET NULL,
            CONSTRAINT FK_LateRemarks_RecordedBy FOREIGN KEY (RecordedBy)  REFERENCES Employees(EmployeeID) ON DELETE NO ACTION,
            CONSTRAINT UQ_LateRemarks_EmpDate    UNIQUE (EmployeeID, Date)
        );
    `);
}

async function ensureFinanceLoans(pool) {
    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'FinanceLoans')
        CREATE TABLE FinanceLoans (
            LoanID       INT PRIMARY KEY IDENTITY(1,1),
            EmployeeID   INT NOT NULL,
            LoanAmount   DECIMAL(12,2) NOT NULL,
            PaidAmount   DECIMAL(12,2) NOT NULL DEFAULT 0,
            Purpose      NVARCHAR(500) NULL,
            IssuedDate   DATE NOT NULL DEFAULT CAST(GETDATE() AS DATE),
            DueDate      DATE NULL,
            Status       NVARCHAR(20) NOT NULL DEFAULT 'Active',
            Notes        NVARCHAR(MAX) NULL,
            CreatedBy    INT NULL,
            CreatedAt    DATETIME2 DEFAULT GETDATE(),
            UpdatedAt    DATETIME2 DEFAULT GETDATE(),
            CONSTRAINT FK_FinanceLoans_Employee FOREIGN KEY (EmployeeID)
                REFERENCES Employees(EmployeeID) ON DELETE CASCADE
        );
    `);
}

module.exports = {
    ensureManagerTeamsTable,
    ensureLateRemarksTable,
    ensureWorkingHoursColumns,
    ensureUsernamesTable,
    ensureEmployeeProfileColumns,
    ensureTeamsTable,
    ensureInventoryColumns,
    ensureInventoryEmployeeLink,
    ensureClientsTable,
    removeDepartmentColumn,
    ensureAnnouncementCategories,
    ensureTasksExtendedColumns,
    ensureEmployeeDocumentsTable,
    ensureJobRecommendationCvColumn,
    ensureBalanceCards,
    ensureAttendanceLoginType,
    ensureTaskLogEndDate,
    ensureFinanceLoans,
};
