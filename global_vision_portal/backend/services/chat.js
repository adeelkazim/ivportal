/**
 * Chat service — DB schema, REST routes, Socket.io wiring
 * Supports: direct messages, group chats, admin broadcast, file sharing
 */
const path   = require('path');
const fs     = require('fs');
const multer = require('multer');
const { sql } = require('../config/database');

// ── File upload storage ───────────────────────────────────────
const uploadDir = path.join(__dirname, '..', 'uploads', 'chat');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename:    (req, file, cb) => {
        const ext  = path.extname(file.originalname);
        const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
        cb(null, `${Date.now()}_${base}${ext}`);
    },
});

const chatUpload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 },
});

// ── DB schema ─────────────────────────────────────────────────
async function ensureChatTables(pool) {
    const run = (q) => pool.request().query(q);

    // Per-employee chat access flag (admin can disable)
    await run(`
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Employees') AND name = 'ChatEnabled')
            ALTER TABLE Employees ADD ChatEnabled BIT NOT NULL DEFAULT 1;
    `);

    await run(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Conversations')
        CREATE TABLE Conversations (
            ConversationID INT PRIMARY KEY IDENTITY(1,1),
            Type           NVARCHAR(20)  NOT NULL DEFAULT 'direct',
            GroupName      NVARCHAR(200) NULL,
            CreatedBy      INT           NULL,
            CreatedAt      DATETIME2     NOT NULL DEFAULT GETDATE()
        );
    `);

    // Add columns to existing Conversations table if missing
    await run(`
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Conversations') AND name = 'GroupName')
            ALTER TABLE Conversations ADD GroupName NVARCHAR(200) NULL;
    `);
    await run(`
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Conversations') AND name = 'CreatedBy')
            ALTER TABLE Conversations ADD CreatedBy INT NULL;
    `);

    await run(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ConversationParticipants')
        CREATE TABLE ConversationParticipants (
            ConversationID INT NOT NULL,
            EmployeeID     INT NOT NULL,
            LastReadAt     DATETIME2 NULL,
            PRIMARY KEY (ConversationID, EmployeeID),
            CONSTRAINT FK_CP_Conv FOREIGN KEY (ConversationID)
                REFERENCES Conversations(ConversationID) ON DELETE CASCADE,
            CONSTRAINT FK_CP_Emp FOREIGN KEY (EmployeeID)
                REFERENCES Employees(EmployeeID) ON DELETE CASCADE
        );
    `);

    await run(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Messages')
        CREATE TABLE Messages (
            MessageID      INT PRIMARY KEY IDENTITY(1,1),
            ConversationID INT           NOT NULL,
            SenderID       INT           NOT NULL,
            MessageType    NVARCHAR(20)  NOT NULL DEFAULT 'text',
            Content        NVARCHAR(MAX) NULL,
            FileUrl        NVARCHAR(500) NULL,
            FileName       NVARCHAR(300) NULL,
            FileSize       INT           NULL,
            CreatedAt      DATETIME2     NOT NULL DEFAULT GETDATE(),
            CONSTRAINT FK_Msg_Conv FOREIGN KEY (ConversationID)
                REFERENCES Conversations(ConversationID) ON DELETE CASCADE,
            CONSTRAINT FK_Msg_Emp FOREIGN KEY (SenderID)
                REFERENCES Employees(EmployeeID)
        );
    `);

    await run(`
        IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IDX_Messages_Conv')
            CREATE INDEX IDX_Messages_Conv ON Messages(ConversationID, CreatedAt ASC);
    `);
}

// ── Helper ────────────────────────────────────────────────────
function fileType(ext) {
    if (['.jpg','.jpeg','.png','.gif','.webp','.bmp'].includes(ext)) return 'image';
    if (['.mp4','.mov','.webm','.avi','.mkv'].includes(ext)) return 'video';
    return 'file';
}

// ── REST route registration ───────────────────────────────────
function registerChatRoutes(app, deps) {
    const { authMiddleware, requireDb } = deps;

    // Serve uploaded chat files with explicit CORS headers
    app.get('/uploads/chat/:filename', (req, res) => {
        const filename = req.params.filename;
        const filepath = path.join(uploadDir, filename);
        
        // Security: prevent directory traversal
        if (!filepath.startsWith(uploadDir)) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        
        // Set CORS headers explicitly
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Origin');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
        
        // Send file
        res.sendFile(filepath, (err) => {
            if (err) {
                console.error('File not found:', filename, err);
                if (!res.headersSent) {
                    res.status(404).json({ error: 'File not found' });
                }
            }
        });
    });

    // OPTIONS preflight handler
    app.options('/uploads/chat/:filename', (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Origin');
        res.sendStatus(200);
    });

    // ── GET /api/chat/users — active, chat-enabled employees except self ──
    app.get('/api/chat/users', authMiddleware, requireDb, async (req, res) => {
        try {
            const result = await deps.pool.request()
                .input('self', sql.Int, req.user.employeeId)
                .query(`
                    SELECT e.EmployeeID, e.Name, e.Role, e.Email,
                           e.ProfileImageUrl, u.Username,
                           ISNULL(e.ChatEnabled, 1) AS ChatEnabled
                    FROM Employees e
                    LEFT JOIN Usernames u ON u.EmployeeID = e.EmployeeID
                    WHERE e.EmployeeID <> @self
                      AND ISNULL(e.IsActive, 1) = 1
                      AND ISNULL(e.ChatEnabled, 1) = 1
                    ORDER BY e.Name
                `);
            res.json({ success: true, users: result.recordset });
        } catch (e) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ── GET /api/chat/admin/users — all employees + ChatEnabled flag (admin only) ──
    app.get('/api/chat/admin/users', authMiddleware, requireDb, async (req, res) => {
        if ((req.user.role || '').toLowerCase() !== 'admin') return res.status(403).json({ error: 'Admin only' });
        try {
            const result = await deps.pool.request().query(`
                SELECT EmployeeID, Name, Role, Email,
                       ProfileImageUrl, ISNULL(ChatEnabled, 1) AS ChatEnabled
                FROM Employees
                WHERE ISNULL(IsActive, 1) = 1
                ORDER BY Name
            `);
            res.json({ success: true, users: result.recordset });
        } catch (e) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ── POST /api/chat/admin/users/:id/toggle — set or toggle ChatEnabled (admin only) ──
    app.post('/api/chat/admin/users/:id/toggle', authMiddleware, requireDb, async (req, res) => {
        if ((req.user.role || '').toLowerCase() !== 'admin') return res.status(403).json({ error: 'Admin only' });
        try {
            const empId = parseInt(req.params.id, 10);
            // If body contains explicit `enable`, use it; otherwise toggle current state
            const hasExplicit = typeof req.body?.enable === 'boolean' || req.body?.enable === 0 || req.body?.enable === 1;
            const setExpr = hasExplicit
                ? `ChatEnabled = ${req.body.enable ? 1 : 0}`
                : `ChatEnabled = CASE WHEN ISNULL(ChatEnabled, 1) = 1 THEN 0 ELSE 1 END`;
            const result = await deps.pool.request()
                .input('id', sql.Int, empId)
                .query(`UPDATE Employees SET ${setExpr} OUTPUT INSERTED.ChatEnabled WHERE EmployeeID = @id`);
            res.json({ success: true, chatEnabled: result.recordset[0]?.ChatEnabled ?? 1 });
        } catch (e) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ── GET /api/chat/conversations — my conversation list ──
    // NOTE: SQL Server requires ORDER BY on UNION ALL to use a wrapping subquery.
    app.get('/api/chat/conversations', authMiddleware, requireDb, async (req, res) => {
        try {
            const meId = req.user.employeeId;
            const result = await deps.pool.request()
                .input('me', sql.Int, meId)
                .query(`
                    SELECT * FROM (
                        -- Direct conversations
                        SELECT c.ConversationID, c.Type,
                            CAST(NULL AS NVARCHAR(200)) AS GroupName,
                            CAST(0 AS INT) AS MemberCount,
                            o.EmployeeID AS OtherID, o.Name AS OtherName,
                            o.Role AS OtherRole, o.ProfileImageUrl AS OtherImage,
                            lm.Content AS LastMessage, lm.MessageType AS LastType,
                            lm.SenderID AS LastSenderID, ls.Name AS LastSenderName,
                            lm.CreatedAt AS LastAt,
                            ISNULL((SELECT COUNT(*) FROM Messages m2
                              WHERE m2.ConversationID = c.ConversationID
                                AND m2.SenderID <> @me
                                AND (cp.LastReadAt IS NULL OR m2.CreatedAt > cp.LastReadAt)), 0) AS UnreadCount
                        FROM ConversationParticipants cp
                        JOIN Conversations c ON c.ConversationID = cp.ConversationID AND c.Type = 'direct'
                        JOIN ConversationParticipants op ON op.ConversationID = c.ConversationID AND op.EmployeeID <> @me
                        JOIN Employees o ON o.EmployeeID = op.EmployeeID
                        OUTER APPLY (
                            SELECT TOP 1 Content, MessageType, SenderID, CreatedAt
                            FROM Messages WHERE ConversationID = c.ConversationID ORDER BY CreatedAt DESC
                        ) lm
                        LEFT JOIN Employees ls ON ls.EmployeeID = lm.SenderID
                        WHERE cp.EmployeeID = @me

                        UNION ALL

                        -- Group conversations
                        SELECT c.ConversationID, c.Type, c.GroupName,
                            (SELECT COUNT(*) FROM ConversationParticipants cp2 WHERE cp2.ConversationID = c.ConversationID),
                            CAST(NULL AS INT), CAST(NULL AS NVARCHAR(200)),
                            CAST(NULL AS NVARCHAR(50)), CAST(NULL AS NVARCHAR(MAX)),
                            lm.Content, lm.MessageType,
                            lm.SenderID, ls.Name,
                            lm.CreatedAt,
                            ISNULL((SELECT COUNT(*) FROM Messages m2
                              WHERE m2.ConversationID = c.ConversationID
                                AND m2.SenderID <> @me
                                AND (cp.LastReadAt IS NULL OR m2.CreatedAt > cp.LastReadAt)), 0)
                        FROM ConversationParticipants cp
                        JOIN Conversations c ON c.ConversationID = cp.ConversationID AND c.Type = 'group'
                        OUTER APPLY (
                            SELECT TOP 1 Content, MessageType, SenderID, CreatedAt
                            FROM Messages WHERE ConversationID = c.ConversationID ORDER BY CreatedAt DESC
                        ) lm
                        LEFT JOIN Employees ls ON ls.EmployeeID = lm.SenderID
                        WHERE cp.EmployeeID = @me
                    ) AS AllConvs
                    ORDER BY ISNULL(LastAt, '2000-01-01') DESC
                `);
            res.json({ success: true, conversations: result.recordset });
        } catch (e) {
            console.error('Chat conversations:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ── GET /api/chat/unread-count — total unread for nav badge ──
    app.get('/api/chat/unread-count', authMiddleware, requireDb, async (req, res) => {
        try {
            const result = await deps.pool.request()
                .input('me', sql.Int, req.user.employeeId)
                .query(`
                    SELECT ISNULL(SUM(
                        CASE WHEN m.SenderID <> @me
                             AND (cp.LastReadAt IS NULL OR m.CreatedAt > cp.LastReadAt)
                        THEN 1 ELSE 0 END
                    ), 0) AS Total
                    FROM ConversationParticipants cp
                    JOIN Conversations c ON c.ConversationID = cp.ConversationID
                    LEFT JOIN Messages m ON m.ConversationID = c.ConversationID
                    WHERE cp.EmployeeID = @me
                `);
            res.json({ success: true, count: result.recordset[0]?.Total || 0 });
        } catch (e) {
            console.error('Chat unread-count:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ── POST /api/chat/conversations — open or find DM ──
    app.post('/api/chat/conversations', authMiddleware, requireDb, async (req, res) => {
        try {
            const otherId = parseInt(req.body.userId, 10);
            const meId    = req.user.employeeId;
            if (!otherId || otherId === meId) return res.status(400).json({ error: 'Invalid user' });

            const existing = await deps.pool.request()
                .input('me', sql.Int, meId).input('other', sql.Int, otherId)
                .query(`
                    SELECT c.ConversationID FROM Conversations c
                    JOIN ConversationParticipants cp1 ON cp1.ConversationID = c.ConversationID AND cp1.EmployeeID = @me
                    JOIN ConversationParticipants cp2 ON cp2.ConversationID = c.ConversationID AND cp2.EmployeeID = @other
                    WHERE c.Type = 'direct'
                `);

            if (existing.recordset[0]) {
                return res.json({ success: true, conversationId: existing.recordset[0].ConversationID });
            }

            const ins = await deps.pool.request()
                .input('me', sql.Int, meId)
                .query(`INSERT INTO Conversations (Type, CreatedBy) OUTPUT INSERTED.ConversationID VALUES ('direct', @me)`);
            const convId = ins.recordset[0].ConversationID;

            await deps.pool.request()
                .input('convId', sql.Int, convId)
                .input('me', sql.Int, meId)
                .input('other', sql.Int, otherId)
                .query(`
                    INSERT INTO ConversationParticipants (ConversationID, EmployeeID) VALUES (@convId, @me);
                    INSERT INTO ConversationParticipants (ConversationID, EmployeeID) VALUES (@convId, @other);
                `);

            // Notify the other user in real-time so the chat appears without refresh
            if (deps.io) deps.io.to(`user_${otherId}`).emit('new_conversation', { conversationId: convId });

            res.json({ success: true, conversationId: convId });
        } catch (e) {
            console.error('Create DM:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ── POST /api/chat/groups — create group conversation ──
    app.post('/api/chat/groups', authMiddleware, requireDb, async (req, res) => {
        try {
            const meId      = req.user.employeeId;
            const groupName = (req.body.name || '').trim();
            const memberIds = Array.isArray(req.body.memberIds) ? req.body.memberIds.map(Number).filter(Boolean) : [];

            if (!groupName) return res.status(400).json({ error: 'Group name is required' });
            if (memberIds.length < 1) return res.status(400).json({ error: 'Select at least one member' });

            const ins = await deps.pool.request()
                .input('name', sql.NVarChar, groupName)
                .input('me', sql.Int, meId)
                .query(`
                    INSERT INTO Conversations (Type, GroupName, CreatedBy)
                    OUTPUT INSERTED.ConversationID
                    VALUES ('group', @name, @me)
                `);
            const convId = ins.recordset[0].ConversationID;

            const allMembers = [...new Set([meId, ...memberIds])];
            for (const empId of allMembers) {
                await deps.pool.request()
                    .input('convId', sql.Int, convId)
                    .input('empId', sql.Int, empId)
                    .query(`INSERT INTO ConversationParticipants (ConversationID, EmployeeID) VALUES (@convId, @empId)`);
            }

            // Notify every member in real-time
            if (deps.io) {
                allMembers.filter(id => id !== meId).forEach(uid => {
                    deps.io.to(`user_${uid}`).emit('new_conversation', { conversationId: convId, groupName });
                });
            }

            res.status(201).json({ success: true, conversationId: convId, groupName });
        } catch (e) {
            console.error('Create group:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ── PUT /api/chat/groups/:id — rename group ──
    app.put('/api/chat/groups/:id', authMiddleware, requireDb, async (req, res) => {
        try {
            const convId = parseInt(req.params.id, 10);
            const name   = (req.body.name || '').trim();
            if (!name) return res.status(400).json({ error: 'Name required' });

            const check = await deps.pool.request()
                .input('conv', sql.Int, convId).input('me', sql.Int, req.user.employeeId)
                .query(`SELECT 1 FROM ConversationParticipants WHERE ConversationID=@conv AND EmployeeID=@me`);
            if (!check.recordset.length) return res.status(403).json({ error: 'Forbidden' });

            await deps.pool.request()
                .input('id', sql.Int, convId)
                .input('name', sql.NVarChar, name)
                .query(`UPDATE Conversations SET GroupName=@name WHERE ConversationID=@id AND Type='group'`);

            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ── GET /api/chat/groups/:id/members ──
    app.get('/api/chat/groups/:id/members', authMiddleware, requireDb, async (req, res) => {
        try {
            const convId = parseInt(req.params.id, 10);
            const check  = await deps.pool.request()
                .input('conv', sql.Int, convId).input('me', sql.Int, req.user.employeeId)
                .query(`SELECT 1 FROM ConversationParticipants WHERE ConversationID=@conv AND EmployeeID=@me`);
            if (!check.recordset.length) return res.status(403).json({ error: 'Forbidden' });

            const result = await deps.pool.request()
                .input('conv', sql.Int, convId)
                .query(`
                    SELECT e.EmployeeID, e.Name, e.Role, e.ProfileImageUrl
                    FROM ConversationParticipants cp
                    JOIN Employees e ON e.EmployeeID = cp.EmployeeID
                    WHERE cp.ConversationID = @conv
                    ORDER BY e.Name
                `);
            res.json({ success: true, members: result.recordset });
        } catch (e) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ── POST /api/chat/groups/:id/members — add member ──
    app.post('/api/chat/groups/:id/members', authMiddleware, requireDb, async (req, res) => {
        try {
            const convId = parseInt(req.params.id, 10);
            const userId = parseInt(req.body.userId, 10);

            const check = await deps.pool.request()
                .input('conv', sql.Int, convId).input('me', sql.Int, req.user.employeeId)
                .query(`SELECT 1 FROM ConversationParticipants WHERE ConversationID=@conv AND EmployeeID=@me`);
            if (!check.recordset.length) return res.status(403).json({ error: 'Forbidden' });

            await deps.pool.request()
                .input('conv', sql.Int, convId).input('uid', sql.Int, userId)
                .query(`
                    IF NOT EXISTS (SELECT 1 FROM ConversationParticipants WHERE ConversationID=@conv AND EmployeeID=@uid)
                        INSERT INTO ConversationParticipants (ConversationID, EmployeeID) VALUES (@conv, @uid)
                `);
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ── DELETE /api/chat/groups/:id/members/:uid ──
    app.delete('/api/chat/groups/:id/members/:uid', authMiddleware, requireDb, async (req, res) => {
        try {
            const convId   = parseInt(req.params.id, 10);
            const uid      = parseInt(req.params.uid, 10);
            const meId     = req.user.employeeId;
            const isAdmin  = (req.user.role || '').toLowerCase() === 'admin';

            const conv = await deps.pool.request()
                .input('conv', sql.Int, convId)
                .query(`SELECT CreatedBy FROM Conversations WHERE ConversationID=@conv AND Type='group'`);
            if (!conv.recordset.length) return res.status(404).json({ error: 'Group not found' });

            // Self can always leave; creator or admin can remove others
            if (uid !== meId && conv.recordset[0].CreatedBy !== meId && !isAdmin) {
                return res.status(403).json({ error: 'Only the group creator or an admin can remove others' });
            }

            await deps.pool.request()
                .input('conv', sql.Int, convId).input('uid', sql.Int, uid)
                .query(`DELETE FROM ConversationParticipants WHERE ConversationID=@conv AND EmployeeID=@uid`);

            // Notify the removed user in real-time
            if (deps.io) deps.io.to(`user_${uid}`).emit('removed_from_group', { conversationId: convId });

            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ── GET /api/chat/conversations/:id/messages ──
    app.get('/api/chat/conversations/:id/messages', authMiddleware, requireDb, async (req, res) => {
        try {
            const convId = parseInt(req.params.id, 10);
            const meId   = req.user.employeeId;

            const check = await deps.pool.request()
                .input('conv', sql.Int, convId).input('me', sql.Int, meId)
                .query('SELECT 1 FROM ConversationParticipants WHERE ConversationID=@conv AND EmployeeID=@me');
            if (!check.recordset.length) return res.status(403).json({ error: 'Forbidden' });

            const result = await deps.pool.request()
                .input('conv', sql.Int, convId)
                .query(`
                    SELECT m.MessageID, m.SenderID, e.Name AS SenderName, e.Role AS SenderRole,
                           e.ProfileImageUrl AS SenderImage,
                           m.MessageType, m.Content, m.FileUrl, m.FileName, m.FileSize, m.CreatedAt
                    FROM Messages m
                    JOIN Employees e ON e.EmployeeID = m.SenderID
                    WHERE m.ConversationID = @conv
                    ORDER BY m.CreatedAt ASC
                `);

            await deps.pool.request()
                .input('conv', sql.Int, convId).input('me', sql.Int, meId)
                .query('UPDATE ConversationParticipants SET LastReadAt=GETDATE() WHERE ConversationID=@conv AND EmployeeID=@me');

            res.json({ success: true, messages: result.recordset });
        } catch (e) {
            console.error('Get messages:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ── POST /api/chat/conversations/:id/upload ──
    app.post('/api/chat/conversations/:id/upload', authMiddleware, requireDb,
        chatUpload.single('file'),
        async (req, res) => {
            try {
                const convId = parseInt(req.params.id, 10);
                const meId   = req.user.employeeId;
                if (!req.file) return res.status(400).json({ error: 'No file' });

                const check = await deps.pool.request()
                    .input('conv', sql.Int, convId).input('me', sql.Int, meId)
                    .query('SELECT 1 FROM ConversationParticipants WHERE ConversationID=@conv AND EmployeeID=@me');
                if (!check.recordset.length) return res.status(403).json({ error: 'Forbidden' });

                const ext  = path.extname(req.file.originalname).toLowerCase();
                const type = fileType(ext);
                const url  = `/uploads/chat/${req.file.filename}`;

                const ins = await deps.pool.request()
                    .input('conv',  sql.Int,      convId)
                    .input('me',    sql.Int,       meId)
                    .input('type',  sql.NVarChar,  type)
                    .input('url',   sql.NVarChar,  url)
                    .input('name',  sql.NVarChar,  req.file.originalname)
                    .input('size',  sql.Int,       req.file.size)
                    .query(`
                        INSERT INTO Messages (ConversationID, SenderID, MessageType, FileUrl, FileName, FileSize)
                        OUTPUT INSERTED.*
                        VALUES (@conv, @me, @type, @url, @name, @size)
                    `);

                const empRow = await deps.pool.request()
                    .input('id', sql.Int, meId)
                    .query('SELECT Name, Role, ProfileImageUrl FROM Employees WHERE EmployeeID=@id');

                const dbRow = ins.recordset[0];
                res.json({
                    success: true,
                    message: {
                        MessageID: dbRow.MessageID,
                        ConversationID: convId,
                        SenderID: dbRow.SenderID,
                        MessageType: dbRow.MessageType,
                        Content: dbRow.Content,
                        FileUrl: dbRow.FileUrl,
                        FileName: dbRow.FileName,
                        FileSize: dbRow.FileSize,
                        CreatedAt: dbRow.CreatedAt,
                        SenderName: empRow.recordset[0]?.Name,
                        SenderRole: empRow.recordset[0]?.Role,
                        SenderImage: empRow.recordset[0]?.ProfileImageUrl,
                    },
                });
            } catch (e) {
                console.error('Chat upload:', e);
                res.status(500).json({ error: 'Server error' });
            }
        }
    );

    // ── POST /api/chat/broadcast — Admin-only broadcast ──
    app.post('/api/chat/broadcast', authMiddleware, requireDb, async (req, res) => {
        try {
            if ((req.user.role || '').toLowerCase() !== 'admin') {
                return res.status(403).json({ error: 'Admin only' });
            }
            const content = (req.body.content || '').trim();
            if (!content) return res.status(400).json({ error: 'Content required' });

            const empRow = await deps.pool.request()
                .input('id', sql.Int, req.user.employeeId)
                .query('SELECT Name, ProfileImageUrl FROM Employees WHERE EmployeeID=@id');

            const broadcastMsg = {
                type:       'broadcast',
                content,
                senderName: empRow.recordset[0]?.Name || 'Admin',
                senderImage: empRow.recordset[0]?.ProfileImageUrl || null,
                senderId:   req.user.employeeId,
                createdAt:  new Date().toISOString(),
            };

            // Emit to all connected sockets (exposed via io.emit)
            if (deps.io) deps.io.emit('admin_broadcast', broadcastMsg);

            res.json({ success: true });
        } catch (e) {
            console.error('Broadcast:', e);
            res.status(500).json({ error: 'Server error' });
        }
    });
}

// ── Socket.io wiring ──────────────────────────────────────────
// pool is accessed lazily via a getter to avoid capturing undefined at init time.
function registerChatSocket(io, deps) {
    const getPool = () => (typeof deps === 'object' && deps !== null && typeof deps.pool !== 'undefined')
        ? deps.pool
        : deps; // backwards compat: deps could be the pool directly if it's available

    const onlineUsers = new Map(); // employeeId → socketId

    io.on('connection', (socket) => {
        const user = socket.handshake.auth.user;
        if (!user || !user.employeeId) { socket.disconnect(); return; }

        const pool = getPool();
        if (!pool) { socket.disconnect(); return; }

        const meId   = parseInt(user.employeeId, 10);
        const meName = user.name || '';
        onlineUsers.set(meId, socket.id);
        io.emit('presence', { userId: meId, online: true });

        // Personal room for targeted notifications (new DMs, group invites, etc.)
        socket.join(`user_${meId}`);

        // Join all my existing conversation rooms
        (async () => {
            try {
                const rows = await pool.request()
                    .input('me', sql.Int, meId)
                    .query('SELECT ConversationID FROM ConversationParticipants WHERE EmployeeID=@me');
                rows.recordset.forEach(r => socket.join(`conv_${r.ConversationID}`));
            } catch (e) { console.error('Socket join:', e); }
        })();

        // ── Send text message ──
        socket.on('send_message', async ({ conversationId, content }) => {
            try {
                if (!content || !content.trim()) return;

                const check = await pool.request()
                    .input('conv', sql.Int, conversationId).input('me', sql.Int, meId)
                    .query('SELECT 1 FROM ConversationParticipants WHERE ConversationID=@conv AND EmployeeID=@me');
                if (!check.recordset.length) return;

                const ins = await pool.request()
                    .input('conv',    sql.Int,      conversationId)
                    .input('me',      sql.Int,       meId)
                    .input('content', sql.NVarChar,  content.trim())
                    .query(`
                        INSERT INTO Messages (ConversationID, SenderID, MessageType, Content)
                        OUTPUT INSERTED.*
                        VALUES (@conv, @me, 'text', @content)
                    `);

                const emp = await pool.request()
                    .input('id', sql.Int, meId)
                    .query('SELECT Name, Role, ProfileImageUrl FROM Employees WHERE EmployeeID=@id');

                io.to(`conv_${conversationId}`).emit('new_message', {
                    ...ins.recordset[0],
                    SenderName:  emp.recordset[0]?.Name,
                    SenderRole:  emp.recordset[0]?.Role,
                    SenderImage: emp.recordset[0]?.ProfileImageUrl,
                });
            } catch (e) { console.error('send_message:', e); }
        });

        // ── File already saved via REST, broadcast to room ──
        socket.on('file_sent', ({ conversationId, message }) => {
            io.to(`conv_${conversationId}`).emit('new_message', message);
        });

        // ── Typing indicator (includes name for group chats) ──
        socket.on('typing', ({ conversationId, typing }) => {
            socket.to(`conv_${conversationId}`).emit('typing', { userId: meId, userName: meName, typing });
        });

        // ── Mark read ──
        socket.on('mark_read', async ({ conversationId }) => {
            try {
                await pool.request()
                    .input('conv', sql.Int, conversationId).input('me', sql.Int, meId)
                    .query('UPDATE ConversationParticipants SET LastReadAt=GETDATE() WHERE ConversationID=@conv AND EmployeeID=@me');
                socket.to(`conv_${conversationId}`).emit('read_receipt', { userId: meId, conversationId });
            } catch (e) {}
        });

        // ── Join new conversation room after DM/group creation ──
        socket.on('join_conversation', ({ conversationId }) => {
            socket.join(`conv_${conversationId}`);
        });

        // ── Deliver receipt — tell sender the message arrived ──
        socket.on('deliver_receipt', ({ conversationId, messageId }) => {
            socket.to(`conv_${conversationId}`).emit('deliver_receipt', { userId: meId, conversationId, messageId });
        });

        // ── Notify group members of new group ──
        socket.on('notify_group_created', ({ conversationId, groupName, memberIds }) => {
            memberIds.forEach(uid => {
                const sid = onlineUsers.get(uid);
                if (sid && uid !== meId) {
                    io.to(sid).emit('group_created', { conversationId, groupName });
                }
            });
        });

        socket.on('disconnect', () => {
            onlineUsers.delete(meId);
            io.emit('presence', { userId: meId, online: false });
        });
    });

    io.getOnlineUsers = () => [...onlineUsers.keys()];
}

module.exports = { ensureChatTables, registerChatRoutes, registerChatSocket, chatUpload };
