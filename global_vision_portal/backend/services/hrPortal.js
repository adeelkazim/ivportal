/**
 * HR portal modules: medical balance, feedback, job openings, training
 */

const { sql } = require('../config/database');

async function runSql(pool, sqlText) {
    await pool.request().query(sqlText);
}

async function ensureHrPortalTables(pool) {
    // One batch per table — avoids partial failures and SQL Server "multiple cascade paths"
    // (two FKs to Employees with different ON DELETE actions on the same child table).

    await runSql(pool, `
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'MedicalBalances')
        CREATE TABLE MedicalBalances (
            EmployeeID      INT             PRIMARY KEY,
            Balance         DECIMAL(18,2)   NOT NULL DEFAULT 0,
            LoanBalance     DECIMAL(18,2)   NOT NULL DEFAULT 0,
            LeavesRemaining INT             NOT NULL DEFAULT 0,
            LastUpdatedOn   DATETIME2       NOT NULL DEFAULT GETDATE(),
            UpdatedBy       INT             NULL,
            CONSTRAINT FK_MedicalBalances_Employee FOREIGN KEY (EmployeeID)
                REFERENCES Employees(EmployeeID) ON DELETE CASCADE
        );
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('MedicalBalances') AND name = 'LoanBalance')
            ALTER TABLE MedicalBalances ADD LoanBalance DECIMAL(18,2) NOT NULL DEFAULT 0;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('MedicalBalances') AND name = 'LeavesRemaining')
            ALTER TABLE MedicalBalances ADD LeavesRemaining INT NOT NULL DEFAULT 0;
    `);

    await runSql(pool, `
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'FeedbackItems')
        CREATE TABLE FeedbackItems (
            FeedbackID INT PRIMARY KEY IDENTITY(1,1),
            EmployeeID INT NOT NULL,
            Category NVARCHAR(20) NOT NULL,
            Title NVARCHAR(200) NOT NULL,
            Description NVARCHAR(MAX) NOT NULL,
            DateSubmitted DATETIME2 NOT NULL DEFAULT GETDATE(),
            Status NVARCHAR(20) NOT NULL DEFAULT 'Pending',
            Response NVARCHAR(MAX) NULL,
            ReviewedBy INT NULL,
            ReviewedAt DATETIME2 NULL,
            CONSTRAINT FK_Feedback_Employee FOREIGN KEY (EmployeeID)
                REFERENCES Employees(EmployeeID) ON DELETE CASCADE
        );
    `);

    await runSql(pool, `
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'JobOpenings')
        CREATE TABLE JobOpenings (
            JobID INT PRIMARY KEY IDENTITY(1,1),
            Title NVARCHAR(200) NOT NULL,
            Department NVARCHAR(100) NOT NULL,
            Description NVARCHAR(MAX) NOT NULL,
            Qualifications NVARCHAR(MAX) NULL,
            EmploymentType NVARCHAR(50) NULL,
            DatePosted DATETIME2 NOT NULL DEFAULT GETDATE(),
            ExpiryDate DATETIME2 NULL,
            PostedBy INT NULL,
            IsActive BIT NOT NULL DEFAULT 1
        );
    `);

    await runSql(pool, `
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('JobOpenings') AND name = 'Qualifications')
            ALTER TABLE JobOpenings ADD Qualifications NVARCHAR(MAX) NULL;
    `);

    await runSql(pool, `
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('JobOpenings') AND name = 'EmploymentType')
            ALTER TABLE JobOpenings ADD EmploymentType NVARCHAR(50) NULL;
    `);

    await runSql(pool, `
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'JobRecommendations')
        CREATE TABLE JobRecommendations (
            RecommendationID   INT PRIMARY KEY IDENTITY(1,1),
            JobID              INT NOT NULL,
            CandidateName      NVARCHAR(200) NOT NULL,
            FatherName         NVARCHAR(200) NOT NULL,
            ContactNo          NVARCHAR(50)  NOT NULL,
            Email              NVARCHAR(200) NULL,
            LinkedIn           NVARCHAR(500) NULL,
            RecommendedBy      NVARCHAR(200) NULL,
            SubmittedByID      INT NULL,
            SubmittedAt        DATETIME2 NOT NULL DEFAULT GETDATE(),
            CONSTRAINT FK_JobRec_Job FOREIGN KEY (JobID)
                REFERENCES JobOpenings(JobID) ON DELETE CASCADE,
            CONSTRAINT FK_JobRec_Emp FOREIGN KEY (SubmittedByID)
                REFERENCES Employees(EmployeeID) ON DELETE SET NULL
        );
    `);

    await runSql(pool, `
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'TrainingCourses')
        CREATE TABLE TrainingCourses (
            CourseID INT PRIMARY KEY IDENTITY(1,1),
            Title NVARCHAR(200) NOT NULL,
            Description NVARCHAR(MAX) NOT NULL,
            Trainer NVARCHAR(120) NULL,
            Schedule NVARCHAR(255) NULL,
            Duration NVARCHAR(80) NULL,
            Category NVARCHAR(50) NULL,
            EnrollmentLimit INT NULL,
            IsActive BIT NOT NULL DEFAULT 1,
            CreatedAt DATETIME2 NOT NULL DEFAULT GETDATE(),
            UpdatedAt DATETIME2 NULL
        );
    `);

    await runSql(pool, `
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'TrainingEnrollments')
        CREATE TABLE TrainingEnrollments (
            EnrollmentID INT PRIMARY KEY IDENTITY(1,1),
            CourseID INT NOT NULL,
            EmployeeID INT NOT NULL,
            Status NVARCHAR(20) NOT NULL DEFAULT 'Enrolled',
            ProgressPct INT NOT NULL DEFAULT 0,
            CompletionDate DATETIME2 NULL,
            CertificationStatus NVARCHAR(50) NULL,
            EnrolledAt DATETIME2 NOT NULL DEFAULT GETDATE(),
            CONSTRAINT UQ_TrainingEnroll UNIQUE (CourseID, EmployeeID),
            CONSTRAINT FK_TrainingEnroll_Course FOREIGN KEY (CourseID)
                REFERENCES TrainingCourses(CourseID) ON DELETE CASCADE,
            CONSTRAINT FK_TrainingEnroll_Employee FOREIGN KEY (EmployeeID)
                REFERENCES Employees(EmployeeID) ON DELETE CASCADE
        );
    `);

    await runSql(pool, `
        IF OBJECT_ID('FeedbackItems', 'U') IS NOT NULL
           AND NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IDX_Feedback_Status' AND object_id = OBJECT_ID('FeedbackItems'))
            CREATE INDEX IDX_Feedback_Status ON FeedbackItems(Status, DateSubmitted DESC);
    `);

    await runSql(pool, `
        IF OBJECT_ID('JobOpenings', 'U') IS NOT NULL
           AND NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IDX_JobOpenings_Active' AND object_id = OBJECT_ID('JobOpenings'))
            CREATE INDEX IDX_JobOpenings_Active ON JobOpenings(IsActive, DatePosted DESC);
    `);

    await runSql(pool, `
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'DailyTaskLogs')
        CREATE TABLE DailyTaskLogs (
            LogID      INT PRIMARY KEY IDENTITY(1,1),
            EmployeeID INT NOT NULL,
            LogDate    DATE NOT NULL,
            Client     NVARCHAR(30)  NULL,
            Project    NVARCHAR(50)  NULL,
            Activity   NVARCHAR(500) NOT NULL,
            StartTime  TIME          NULL,
            EndTime    TIME          NULL,
            Status     NVARCHAR(50)  NOT NULL DEFAULT 'In Progress',
            Notes      NVARCHAR(MAX) NULL,
            CreatedAt  DATETIME2     NOT NULL DEFAULT GETDATE(),
            UpdatedAt  DATETIME2     NULL,
            CONSTRAINT FK_DailyLog_Emp FOREIGN KEY (EmployeeID)
                REFERENCES Employees(EmployeeID) ON DELETE CASCADE
        );
    `);

    // Migrate existing columns to correct types/sizes
    await runSql(pool, `
        IF EXISTS (SELECT * FROM sys.tables WHERE name = 'DailyTaskLogs')
        BEGIN
            IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('DailyTaskLogs') AND name = 'Client' AND max_length <> 60)
                ALTER TABLE DailyTaskLogs ALTER COLUMN Client NVARCHAR(30) NULL;
            IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('DailyTaskLogs') AND name = 'Project' AND max_length <> 100)
                ALTER TABLE DailyTaskLogs ALTER COLUMN Project NVARCHAR(50) NULL;
            IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('DailyTaskLogs') AND name = 'StartTime' AND system_type_id <> 41)
                ALTER TABLE DailyTaskLogs ALTER COLUMN StartTime TIME NULL;
            IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('DailyTaskLogs') AND name = 'EndTime' AND system_type_id <> 41)
                ALTER TABLE DailyTaskLogs ALTER COLUMN EndTime TIME NULL;
        END
    `);

    await runSql(pool, `
        IF OBJECT_ID('DailyTaskLogs', 'U') IS NOT NULL
           AND NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IDX_DailyLogs_Emp' AND object_id = OBJECT_ID('DailyTaskLogs'))
            CREATE INDEX IDX_DailyLogs_Emp ON DailyTaskLogs(EmployeeID, LogDate DESC);
    `);
}

