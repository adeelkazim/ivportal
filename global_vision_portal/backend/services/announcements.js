/**
 * Company announcements — target all, by role(s), or selected employees
 */

const { sql } = require('../config/database');

async function ensureAnnouncementsTable(pool) {
    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Announcements')
        CREATE TABLE Announcements (
            AnnouncementID INT PRIMARY KEY IDENTITY(1,1),
            Title NVARCHAR(200) NOT NULL,
            Body NVARCHAR(MAX) NOT NULL,
            IsActive BIT NOT NULL DEFAULT 1,
            Priority INT NOT NULL DEFAULT 0,
            TargetType NVARCHAR(20) NOT NULL DEFAULT 'all',
            CreatedBy INT NULL,
            CreatedAt DATETIME2 DEFAULT GETDATE(),
            UpdatedAt DATETIME2 NULL,
            ExpiresAt DATETIME2 NULL,
            CONSTRAINT FK_Announcements_CreatedBy FOREIGN KEY (CreatedBy)
                REFERENCES Employees(EmployeeID) ON DELETE SET NULL
        );

        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Announcements') AND name = 'TargetType')
            ALTER TABLE Announcements ADD TargetType NVARCHAR(20) NOT NULL DEFAULT 'all';

        IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IDX_Announcements_Active')
            CREATE INDEX IDX_Announcements_Active ON Announcements(IsActive, CreatedAt DESC);

        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AnnouncementRecipients')
        CREATE TABLE AnnouncementRecipients (
            AnnouncementID INT NOT NULL,
            EmployeeID INT NOT NULL,
            PRIMARY KEY (AnnouncementID, EmployeeID),
            CONSTRAINT FK_AnnRec_Announcement FOREIGN KEY (AnnouncementID)
                REFERENCES Announcements(AnnouncementID) ON DELETE CASCADE,
            CONSTRAINT FK_AnnRec_Employee FOREIGN KEY (EmployeeID)
                REFERENCES Employees(EmployeeID) ON DELETE CASCADE
        );

        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AnnouncementRoles')
        CREATE TABLE AnnouncementRoles (
            AnnouncementID INT NOT NULL,
            RoleName NVARCHAR(50) NOT NULL,
            PRIMARY KEY (AnnouncementID, RoleName),
            CONSTRAINT FK_AnnRole_Announcement FOREIGN KEY (AnnouncementID)
                REFERENCES Announcements(AnnouncementID) ON DELETE CASCADE
        );
    `);
}

function normalizeTargetType(value) {
    const v = (value || 'all').toLowerCase();
    if (v === 'selected' || v === 'roles') return v;
    return 'all';
}

/** Parse expiry date — treats date-only strings as end-of-day; rejects fully past dates */
function parseExpiresAt(value) {
    if (value === null || value === undefined || value === '') {
        return { date: null };
    }
    let d;
    // Date-only string (YYYY-MM-DD): set to 23:59:59 local so it expires at end of that day
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value).trim())) {
        const [y, m, day] = String(value).trim().split('-').map(Number);
        d = new Date(y, m - 1, day, 23, 59, 59, 999);
    } else {
        d = new Date(value);
    }
    if (Number.isNaN(d.getTime())) {
        return { error: 'Invalid expiry date' };
    }
    // Allow today — only reject dates that ended before today began
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    if (d < startOfToday) {
        return { error: 'Expiry date cannot be in the past. Leave it empty to keep the announcement visible indefinitely.' };
    }
    return { date: d };
}

function isAnnouncementExpired(row) {
    if (!row || !row.ExpiresAt) return false;
    return new Date(row.ExpiresAt).getTime() <= Date.now();
}

function buildRecipientLabel(targetType, recipients = [], roles = []) {
    if (targetType === 'all') {
        return 'All employees & managers';
    }
    if (targetType === 'roles') {
        return roles.length
            ? `Roles: ${roles.map((r) => r.roleName).join(', ')}`
            : 'No roles selected';
    }
    if (targetType === 'selected') {
        return recipients.length
            ? recipients.map((r) => r.name).join(', ')
            : 'No employees selected';
    }
    return 'All employees & managers';
}

function mapAnnouncement(row, recipients = [], roles = []) {
    const targetType = normalizeTargetType(row.TargetType);
    return {
        id: row.AnnouncementID,
        announcementId: row.AnnouncementID,
        title: row.Title,
        body: row.Body,
        isActive: row.IsActive !== false && row.IsActive !== 0,
        priority: row.Priority,
        category: row.Category || null,
        targetType,
        recipients,
        roles,
        recipientCount: recipients.length,
        roleCount: roles.length,
        recipientLabel: buildRecipientLabel(targetType, recipients, roles),
        createdBy: row.CreatedBy,
        createdByName: row.CreatedByName || null,
        createdAt: row.CreatedAt,
        updatedAt: row.UpdatedAt,
        expiresAt: row.ExpiresAt,
        isExpired: isAnnouncementExpired(row),
    };
}

async function getRecipientsMap(pool, announcementIds) {
    const map = {};
    if (!announcementIds.length) return map;

    const request = pool.request();
    announcementIds.forEach((id, i) => {
        request.input(`id${i}`, sql.Int, id);
    });
    const inClause = announcementIds.map((_, i) => `@id${i}`).join(', ');

    const result = await request.query(`
        SELECT r.AnnouncementID, r.EmployeeID, e.Name, e.Role
        FROM AnnouncementRecipients r
        INNER JOIN Employees e ON e.EmployeeID = r.EmployeeID
        WHERE r.AnnouncementID IN (${inClause})
        ORDER BY e.Name
    `);

    result.recordset.forEach((row) => {
        if (!map[row.AnnouncementID]) map[row.AnnouncementID] = [];
        map[row.AnnouncementID].push({
            employeeId: row.EmployeeID,
            name: row.Name,
            role: row.Role,
        });
    });
    return map;
}

async function getRolesMap(pool, announcementIds) {
    const map = {};
    if (!announcementIds.length) return map;

    const request = pool.request();
    announcementIds.forEach((id, i) => {
        request.input(`id${i}`, sql.Int, id);
    });
    const inClause = announcementIds.map((_, i) => `@id${i}`).join(', ');

    const result = await request.query(`
        SELECT AnnouncementID, RoleName
        FROM AnnouncementRoles
        WHERE AnnouncementID IN (${inClause})
        ORDER BY RoleName
    `);

    result.recordset.forEach((row) => {
        if (!map[row.AnnouncementID]) map[row.AnnouncementID] = [];
        map[row.AnnouncementID].push({ roleName: row.RoleName });
    });
    return map;
}

async function setAnnouncementRecipients(pool, announcementId, employeeIds) {
    await pool.request()
        .input('id', sql.Int, announcementId)
        .query('DELETE FROM AnnouncementRecipients WHERE AnnouncementID = @id');

    const unique = [...new Set(employeeIds.map((id) => parseInt(id, 10)).filter((id) => !isNaN(id) && id > 0))];
    if (!unique.length) return 0;

    let saved = 0;
    for (const employeeId of unique) {
        const exists = await pool.request()
            .input('empId', sql.Int, employeeId)
            .query('SELECT EmployeeID FROM Employees WHERE EmployeeID = @empId');
        if (!exists.recordset.length) continue;

        await pool.request()
            .input('annId', sql.Int, announcementId)
            .input('empId', sql.Int, employeeId)
            .query(`
                IF NOT EXISTS (
                    SELECT 1 FROM AnnouncementRecipients
                    WHERE AnnouncementID = @annId AND EmployeeID = @empId
                )
                INSERT INTO AnnouncementRecipients (AnnouncementID, EmployeeID)
                VALUES (@annId, @empId)
            `);
        saved += 1;
    }
    return saved;
}

async function setAnnouncementRoles(pool, announcementId, roleNames) {
    await pool.request()
        .input('id', sql.Int, announcementId)
        .query('DELETE FROM AnnouncementRoles WHERE AnnouncementID = @id');

    const unique = [...new Set(
        roleNames.map((n) => String(n || '').trim()).filter(Boolean)
    )];
    for (const roleName of unique) {
        await pool.request()
            .input('annId', sql.Int, announcementId)
            .input('roleName', sql.NVarChar, roleName)
            .query(`
                INSERT INTO AnnouncementRoles (AnnouncementID, RoleName)
                VALUES (@annId, @roleName)
            `);
    }
}

async function clearAnnouncementTargeting(pool, announcementId) {
    await pool.request()
        .input('id', sql.Int, announcementId)
        .query('DELETE FROM AnnouncementRecipients WHERE AnnouncementID = @id');
    await pool.request()
        .input('id', sql.Int, announcementId)
        .query('DELETE FROM AnnouncementRoles WHERE AnnouncementID = @id');
}

function mapAnnouncementList(pool, rows) {
    const ids = rows.map((r) => r.AnnouncementID);
    return Promise.all([
        getRecipientsMap(pool, ids),
        getRolesMap(pool, ids),
    ]).then(([recMap, roleMap]) =>
        rows.map((row) =>
            mapAnnouncement(
                row,
                recMap[row.AnnouncementID] || [],
                roleMap[row.AnnouncementID] || []
            )
        )
    );
}

module.exports = {
    ensureAnnouncementsTable,
    normalizeTargetType,
    parseExpiresAt,
    isAnnouncementExpired,
    mapAnnouncement,
    mapAnnouncementList,
    getRecipientsMap,
    getRolesMap,
    setAnnouncementRecipients,
    setAnnouncementRoles,
    clearAnnouncementTargeting,
};
