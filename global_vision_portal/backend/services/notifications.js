/**
 * Notifications — inventory requests, returns, and task status changes
 */

async function ensureNotificationsTable(pool) {
    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Notifications')
        CREATE TABLE Notifications (
            NotificationID      INT PRIMARY KEY IDENTITY(1,1),
            Type                NVARCHAR(50)    NOT NULL,
            Title               NVARCHAR(200)   NOT NULL,
            Message             NVARCHAR(MAX)   NOT NULL,
            LinkUrl             NVARCHAR(500)   NOT NULL,
            ItemID              INT             NULL,
            ActorEmployeeID     INT             NULL,
            RecipientEmployeeID INT             NULL,
            IsRead              BIT             NOT NULL DEFAULT 0,
            CreatedAt           DATETIME        NOT NULL DEFAULT GETDATE()
        );
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Notifications') AND name = 'RecipientEmployeeID')
            ALTER TABLE Notifications ADD RecipientEmployeeID INT NULL;
    `);
}

async function createNotification(pool, sql, { type, title, message, linkUrl, itemId, actorEmployeeId, recipientEmployeeId }) {
    await pool.request()
        .input('type',        sql.NVarChar, type)
        .input('title',       sql.NVarChar, title)
        .input('message',     sql.NVarChar, message)
        .input('linkUrl',     sql.NVarChar, linkUrl)
        .input('itemId',      sql.Int,      itemId || null)
        .input('actorId',     sql.Int,      actorEmployeeId || null)
        .input('recipientId', sql.Int,      recipientEmployeeId || null)
        .query(`
            INSERT INTO Notifications (Type, Title, Message, LinkUrl, ItemID, ActorEmployeeID, RecipientEmployeeID)
            VALUES (@type, @title, @message, @linkUrl, @itemId, @actorId, @recipientId)
        `);
}

async function notifyInventoryRequest(pool, sql, { itemId, itemName, employeeId, employeeName }) {
    await createNotification(pool, sql, {
        type: 'inventory_request',
        title: 'Inventory request',
        message: `${employeeName} requested "${itemName}"`,
        linkUrl: `inventory.html?itemId=${itemId}&employeeId=${employeeId}`,
        itemId,
        actorEmployeeId: employeeId
    });
}

async function notifyNewInventoryRequest(pool, sql, { itemId, itemName, quantity, notes, employeeId, employeeName }) {
    const detail = notes ? ` — ${notes}` : '';
    const qtyNote = quantity && quantity > 1 ? ` (×${quantity})` : '';
    await createNotification(pool, sql, {
        type: 'inventory_request',
        title: 'New inventory request',
        message: `${employeeName} requested "${itemName}"${qtyNote}${detail}`,
        linkUrl: `inventory.html?itemId=${itemId}&employeeId=${employeeId}`,
        itemId,
        actorEmployeeId: employeeId
    });
}

async function notifyInventoryReturn(pool, sql, { itemId, itemName, employeeId, employeeName }) {
    await createNotification(pool, sql, {
        type: 'inventory_return',
        title: 'Inventory returned',
        message: `${employeeName} returned "${itemName}"`,
        linkUrl: `inventory.html?itemId=${itemId}&employeeId=${employeeId}`,
        itemId,
        actorEmployeeId: employeeId
    });
}

const TASK_STATUS_LABELS = {
    'Completed':     'completed',
    'On Hold':       'put on hold',
    'In Progress':   'started',
    'Delayed':       'marked as delayed',
    'To Be Started': 'reset to To Be Started',
};

async function notifyTaskStatusChange(pool, sql, { taskId, taskTitle, newStatus, assignedByEmployeeId, assigneeEmployeeName }) {
    const label = TASK_STATUS_LABELS[newStatus];
    if (!label || !assignedByEmployeeId) return; // Only notify for meaningful transitions

    const emoji = {
        'Completed':   '✅',
        'On Hold':     '⏸',
        'In Progress': '▶',
        'Delayed':     '⚠️',
    }[newStatus] || '📋';

    await createNotification(pool, sql, {
        type:               'task_status',
        title:              `${emoji} Task ${newStatus}: "${taskTitle}"`,
        message:            `${assigneeEmployeeName} ${label} the task "${taskTitle}"`,
        linkUrl:            `tasks.html`,
        itemId:             taskId,
        recipientEmployeeId: assignedByEmployeeId,
    });
}

function mapNotification(row) {
    return {
        NotificationID:      row.NotificationID,
        Type:                row.Type,
        Title:               row.Title,
        Message:             row.Message,
        LinkUrl:             row.LinkUrl,
        ItemID:              row.ItemID,
        ActorEmployeeID:     row.ActorEmployeeID,
        RecipientEmployeeID: row.RecipientEmployeeID || null,
        IsRead:              !!row.IsRead,
        CreatedAt:           row.CreatedAt
    };
}

module.exports = {
    ensureNotificationsTable,
    createNotification,
    notifyInventoryRequest,
    notifyNewInventoryRequest,
    notifyInventoryReturn,
    notifyTaskStatusChange,
    mapNotification
};