function mapMedicalBalance(row) {
    return {
        employeeId:      row.EmployeeID,
        employeeName:    row.EmployeeName || row.Name,
        employeeEmail:   row.Email,
        balance:         parseFloat(row.Balance)         || 0,
        loanBalance:     parseFloat(row.LoanBalance)     || 0,
        leavesRemaining: parseInt(row.LeavesRemaining, 10) || 0,
        lastUpdatedOn:   row.LastUpdatedOn,
        updatedByName:   row.UpdatedByName || null,
    };
}

function mapFeedback(row) {
    return {
        id: row.FeedbackID,
        employeeId: row.EmployeeID,
        employeeName: row.EmployeeName,
        category: row.Category,
        title: row.Title,
        description: row.Description,
        dateSubmitted: row.DateSubmitted,
        status: row.Status,
        response: row.Response,
        reviewedBy: row.ReviewedBy,
        reviewedByName: row.ReviewedByName,
        reviewedAt: row.ReviewedAt,
    };
}

function mapJobOpening(row) {
    return {
        id: row.JobID,
        title: row.Title,
        department: row.Department,
        description: row.Description,
        qualifications: row.Qualifications || null,
        employmentType: row.EmploymentType || null,
        datePosted: row.DatePosted,
        expiryDate: row.ExpiryDate,
        isActive: row.IsActive !== false && row.IsActive !== 0,
        postedByName: row.PostedByName,
    };
}

