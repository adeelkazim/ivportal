-- =============================================
-- Global Vision Portal - Database Schema
-- SQL Server (SSMS)
-- =============================================

-- Create Database
CREATE DATABASE GlobalVisionPortal;
GO

USE GlobalVisionPortal;
GO

-- =============================================
-- TABLE: Employees
-- =============================================
CREATE TABLE Employees (
    EmployeeID INT PRIMARY KEY IDENTITY(1,1),
    Name NVARCHAR(100) NOT NULL,
    Email NVARCHAR(100) UNIQUE NOT NULL,
    Department NVARCHAR(50) NOT NULL,
    Role NVARCHAR(50) NOT NULL, -- 'Employee', 'Manager', 'Admin'
    Contact NVARCHAR(20),
    PasswordHash NVARCHAR(255) NOT NULL,
    CreatedAt DATETIME DEFAULT GETDATE(),
    UpdatedAt DATETIME DEFAULT GETDATE()
);

-- =============================================
-- TABLE: Attendance
-- =============================================
CREATE TABLE Attendance (
    AttendanceID INT PRIMARY KEY IDENTITY(1,1),
    EmployeeID INT NOT NULL FOREIGN KEY REFERENCES Employees(EmployeeID),
    Date DATE NOT NULL,
    LoginTime DATETIME NOT NULL,
    LogoutTime DATETIME,
    TotalHours DECIMAL(5,2),
    CreatedAt DATETIME DEFAULT GETDATE()
);

-- Create index for faster queries
CREATE INDEX IDX_Attendance_EmployeeDate ON Attendance(EmployeeID, Date);

-- =============================================
-- TABLE: Inventory
-- =============================================
CREATE TABLE Inventory (
    ItemID INT PRIMARY KEY IDENTITY(1,1),
    ItemName NVARCHAR(100) NOT NULL,
    Quantity INT NOT NULL,
    AvailableQuantity INT NOT NULL,
    IssuedTo INT FOREIGN KEY REFERENCES Employees(EmployeeID),
    IssueDate DATETIME,
    ReturnDate DATETIME,
    Status NVARCHAR(50), -- 'Available', 'Issued', 'Returned'
    CreatedAt DATETIME DEFAULT GETDATE(),
    UpdatedAt DATETIME DEFAULT GETDATE()
);

-- =============================================
-- TABLE: KnowledgeBase
-- =============================================
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

-- Create index for search
CREATE INDEX IDX_KnowledgeBase_Title ON KnowledgeBase(Title);
CREATE INDEX IDX_KnowledgeBase_Category ON KnowledgeBase(Category);

-- =============================================
-- TABLE: Tasks
-- =============================================
CREATE TABLE Tasks (
    TaskID INT PRIMARY KEY IDENTITY(1,1),
    Title NVARCHAR(200) NOT NULL,
    Description NVARCHAR(MAX),
    AssignedTo INT NOT NULL FOREIGN KEY REFERENCES Employees(EmployeeID),
    AssignedBy INT NOT NULL FOREIGN KEY REFERENCES Employees(EmployeeID),
    Status NVARCHAR(50) NOT NULL, -- 'Pending', 'In Progress', 'Completed', 'On Hold'
    Priority NVARCHAR(50), -- 'Low', 'Medium', 'High'
    Deadline DATETIME,
    CompletedDate DATETIME,
    CreatedAt DATETIME DEFAULT GETDATE(),
    UpdatedAt DATETIME DEFAULT GETDATE()
);

-- Create index for queries
CREATE INDEX IDX_Tasks_AssignedTo ON Tasks(AssignedTo);
CREATE INDEX IDX_Tasks_Status ON Tasks(Status);

-- =============================================
-- SAMPLE DATA (optional)
-- =============================================

-- Insert sample employees
INSERT INTO Employees (Name, Email, Department, Role, Contact, PasswordHash)
VALUES 
    ('Admin User', 'admin@globalvision.com', 'IT', 'Admin', '9876543210', 'hash_admin'),
    ('John Manager', 'john@globalvision.com', 'Sales', 'Manager', '9876543211', 'hash_manager'),
    ('Alice Employee', 'alice@globalvision.com', 'Sales', 'Employee', '9876543212', 'hash_emp1'),
    ('Bob Employee', 'bob@globalvision.com', 'IT', 'Employee', '9876543213', 'hash_emp2');

-- Insert sample inventory
INSERT INTO Inventory (ItemName, Quantity, AvailableQuantity, IssuedTo, Status, IssueDate)
VALUES 
    ('Laptop', 5, 5, NULL, 'Available', NULL),
    ('Monitor', 10, 8, 3, 'Issued', GETDATE()),
    ('Mouse', 20, 18, 4, 'Issued', GETDATE()),
    ('Keyboard', 15, 15, NULL, 'Available', NULL);

-- Insert sample knowledge base
INSERT INTO KnowledgeBase (Title, Description, Solution, Category, AddedBy)
VALUES 
    ('How to reset password?', 'Employee forgot password', 'Use password reset link in login page', 'Password', 1),
    ('VPN Connection Issues', 'Cannot connect to VPN', 'Check network settings and reconnect', 'Network', 1);

-- Insert sample tasks
INSERT INTO Tasks (Title, Description, AssignedTo, AssignedBy, Status, Priority, Deadline)
VALUES 
    ('Complete Project Report', 'Finish the monthly report', 3, 2, 'Pending', 'High', GETDATE() + 5),
    ('Update Inventory List', 'Check and update inventory', 4, 2, 'In Progress', 'Medium', GETDATE() + 3);

-- =============================================
-- TABLE: DailyTaskLogs
-- =============================================
-- Status lifecycle for the Activity List widget:
--   Pending      → employee has slot but not started yet (Activity may be empty)
--   In Progress  → Start Activity clicked; StartTime auto-set by server
--   Paused       → Pause clicked; activity frozen
--   Postponed    → Postponed clicked; Completed button disabled until Resume
--   Completed    → Completed clicked; EndTime auto-set by server; Daily Log form opens
--   On Hold      → manual hold via log-edit form
--   Delayed      → manual status via log-edit form
-- StartTime and EndTime are set automatically by the server on Start/Complete actions.
-- Client, Project, Notes are filled in via the Daily Log form after Completed.
CREATE TABLE DailyTaskLogs (
    LogID      INT PRIMARY KEY IDENTITY(1,1),
    EmployeeID INT NOT NULL FOREIGN KEY REFERENCES Employees(EmployeeID) ON DELETE CASCADE,
    LogDate    DATE NOT NULL,
    Client     NVARCHAR(30)  NULL,
    Project    NVARCHAR(50)  NULL,
    Activity   NVARCHAR(500) NOT NULL DEFAULT '',
    StartTime  TIME          NULL,    -- auto-set when employee clicks Start Activity
    EndTime    TIME          NULL,    -- auto-set when employee clicks Completed
    Status     NVARCHAR(50)  NOT NULL DEFAULT 'Pending',
    Notes      NVARCHAR(MAX) NULL,
    CreatedAt  DATETIME2     NOT NULL DEFAULT GETDATE(),
    UpdatedAt  DATETIME2     NULL
);

CREATE INDEX IDX_DailyLogs_Emp ON DailyTaskLogs(EmployeeID, LogDate DESC);

GO