function mapCourse(row) {
    return {
        id: row.CourseID,
        title: row.Title,
        description: row.Description,
        trainer: row.Trainer,
        schedule: row.Schedule,
        duration: row.Duration,
        category: row.Category,
        enrollmentLimit: row.EnrollmentLimit,
        isActive: row.IsActive !== false && row.IsActive !== 0,
        enrollmentCount: row.EnrollmentCount != null ? row.EnrollmentCount : 0,
        createdAt: row.CreatedAt,
    };
}

function mapEnrollment(row) {
    return {
        id: row.EnrollmentID,
        courseId: row.CourseID,
        courseTitle: row.CourseTitle,
        employeeId: row.EmployeeID,
        employeeName: row.EmployeeName,
        status: row.Status,
        progressPct: row.ProgressPct,
        completionDate: row.CompletionDate,
        certificationStatus: row.CertificationStatus,
        enrolledAt: row.EnrolledAt,
        trainer: row.Trainer,
        category: row.Category,
    };
}

async function upsertMedicalBalance(pool, employeeId, balance, updatedBy, loanBalance, leavesRemaining) {
    await pool.request()
        .input('employeeId',      sql.Int,            employeeId)
        .input('balance',         sql.Decimal(18, 2), balance)
        .input('loanBalance',     sql.Decimal(18, 2), loanBalance     != null ? loanBalance     : null)
        .input('leavesRemaining', sql.Int,            leavesRemaining != null ? leavesRemaining : null)
        .input('updatedBy',       sql.Int,            updatedBy || null)
        .query(`
            MERGE MedicalBalances AS t
            USING (SELECT @employeeId AS EmployeeID) AS s
            ON t.EmployeeID = s.EmployeeID
            WHEN MATCHED THEN
                UPDATE SET
                    Balance         = ISNULL(@balance,         Balance),
                    LoanBalance     = ISNULL(@loanBalance,     LoanBalance),
                    LeavesRemaining = ISNULL(@leavesRemaining, LeavesRemaining),
                    LastUpdatedOn   = GETDATE(),
                    UpdatedBy       = @updatedBy
            WHEN NOT MATCHED THEN
                INSERT (EmployeeID, Balance, LoanBalance, LeavesRemaining, LastUpdatedOn, UpdatedBy)
                VALUES (@employeeId, ISNULL(@balance, 0), ISNULL(@loanBalance, 0), ISNULL(@leavesRemaining, 0), GETDATE(), @updatedBy);
        `);
}

module.exports = {
    ensureHrPortalTables,
    mapMedicalBalance,
    mapFeedback,
    mapJobOpening,
    mapCourse,
    mapEnrollment,
    upsertMedicalBalance,
};
