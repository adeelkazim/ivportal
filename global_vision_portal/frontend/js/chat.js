/* ── Global Vision Portal · Chat Client ─────────────────────────── */

const AV_COLORS = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ef4444','#0ea5e9','#ec4899','#14b8a6','#84cc16','#f97316'];

let socket        = null;
let conversations = [];
let allUsers      = [];
let activeConvId  = null;
let onlineUsers   = new Set();
let typingTimers  = {};
let me            = null;
let groupSelectedIds = new Set(); // for group creation modal
let activeTab     = 'chats';      // 'chats' | 'contacts'
let activeGroupIsGroup = false;   // is the current open conv a group?

// WhatsApp-live features
const convReadByOther = {};    // convId → ISO timestamp of last read-receipt
const convDelivByOther = {};   // convId → ISO timestamp of last deliver-receipt
let notifSound = true;         // notification sound toggle

// ── Init ──────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    me = getUser();
    if (!me) return;

    renderMeHeader();
    // Show admin-only buttons
    if (isAdmin()) {
        document.getElementById('btnBcast').style.display = '';
        const bm = document.getElementById('btnManageChat');
        if (bm) bm.style.display = '';
    }

    // Remove portal padding for full-height layout (applied after layout-ready)
    document.addEventListener('portal-layout-ready', () => {
        const pc = document.querySelector('.portal-page-content');
        if (pc) { pc.style.padding = '0'; pc.style.maxWidth = 'none'; pc.style.overflow = 'hidden'; }
    }, { once: true });

    setupUI();

    // socket.io is loaded dynamically — wait for it before connecting
    waitForSocketIo()
        .then(async () => {
            initSocket();
            await Promise.all([loadUsers(), loadConversations()]);
            updateNavBadge();
            const convParam = parseInt(new URLSearchParams(location.search).get('conv'), 10);
            if (convParam) openConversation(convParam);
        })
        .catch(err => {
            console.error('Chat init:', err.message);
            const cl = document.getElementById('convList');
            if (cl) cl.innerHTML = `<div style="padding:20px;text-align:center;color:#f87171;font-size:12px;">Chat unavailable.<br>${err.message}</div>`;
        });
});

function waitForSocketIo(maxWait = 8000) {
    return new Promise((resolve, reject) => {
        if (typeof io !== 'undefined') { resolve(); return; }
        const timer = setTimeout(() => {
            clearInterval(poll);
            reject(new Error('socket.io failed to load — check backend is running on ' + resolveBase()));
        }, maxWait);
        const poll = setInterval(() => {
            if (typeof io !== 'undefined') { clearTimeout(timer); clearInterval(poll); resolve(); }
        }, 50);
    });
}

function renderMeHeader() {
    const av = document.getElementById('csMeAvatar');
    const nameEl = document.getElementById('csMeName');
    const roleEl = document.getElementById('csMeRole');
    if (!me || !av) return;

    if (me.profileImageUrl) {
        av.innerHTML = `<img src="${ce(me.profileImageUrl)}" alt=""><span class="sdot"></span>`;
    } else {
        av.style.background = avColor(me.EmployeeID);
        av.innerHTML = `${getInit(me.Name)}<span class="sdot"></span>`;
    }
    if (nameEl) nameEl.textContent = me.Name || me.Email || '—';
    if (roleEl) roleEl.style.display = 'none';
}

// ── Socket.io ─────────────────────────────────────────────────────

function initSocket() {
    const base = resolveBase();
    socket = io(base, {
        auth: { user: { employeeId: me.EmployeeID || me.id, name: me.Name || '' } },
        transports: ['websocket', 'polling'],
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
    });

    socket.on('connect', () => {
        hideBanner();
        // Re-join rooms after reconnect
        conversations.forEach(c => socket.emit('join_conversation', { conversationId: c.ConversationID }));
    });

    socket.on('disconnect', () => showBanner('⚡ Chat disconnected — reconnecting…', false));
    socket.on('reconnect', () => showBanner('✓ Back online', true, 2500));
    socket.on('connect_error', () => showBanner('⚡ Reconnecting to chat…', false));

    socket.on('new_message', (msg) => {
        let conv = conversations.find(c => c.ConversationID === msg.ConversationID);
        if (!conv) {
            // New conversation arrived — load it
            loadConversations();
        } else {
            conv.LastMessage    = msg.Content || (msg.FileName ? `📎 ${msg.FileName}` : msg.MessageType);
            conv.LastType       = msg.MessageType;
            conv.LastAt         = msg.CreatedAt;
            conv.LastSenderID   = msg.SenderID;
            conv.LastSenderName = msg.SenderName;
            if (msg.SenderID !== myId() && msg.ConversationID !== activeConvId) {
                conv.UnreadCount = (conv.UnreadCount || 0) + 1;
                playNotificationSound();
            }
        }
        renderConvList();
        updateNavBadge();

        if (msg.ConversationID === activeConvId) {
            appendMessage(msg, true);
            socket.emit('mark_read', { conversationId: activeConvId });
            // Emit deliver receipt to sender
            socket.emit('deliver_receipt', { conversationId: activeConvId, messageId: msg.MessageID });
            if (conv) conv.UnreadCount = 0;
        }
    });

    socket.on('deliver_receipt', ({ userId, conversationId }) => {
        if (userId === myId()) return;
        convDelivByOther[conversationId] = new Date().toISOString();
        if (conversationId === activeConvId) updateMessageTicks(conversationId);
    });

    socket.on('presence', ({ userId, online }) => {
        if (online) onlineUsers.add(userId); else onlineUsers.delete(userId);
        renderConvList();
        renderContactList();
        updateHeaderMeta();
    });

    socket.on('typing', ({ userId, userName, typing }) => {
        if (userId === myId()) return;
        const wrap = document.getElementById('typingWrap');
        if (!wrap) return;
        const conv = conversations.find(c => c.ConversationID === activeConvId);
        if (!conv) return;
        const name = userName || (conv.Type === 'direct' ? conv.OtherName : 'Someone');
        clearTimeout(typingTimers[userId]);
        if (typing) {
            wrap.innerHTML = `<div class="typing-ind">${ce(name)} is typing <div class="tdots"><span></span><span></span><span></span></div></div>`;
            typingTimers[userId] = setTimeout(() => { if (wrap) wrap.innerHTML = ''; }, 3000);
        } else {
            wrap.innerHTML = '';
        }
    });

    socket.on('read_receipt', ({ userId, conversationId }) => {
        if (userId === myId()) return;
        convReadByOther[conversationId] = new Date().toISOString();
        if (conversationId === activeConvId) updateMessageTicks(conversationId);
    });

    // New conversation created by someone else — appears instantly
    socket.on('new_conversation', async ({ conversationId, groupName }) => {
        await loadConversations();
        socket.emit('join_conversation', { conversationId });
        playNotificationSound();
        // Flash the conv list item
        setTimeout(() => {
            const el = document.querySelector(`.conv-item[data-conv="${conversationId}"]`);
            if (el) { el.style.background = 'rgba(59,130,246,.18)'; setTimeout(() => el.style.background = '', 1500); }
        }, 300);
    });

    // Removed from a group
    socket.on('removed_from_group', ({ conversationId }) => {
        conversations = conversations.filter(c => c.ConversationID !== conversationId);
        if (activeConvId === conversationId) {
            activeConvId = null;
            document.getElementById('chatEmpty').style.display = '';
            document.getElementById('chatConvView').style.display = 'none';
        }
        renderConvList();
    });

    socket.on('group_created', ({ conversationId, groupName }) => {
        loadConversations();
        socket.emit('join_conversation', { conversationId });
    });

    socket.on('admin_broadcast', ({ content, senderName, createdAt }) => {
        showBroadcastToast(content, senderName);
    });
}

// ── Connection banner ─────────────────────────────────────────────

let _bannerTimer = null;
function showBanner(msg, success, autoDismissMs = 0) {
    const el = document.getElementById('connBanner');
    if (!el) return;
    el.textContent = msg;
    el.className = 'show' + (success ? ' reconnected' : '');
    clearTimeout(_bannerTimer);
    if (autoDismissMs) _bannerTimer = setTimeout(hideBanner, autoDismissMs);
}
function hideBanner() {
    const el = document.getElementById('connBanner');
    if (el) el.className = '';
}

// ── Notification sound (Web Audio API — no file needed) ───────────

function playNotificationSound() {
    if (!notifSound) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        [0, 100].forEach((delayMs, i) => {
            const osc  = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.value = i === 0 ? 880 : 1100;
            const t = ctx.currentTime + delayMs / 1000;
            gain.gain.setValueAtTime(0.2, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
            osc.start(t); osc.stop(t + 0.18);
        });
    } catch (_) {}
}

// ── Message ticks (WhatsApp-style) ───────────────────────────────

function updateMessageTicks(convId) {
    const readTs  = convReadByOther[convId];
    const delivTs = convDelivByOther[convId];
    document.querySelectorAll(`.msg-row.mine .msg-ticks`).forEach(el => {
        const msgTime = el.dataset.sentAt;
        if (!msgTime) return;
        if (readTs && msgTime <= readTs) {
            el.className = 'msg-ticks tick-read'; el.textContent = '✓✓';
        } else if (delivTs && msgTime <= delivTs) {
            el.className = 'msg-ticks tick-deliv'; el.textContent = '✓✓';
        } else {
            el.className = 'msg-ticks tick-sent'; el.textContent = '✓';
        }
    });
}

function tickHtml(msg, convId) {
    if (msg.SenderID !== myId()) return '';
    const readTs  = convReadByOther[convId];
    const delivTs = convDelivByOther[convId];
    const sentAt  = new Date(msg.CreatedAt).toISOString();
    let cls = 'tick-sent', sym = '✓';
    if (readTs  && sentAt <= readTs)  { cls = 'tick-read';  sym = '✓✓'; }
    else if (delivTs && sentAt <= delivTs) { cls = 'tick-deliv'; sym = '✓✓'; }
    return `<span class="msg-ticks ${cls}" data-sent-at="${ce(sentAt)}">${sym}</span>`;
}

// ── Data ──────────────────────────────────────────────────────────

async function loadUsers() {
    try {
        const res = await apiCall('/chat/users');
        allUsers = (res && res.users) || [];
    } catch (e) { console.warn('Chat users:', e.message); }
}

async function loadConversations() {
    try {
        const res = await apiCall('/chat/conversations');
        conversations = (res && res.conversations) || [];
        renderConvList();
        renderContactList();
    } catch (e) { console.warn('Conversations:', e.message); }
}

// ── Render conversation list ──────────────────────────────────────

function renderConvList() {
    const el = document.getElementById('convList');
    if (!el) return;
    const q = (document.getElementById('chatSearch')?.value || '').toLowerCase();

    let list = conversations.filter(c => {
        const label = c.Type === 'group' ? (c.GroupName || 'Group') : (c.OtherName || '');
        return !q || label.toLowerCase().includes(q);
    });

    if (!list.length) {
        el.innerHTML = `<div style="padding:24px;text-align:center;color:#475569;font-size:13px;">${q ? 'No results' : 'No conversations yet.'}</div>`;
        return;
    }

    el.innerHTML = list.map(c => {
        const isGroup  = c.Type === 'group';
        const label    = isGroup ? (c.GroupName || 'Group') : (c.OtherName || '?');
        const otherId  = c.OtherID;
        const isOnline = !isGroup && onlineUsers.has(otherId);
        const isActive = c.ConversationID === activeConvId;
        const imgUrl   = !isGroup ? c.OtherImage : null;
        const unread   = (c.UnreadCount || 0) > 0;
        const time     = c.LastAt ? relTime(c.LastAt) : '';

        let preview = '';
        if (c.LastMessage) {
            preview = isGroup && c.LastSenderName && c.LastSenderID !== myId()
                ? `${c.LastSenderName.split(' ')[0]}: ${c.LastMessage}`
                : c.LastMessage;
        } else {
            preview = 'No messages yet';
        }
        if (c.LastType && c.LastType !== 'text') preview = `📎 ${c.LastType === 'image' ? 'Photo' : c.LastType === 'video' ? 'Video' : 'File'}`;

        const avHtml = imgUrl
            ? `<img src="${ce(imgUrl)}" alt="">`
            : (isGroup
                ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.9)" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`
                : getInit(label));

        return `
        <div class="conv-item ${isActive ? 'active' : ''}" data-conv="${c.ConversationID}">
            <div class="conv-avatar ${isGroup ? 'group' : ''}" style="background:${avColor(isGroup ? c.ConversationID : otherId)};">
                ${avHtml}
                ${isOnline ? '<span class="odot"></span>' : ''}
            </div>
            <div class="conv-body">
                <div class="conv-name">${ce(label)}</div>
                <div class="conv-preview">${ce(preview)}</div>
            </div>
            <div class="conv-meta">
                <div class="conv-time">${time}</div>
                ${unread ? `<div class="conv-unread">${c.UnreadCount > 99 ? '99+' : c.UnreadCount}</div>` : ''}
            </div>
        </div>`;
    }).join('');

    el.querySelectorAll('.conv-item').forEach(item => {
        item.addEventListener('click', () => openConversation(parseInt(item.dataset.conv, 10)));
    });
}

// ── Render contacts/people tab ────────────────────────────────────

function renderContactList() {
    const el = document.getElementById('contactList');
    if (!el) return;
    const q = (document.getElementById('chatSearch')?.value || '').toLowerCase();

    const online  = allUsers.filter(u => onlineUsers.has(u.EmployeeID) && (!q || u.Name.toLowerCase().includes(q)));
    const offline = allUsers.filter(u => !onlineUsers.has(u.EmployeeID) && (!q || u.Name.toLowerCase().includes(q)));

    let html = '';
    if (online.length) {
        html += `<div class="ct-section">Online · ${online.length}</div>`;
        html += online.map(u => contactRow(u, true)).join('');
    }
    if (offline.length) {
        html += `<div class="ct-section">Offline · ${offline.length}</div>`;
        html += offline.map(u => contactRow(u, false)).join('');
    }
    if (!html) html = `<div style="padding:24px;text-align:center;color:#475569;font-size:13px;">No users found</div>`;
    el.innerHTML = html;

    el.querySelectorAll('.contact-item').forEach(item => {
        item.addEventListener('click', () => startDm(parseInt(item.dataset.uid, 10)));
    });
}

function contactRow(u, online) {
    const img = u.ProfileImageUrl;
    const avHtml = img
        ? `<img src="${ce(img)}" alt="">`
        : getInit(u.Name);
    return `
    <div class="contact-item" data-uid="${u.EmployeeID}">
        <div class="ct-avatar" style="background:${avColor(u.EmployeeID)};">
            ${avHtml}
            ${online ? '<span class="odot"></span>' : ''}
        </div>
        <div>
            <div class="ct-name">${ce(u.Name)}</div>
        </div>
        <div class="ct-status ${online ? 'online' : ''}">${online ? '● Online' : 'Offline'}</div>
    </div>`;
}

// ── Open conversation ─────────────────────────────────────────────

async function openConversation(convId) {
    activeConvId = convId;
    const conv = conversations.find(c => c.ConversationID === convId);
    if (!conv) return;

    activeGroupIsGroup = conv.Type === 'group';
    conv.UnreadCount = 0;
    renderConvList();
    updateNavBadge();

    document.getElementById('chatEmpty').style.display   = 'none';
    const view = document.getElementById('chatConvView');
    view.style.display = 'flex';

    // Close group info panel when switching
    document.getElementById('groupInfoPanel').classList.remove('open');

    renderConvHeader(conv);

    const msgEl = document.getElementById('chatMessages');
    msgEl.innerHTML = `<div style="text-align:center;color:#94a3b8;font-size:13px;padding:20px;">Loading…</div>`;

    const input = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    input.disabled = true; sendBtn.disabled = true;

    try {
        const res = await apiCall(`/chat/conversations/${convId}/messages`);
        const msgs = (res && res.messages) || [];
        renderMessages(msgs, conv);
        input.disabled = false; sendBtn.disabled = false;
        input.focus();
        socket.emit('mark_read', { conversationId: convId });
        socket.emit('join_conversation', { conversationId: convId });
    } catch (e) {
        msgEl.innerHTML = `<div style="text-align:center;color:#ef4444;font-size:13px;padding:20px;">${ce(e.message)}</div>`;
    }

    // Close mobile sidebar
    document.getElementById('chatSidebar').classList.remove('open');
}

function renderConvHeader(conv) {
    const el = document.getElementById('chatHeader');
    const isGroup = conv.Type === 'group';
    const label   = isGroup ? (conv.GroupName || 'Group') : (conv.OtherName || '?');
    const otherId = conv.OtherID;
    const isOnline = !isGroup && onlineUsers.has(otherId);
    const imgUrl  = !isGroup ? conv.OtherImage : null;

    const avHtml = imgUrl
        ? `<img src="${ce(imgUrl)}" alt="">`
        : (isGroup
            ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.9)" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`
            : getInit(label));

    const meta = isGroup
        ? `${conv.MemberCount || ''} members`
        : (isOnline ? '<span class="ch-online">● Online</span>' : ce(conv.OtherRole || ''));

    el.innerHTML = `
        <div class="ch-avatar ${isGroup ? 'group' : ''}" style="background:${avColor(isGroup ? conv.ConversationID : otherId)};">
            ${avHtml}
            ${isOnline ? '<span class="odot"></span>' : ''}
        </div>
        <div class="ch-info">
            <div class="ch-name">${ce(label)}</div>
            <div class="ch-meta" id="convHeaderMeta">${meta}</div>
        </div>
        ${isGroup ? `
        <button class="ch-btn" id="groupInfoBtn" title="Group info">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </button>` : ''}
    `;

    if (isGroup) {
        el.querySelector('#groupInfoBtn')?.addEventListener('click', () => toggleGroupInfo(conv.ConversationID));
    }
}

function updateHeaderMeta() {
    const conv = conversations.find(c => c.ConversationID === activeConvId);
    if (!conv || conv.Type === 'group') return;
    const el = document.getElementById('convHeaderMeta');
    if (!el) return;
    const isOnline = onlineUsers.has(conv.OtherID);
    el.innerHTML = isOnline ? '<span class="ch-online">● Online</span>' : ce(conv.OtherRole || '');
}

// ── Group info panel ──────────────────────────────────────────────

async function toggleGroupInfo(convId) {
    const panel = document.getElementById('groupInfoPanel');
    if (panel.classList.contains('open')) { panel.classList.remove('open'); return; }
    panel.classList.add('open');
    await loadGroupInfo(convId);
}

async function loadGroupInfo(convId) {
    const conv = conversations.find(c => c.ConversationID === convId);
    document.getElementById('gipName').textContent = conv?.GroupName || 'Group';

    try {
        const res = await apiCall(`/chat/groups/${convId}/members`);
        const members = res.members || [];
        document.getElementById('gipCount').textContent = `${members.length} members`;
        document.getElementById('gipList').innerHTML = members.map(m => {
            const img = m.ProfileImageUrl;
            const avHtml = img ? `<img src="${ce(img)}" alt="">` : getInit(m.Name);
            const canRemove = m.EmployeeID !== myId();
            return `
            <div class="gip-member" data-uid="${m.EmployeeID}">
                <div class="gip-mav" style="background:${avColor(m.EmployeeID)};">${avHtml}</div>
                <div class="gip-mname">${ce(m.Name)}</div>
                ${canRemove ? `<span class="gip-rem" data-rmv="${m.EmployeeID}">✕</span>` : ''}
            </div>`;
        }).join('');

        document.getElementById('gipList').querySelectorAll('[data-rmv]').forEach(btn => {
            btn.addEventListener('click', () => removeMemberFromGroup(convId, parseInt(btn.dataset.rmv, 10)));
        });
    } catch (e) {
        document.getElementById('gipList').innerHTML = `<div style="color:#ef4444;font-size:13px;">${ce(e.message)}</div>`;
    }

    document.getElementById('gipAddBtn').onclick = () => openAddMemberModal(convId);
}

async function removeMemberFromGroup(convId, uid) {
    if (!confirm('Remove this member from the group?')) return;
    try {
        await apiCall(`/chat/groups/${convId}/members/${uid}`, { method: 'DELETE' });
        await loadGroupInfo(convId);
        await loadConversations();
    } catch (e) { alert(e.message); }
}

function openAddMemberModal(convId) {
    const modal = document.getElementById('addMemberModal');
    modal.classList.add('open');
    const input = document.getElementById('addMemberSearch');
    input.value = '';
    renderAddMemberList('', convId);
    input.focus();
    input.oninput = () => renderAddMemberList(input.value, convId);
}

function renderAddMemberList(q, convId) {
    const el = document.getElementById('addMemberList');
    const filtered = allUsers.filter(u =>
        !q || u.Name.toLowerCase().includes(q.toLowerCase())
    );
    if (!filtered.length) { el.innerHTML = `<div style="padding:14px;text-align:center;color:#94a3b8;font-size:13px;">No users</div>`; return; }
    el.innerHTML = filtered.map(u => {
        const img = u.ProfileImageUrl;
        const avHtml = img ? `<img src="${ce(img)}" alt="">` : getInit(u.Name);
        return `
        <div class="mu-item" data-uid="${u.EmployeeID}">
            <div class="mu-av" style="background:${avColor(u.EmployeeID)};">${avHtml}</div>
            <div><div class="mu-name">${ce(u.Name)}</div></div>
        </div>`;
    }).join('');
    el.querySelectorAll('.mu-item').forEach(item => {
        item.addEventListener('click', async () => {
            const uid = parseInt(item.dataset.uid, 10);
            try {
                await apiCall(`/chat/groups/${convId}/members`, { method: 'POST', body: JSON.stringify({ userId: uid }) });
                document.getElementById('addMemberModal').classList.remove('open');
                socket.emit('join_conversation', { conversationId: convId });
                await loadGroupInfo(convId);
                await loadConversations();
            } catch (e) { alert(e.message); }
        });
    });
}

// ── Render messages ───────────────────────────────────────────────

function renderMessages(messages, conv) {
    const el = document.getElementById('chatMessages');
    if (!messages.length) {
        el.innerHTML = `<div style="text-align:center;color:#94a3b8;font-size:13px;padding:30px;">No messages yet. Say hello! 👋</div>`;
        return;
    }

    const isGroup = conv && conv.Type === 'group';
    let html = '';
    let lastDate = '';
    let lastSenderId = null;

    messages.forEach(msg => {
        const d = new Date(msg.CreatedAt);
        const dateLabel = d.toLocaleDateString(undefined, { weekday:'long', month:'short', day:'numeric' });
        if (dateLabel !== lastDate) {
            html += `<div class="msg-date-div"><span>${ce(dateLabel)}</span></div>`;
            lastDate = dateLabel; lastSenderId = null;
        }

        const isMine   = msg.SenderID === myId();
        const isConsec = msg.SenderID === lastSenderId;
        const timeStr  = d.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });
        const img      = msg.SenderImage;
        const avHtml   = img ? `<img src="${ce(img)}" alt="">` : getInit(msg.SenderName);

        const showLabel = !isMine && isGroup && !isConsec;

        html += `
        ${showLabel ? `<div class="msg-sender-lbl" style="margin-left:36px;">${ce(msg.SenderName)}</div>` : ''}
        <div class="msg-row ${isMine ? 'mine' : ''} ${isConsec ? 'consecutive' : ''}" data-sender="${msg.SenderID}">
            <div class="msg-av" style="background:${avColor(msg.SenderID)};">${avHtml}</div>
            <div class="msg-col">
                <div class="msg-bub">${bubbleContent(msg)}<span class="msg-time">${timeStr}${tickHtml(msg, conv?.ConversationID)}</span></div>
            </div>
        </div>`;

        lastSenderId = msg.SenderID;
    });

    el.innerHTML = html;
    el.scrollTop = el.scrollHeight;
    el.querySelectorAll('.msg-img').forEach(img => img.addEventListener('click', () => openLightbox(img.src)));
}

function appendMessage(msg, scroll) {
    const el = document.getElementById('chatMessages');
    if (!el) return;

    if (!el.querySelector('.msg-row') && !el.querySelector('.msg-date-div')) el.innerHTML = '';

    const conv    = conversations.find(c => c.ConversationID === msg.ConversationID);
    const isGroup = conv && conv.Type === 'group';
    const isMine  = msg.SenderID === myId();
    const d       = new Date(msg.CreatedAt);
    const timeStr = d.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });
    const img     = msg.SenderImage;
    const avHtml  = img ? `<img src="${ce(img)}" alt="">` : getInit(msg.SenderName);

    // Add date separator if this is a new day
    const dateLabel = d.toLocaleDateString(undefined, { weekday:'long', month:'short', day:'numeric' });
    const lastDateDiv = el.querySelector('.msg-date-div:last-of-type');
    if (!lastDateDiv || lastDateDiv.querySelector('span')?.textContent !== dateLabel) {
        const sep = document.createElement('div');
        sep.className = 'msg-date-div';
        sep.innerHTML = `<span>${ce(dateLabel)}</span>`;
        el.appendChild(sep);
    }

    // Consecutive message detection (same sender as last message row)
    const lastRow = el.querySelector('.msg-row:last-of-type');
    const isConsec = lastRow && parseInt(lastRow.dataset.sender || '0', 10) === msg.SenderID;

    // Sender label for group non-consecutive messages
    if (!isMine && isGroup && !isConsec) {
        const lbl = document.createElement('div');
        lbl.className = 'msg-sender-lbl';
        lbl.style.marginLeft = '36px';
        lbl.textContent = msg.SenderName || '?';
        el.appendChild(lbl);
    }

    const div = document.createElement('div');
    div.className = `msg-row ${isMine ? 'mine' : ''} ${isConsec ? 'consecutive' : ''}`;
    div.dataset.sender = msg.SenderID;
    div.innerHTML = `
        <div class="msg-av" style="background:${avColor(msg.SenderID)};">${avHtml}</div>
        <div class="msg-col">
            <div class="msg-bub">${bubbleContent(msg)}<span class="msg-time">${timeStr}${tickHtml(msg, msg.ConversationID)}</span></div>
        </div>`;
    el.appendChild(div);
    div.querySelectorAll('.msg-img').forEach(i => i.addEventListener('click', () => openLightbox(i.src)));
    if (scroll) el.scrollTop = el.scrollHeight;
}

function bubbleContent(msg) {
    if (msg.MessageType === 'image') {
        const src = resolveBase() + msg.FileUrl;
        return `<img class="msg-img" src="${ce(src)}" alt="${ce(msg.FileName || 'image')}">`;
    }
    if (msg.MessageType === 'video') {
        const src = resolveBase() + msg.FileUrl;
        return `<video class="msg-video" controls src="${ce(src)}"></video>`;
    }
    if (msg.MessageType === 'file') {
        const src = resolveBase() + msg.FileUrl;
        const sz  = msg.FileSize ? fmtBytes(msg.FileSize) : '';
        return `<a class="msg-file" href="${ce(src)}" download="${ce(msg.FileName || 'file')}" target="_blank">
            <div class="fi"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
            <div><div class="fn">${ce(msg.FileName || 'File')}</div>${sz ? `<div class="fs">${sz}</div>` : ''}</div>
        </a>`;
    }
    return ce(msg.Content || '').replace(/\n/g, '<br>');
}

// ── Send message ──────────────────────────────────────────────────

function sendMessage() {
    const ta = document.getElementById('chatInput');
    const content = (ta?.value || '').trim();
    if (!content || !activeConvId || !socket) return;
    socket.emit('send_message', { conversationId: activeConvId, content });
    ta.value = '';
    ta.style.height = 'auto';
    emitTyping(false);
}

function emitTyping(typing) {
    if (!socket || !activeConvId) return;
    socket.emit('typing', { conversationId: activeConvId, typing });
}

async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file || !activeConvId) return;
    e.target.value = '';
    
    // Check if it's an image
    if (file.type.startsWith('image/')) {
        // Show image preview before upload
        showImagePreview(file);
    } else {
        // Non-image file - upload directly
        uploadFile(file);
    }
}

function escapeHtmlForChat(s) {
    if (!s) return '';
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
}

function showImagePreview(file) {
    const reader = new FileReader();
    reader.onload = function(event) {
        // Create preview modal
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:99999;';
        
        const modal = document.createElement('div');
        modal.style.cssText = 'background:#fff;border-radius:12px;padding:20px;max-width:500px;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.3);';
        
        const img = document.createElement('img');
        img.src = event.target.result;
        img.style.cssText = 'max-width:100%;max-height:400px;border-radius:8px;object-fit:contain;margin-bottom:16px;';
        
        const info = document.createElement('div');
        info.style.cssText = 'font-size:13px;color:#64748b;margin-bottom:16px;';
        info.innerHTML = `<strong>${escapeHtmlForChat(file.name)}</strong><br>${(file.size / 1024 / 1024).toFixed(2)} MB`;
        
        const buttons = document.createElement('div');
        buttons.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
        
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = 'padding:8px 16px;background:#e2e8f0;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;color:#64748b;';
        cancelBtn.addEventListener('click', () => document.body.removeChild(overlay));
        
        const uploadBtn = document.createElement('button');
        uploadBtn.textContent = 'Send Image';
        uploadBtn.style.cssText = 'padding:8px 16px;background:#3b82f6;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;color:#fff;';
        uploadBtn.addEventListener('click', () => {
            document.body.removeChild(overlay);
            uploadFile(file);
        });
        
        buttons.appendChild(cancelBtn);
        buttons.appendChild(uploadBtn);
        modal.appendChild(img);
        modal.appendChild(info);
        modal.appendChild(buttons);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    };
    reader.readAsDataURL(file);
}

async function uploadFile(file) {
    const fd = new FormData();
    fd.append('file', file);
    const attachBtn = document.getElementById('attachBtn');
    const sendBtn   = document.getElementById('sendBtn');
    if (attachBtn) { attachBtn.disabled = true; attachBtn.style.opacity = '0.4'; }
    if (sendBtn)   { sendBtn.disabled   = true; }
    try {
        const res = await apiUpload(`/chat/conversations/${activeConvId}/upload`, fd);
        if (res && res.success && res.message) {
            socket.emit('file_sent', { conversationId: activeConvId, message: res.message });
        }
    } catch (err) { alert('Upload failed: ' + err.message); }
    finally {
        if (attachBtn) { attachBtn.disabled = false; attachBtn.style.opacity = ''; }
        if (sendBtn)   { sendBtn.disabled   = false; }
    }
}

// ── Start DM ──────────────────────────────────────────────────────

async function startDm(userId) {
    closeAllModals();
    try {
        const res = await apiCall('/chat/conversations', { method: 'POST', body: JSON.stringify({ userId }) });
        if (res && res.success) {
            if (!conversations.find(c => c.ConversationID === res.conversationId)) {
                await loadConversations();
            }
            // Switch to chats tab
            switchTab('chats');
            openConversation(res.conversationId);
            socket.emit('join_conversation', { conversationId: res.conversationId });
        }
    } catch (err) { alert('Could not start conversation: ' + err.message); }
}

// ── Create group ──────────────────────────────────────────────────

async function createGroup() {
    const name = document.getElementById('groupNameInput').value.trim();
    if (!name) { document.getElementById('groupNameInput').focus(); return; }
    if (groupSelectedIds.size === 0) { alert('Add at least one member'); return; }

    try {
        const res = await apiCall('/chat/groups', {
            method: 'POST',
            body: JSON.stringify({ name, memberIds: [...groupSelectedIds] }),
        });
        if (res && res.success) {
            closeAllModals();
            socket.emit('notify_group_created', {
                conversationId: res.conversationId,
                groupName: name,
                memberIds: [...groupSelectedIds],
            });
            socket.emit('join_conversation', { conversationId: res.conversationId });
            await loadConversations();
            switchTab('chats');
            openConversation(res.conversationId);
        }
    } catch (err) { alert('Could not create group: ' + err.message); }
}

// ── Broadcast ─────────────────────────────────────────────────────

async function sendBroadcast() {
    const content = document.getElementById('bcastContent').value.trim();
    if (!content) return;
    try {
        await apiCall('/chat/broadcast', { method: 'POST', body: JSON.stringify({ content }) });
        closeAllModals();
        document.getElementById('bcastContent').value = '';
    } catch (err) { alert('Broadcast failed: ' + err.message); }
}

function showBroadcastToast(content, senderName) {
    const toast = document.getElementById('bcastToast');
    document.getElementById('btTxt').textContent = content;
    document.getElementById('btWho').textContent = `From: ${senderName || 'Admin'}`;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 6000);
}

// ── Nav unread badge ──────────────────────────────────────────────

function updateNavBadge() {
    const total = conversations.reduce((s, c) => s + (c.UnreadCount || 0), 0);
    const badgeEl = document.getElementById('chatNavBadge');
    if (!badgeEl) return;
    if (total > 0) {
        badgeEl.textContent = total > 99 ? '99+' : total;
        badgeEl.style.display = '';
    } else {
        badgeEl.style.display = 'none';
    }
}

// ── Modals ────────────────────────────────────────────────────────

function openDmModal() {
    document.getElementById('dmModal').classList.add('open');
    const input = document.getElementById('dmSearch');
    input.value = '';
    renderDmUserList('');
    input.focus();
}

function renderDmUserList(q) {
    const el = document.getElementById('dmUserList');
    const list = allUsers.filter(u => !q || u.Name.toLowerCase().includes(q.toLowerCase()) || (u.Role || '').toLowerCase().includes(q.toLowerCase()));
    if (!list.length) { el.innerHTML = `<div style="padding:14px;text-align:center;color:#94a3b8;font-size:13px;">No users</div>`; return; }
    el.innerHTML = list.map(u => {
        const img = u.ProfileImageUrl;
        const avHtml = img ? `<img src="${ce(img)}" alt="">` : getInit(u.Name);
        const online = onlineUsers.has(u.EmployeeID);
        return `
        <div class="mu-item" data-uid="${u.EmployeeID}">
            <div class="mu-av" style="background:${avColor(u.EmployeeID)};position:relative;">
                ${avHtml}
                ${online ? '<span style="position:absolute;bottom:0;right:0;width:9px;height:9px;border-radius:50%;background:#22c55e;border:2px solid #fff;"></span>' : ''}
            </div>
            <div><div class="mu-name">${ce(u.Name)}</div></div>
            ${online ? '<span style="margin-left:auto;font-size:11px;color:#22c55e;font-weight:600;">Online</span>' : ''}
        </div>`;
    }).join('');
    el.querySelectorAll('.mu-item').forEach(item => {
        item.addEventListener('click', () => startDm(parseInt(item.dataset.uid, 10)));
    });
}

function openGroupModal() {
    groupSelectedIds.clear();
    document.getElementById('groupModal').classList.add('open');
    document.getElementById('groupNameInput').value = '';
    document.getElementById('groupSearch').value = '';
    document.getElementById('groupBadges').innerHTML = '';
    renderGroupUserList('');
    document.getElementById('groupNameInput').focus();
}

function renderGroupUserList(q) {
    const el = document.getElementById('groupUserList');
    const list = allUsers.filter(u => !q || u.Name.toLowerCase().includes(q.toLowerCase()));
    el.innerHTML = list.map(u => {
        const sel = groupSelectedIds.has(u.EmployeeID);
        const img = u.ProfileImageUrl;
        const avHtml = img ? `<img src="${ce(img)}" alt="">` : getInit(u.Name);
        return `
        <div class="mu-item ${sel ? 'sel' : ''}" data-uid="${u.EmployeeID}">
            <div class="mu-av" style="background:${avColor(u.EmployeeID)};">${avHtml}</div>
            <div><div class="mu-name">${ce(u.Name)}</div></div>
            <div class="mu-chk">${sel ? '✓' : ''}</div>
        </div>`;
    }).join('');
    el.querySelectorAll('.mu-item').forEach(item => {
        item.addEventListener('click', () => {
            const uid = parseInt(item.dataset.uid, 10);
            if (groupSelectedIds.has(uid)) groupSelectedIds.delete(uid);
            else groupSelectedIds.add(uid);
            updateGroupBadges();
            renderGroupUserList(document.getElementById('groupSearch').value);
        });
    });
}

function updateGroupBadges() {
    const wrap = document.getElementById('groupBadges');
    const selected = allUsers.filter(u => groupSelectedIds.has(u.EmployeeID));
    wrap.innerHTML = selected.map(u => `
        <div class="sel-badge" data-uid="${u.EmployeeID}">
            ${ce(u.Name.split(' ')[0])}
            <button onclick="groupSelectedIds.delete(${u.EmployeeID});updateGroupBadges();renderGroupUserList(document.getElementById('groupSearch').value)">×</button>
        </div>`).join('');
}

function closeAllModals() {
    document.querySelectorAll('.cm-overlay').forEach(m => m.classList.remove('open'));
}

// ── Admin: Manage Chat Users ──────────────────────────────────────

let _manageChatUsers = [];

async function openManageChatModal() {
    document.getElementById('manageChatModal')?.classList.add('open');
    document.getElementById('manageChatSearch').value = '';
    await renderManageChatUsers('');
}

async function renderManageChatUsers(q) {
    const wrap = document.getElementById('manageChatList');
    if (!wrap) return;
    wrap.innerHTML = '<div style="color:#94a3b8;font-size:13px;padding:12px;">Loading…</div>';
    try {
        const res = await apiCall('/chat/admin/users');
        _manageChatUsers = res.users || res || [];
    } catch (_) { wrap.innerHTML = '<div style="color:#ef4444;padding:12px;">Failed to load users.</div>'; return; }

    const filtered = q ? _manageChatUsers.filter(u => u.Name.toLowerCase().includes(q.toLowerCase())) : _manageChatUsers;
    if (!filtered.length) { wrap.innerHTML = '<div style="color:#94a3b8;font-size:13px;padding:12px;">No users found.</div>'; return; }

    const inChat  = filtered.filter(u => u.ChatEnabled);
    const removed = filtered.filter(u => !u.ChatEnabled);

    const rowHtml = (u) => `
        <div class="mcu-row" id="mcuRow_${u.EmployeeID}">
            <div class="msg-av" style="background:${avColor(u.EmployeeID)};">${getInit(u.Name)}</div>
            <div style="flex:1;min-width:0;">
                <div style="font-weight:500;font-size:13px;">${ce(u.Name)}</div>
            </div>
            ${u.ChatEnabled
                ? `<button class="mcu-icon-btn mcu-delete" title="Remove from chat" onclick="setChatUserEnabled(${u.EmployeeID}, false)">
                       <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                   </button>`
                : `<button class="mcu-icon-btn mcu-add" title="Add to chat" onclick="setChatUserEnabled(${u.EmployeeID}, true)">
                       <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                   </button>`
            }
        </div>`;

    let html = '';
    if (inChat.length) {
        html += `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#64748b;padding:8px 4px 4px;">In Chat (${inChat.length})</div>`;
        html += inChat.map(rowHtml).join('');
    }
    if (removed.length) {
        html += `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#64748b;padding:12px 4px 4px;">Removed (${removed.length})</div>`;
        html += removed.map(rowHtml).join('');
    }
    wrap.innerHTML = html;
}

async function setChatUserEnabled(empId, enable) {
    const row = document.getElementById(`mcuRow_${empId}`);
    if (row) row.style.opacity = '0.5';
    try {
        const res = await apiCall(`/chat/admin/users/${empId}/toggle`, {
            method: 'POST',
            body: JSON.stringify({ enable }),
        });
        const nowEnabled = res.chatEnabled === 1 || res.chatEnabled === true;
        const u = _manageChatUsers.find(x => x.EmployeeID === empId);
        if (u) u.ChatEnabled = nowEnabled ? 1 : 0;
        // Re-render the whole list to move user between sections
        await renderManageChatUsers(document.getElementById('manageChatSearch')?.value || '');
    } catch (_) {
        if (row) row.style.opacity = '1';
        alert('Failed to update chat access. Please try again.');
    }
}

// ── UI setup ──────────────────────────────────────────────────────

function setupUI() {
    // Tab switching
    document.querySelectorAll('.cs-tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Search
    document.getElementById('chatSearch')?.addEventListener('input', (e) => {
        renderConvList();
        renderContactList();
    });

    // New DM
    document.getElementById('btnNewDm')?.addEventListener('click', openDmModal);
    document.getElementById('closeDmModal')?.addEventListener('click', closeAllModals);
    document.getElementById('dmSearch')?.addEventListener('input', e => renderDmUserList(e.target.value));
    document.getElementById('dmModal')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeAllModals(); });

    // New Group
    document.getElementById('btnNewGroup')?.addEventListener('click', openGroupModal);
    document.getElementById('closeGroupModal')?.addEventListener('click', closeAllModals);
    document.getElementById('cancelGroupModal')?.addEventListener('click', closeAllModals);
    document.getElementById('groupSearch')?.addEventListener('input', e => renderGroupUserList(e.target.value));
    document.getElementById('confirmGroup')?.addEventListener('click', createGroup);
    document.getElementById('groupModal')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeAllModals(); });

    // Manage Chat Users (admin)
    document.getElementById('btnManageChat')?.addEventListener('click', openManageChatModal);
    document.getElementById('closeManageChatModal')?.addEventListener('click', closeAllModals);
    document.getElementById('manageChatSearch')?.addEventListener('input', e => renderManageChatUsers(e.target.value));
    document.getElementById('manageChatModal')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeAllModals(); });

    // Broadcast
    document.getElementById('btnBcast')?.addEventListener('click', () => document.getElementById('bcastModal').classList.add('open'));
    document.getElementById('closeBcastModal')?.addEventListener('click', closeAllModals);
    document.getElementById('cancelBcastModal')?.addEventListener('click', closeAllModals);
    document.getElementById('confirmBcast')?.addEventListener('click', sendBroadcast);
    document.getElementById('bcastModal')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeAllModals(); });

    // Add member modal
    document.getElementById('closeAddMemberModal')?.addEventListener('click', closeAllModals);
    document.getElementById('addMemberModal')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeAllModals(); });

    // Message input
    const ta  = document.getElementById('chatInput');
    const snd = document.getElementById('sendBtn');

    ta?.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    ta?.addEventListener('input', () => {
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
        emitTyping(true);
        clearTimeout(typingTimers._me);
        typingTimers._me = setTimeout(() => emitTyping(false), 1500);
    });
    snd?.addEventListener('click', sendMessage);

    // File attach
    document.getElementById('attachBtn')?.addEventListener('click', () => document.getElementById('fileInput')?.click());
    document.getElementById('fileInput')?.addEventListener('change', handleFileUpload);

    // Lightbox
    document.getElementById('imgLightbox')?.addEventListener('click', () => {
        document.getElementById('imgLightbox').classList.remove('open');
    });

    // Emoji picker init
    initEmojiPicker();
}

const POPULAR_EMOJIS = [
    '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '😉', '😍', '🥰', '😘',
    '😋', '😛', '😜', '😎', '😏', '😒', '😔', '😟', '🥺', '😢', '😭', '😤', '😠', '😡', '🤯',
    '😳', '😱', '🤫', '🥱', '😴', '💩', '👻', '💀', '👽', '👍', '👎', '👊', '✌️', '👌', '👋',
    '👏', '🙌', '🙏', '🤝', '💪', '🧠', '👀', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💔',
    '🔥', '✨', '🌟', '🎉', '💡', '💯', '🚀', '⭐', '🎈', '🎨', '✈️', '💻', '📞', '🔔', '🔒'
];

function initEmojiPicker() {
    const picker = document.getElementById('emojiPicker');
    if (!picker) return;
    picker.innerHTML = POPULAR_EMOJIS.map(emoji => `<span class="emoji-item">${emoji}</span>`).join('');
    
    // Toggle on button click
    const btn = document.getElementById('emojiBtn');
    btn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const display = picker.style.display;
        picker.style.display = display === 'grid' ? 'none' : 'grid';
    });
    
    // Insert emoji on click
    picker.addEventListener('click', (e) => {
        if (e.target.classList.contains('emoji-item')) {
            const emoji = e.target.textContent;
            const input = document.getElementById('chatInput');
            if (input) {
                insertAtCursor(input, emoji);
                // trigger input event to resize textarea height & trigger typing indicator
                input.dispatchEvent(new Event('input'));
            }
        }
    });
    
    // Close picker when clicking outside
    document.addEventListener('click', (e) => {
        if (!picker.contains(e.target) && e.target !== btn && !btn?.contains(e.target)) {
            picker.style.display = 'none';
        }
    });
}

function insertAtCursor(myField, myValue) {
    if (myField.selectionStart || myField.selectionStart === 0 || myField.selectionStart === '0') {
        const startPos = myField.selectionStart;
        const endPos = myField.selectionEnd;
        myField.value = myField.value.substring(0, startPos)
            + myValue
            + myField.value.substring(endPos, myField.value.length);
        myField.selectionStart = startPos + myValue.length;
        myField.selectionEnd = startPos + myValue.length;
    } else {
        myField.value += myValue;
    }
}

function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.cs-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.getElementById('convList').style.display = tab === 'chats' ? '' : 'none';
    document.getElementById('contactList').style.display = tab === 'contacts' ? '' : 'none';
}

// ── Lightbox ──────────────────────────────────────────────────────

function openLightbox(src) {
    document.getElementById('lightboxImg').src = src;
    document.getElementById('imgLightbox').classList.add('open');
}

// ── Utils ─────────────────────────────────────────────────────────

function myId() { return me.EmployeeID || me.id || 0; }

function avColor(id) { return AV_COLORS[(parseInt(id, 10) || 0) % AV_COLORS.length]; }

function getInit(name) {
    if (!name) return '?';
    return name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function ce(str) {
    if (str == null) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtBytes(b) {
    if (!b) return '';
    if (b < 1024) return b + ' B';
    if (b < 1024*1024) return (b/1024).toFixed(1) + ' KB';
    return (b/(1024*1024)).toFixed(1) + ' MB';
}

function relTime(d) {
    const diff = Date.now() - new Date(d).getTime();
    if (diff < 60000) return 'now';
    if (diff < 3600000) return Math.floor(diff/60000) + 'm';
    if (diff < 86400000) return Math.floor(diff/3600000) + 'h';
    return new Date(d).toLocaleDateString(undefined, { month:'short', day:'numeric' });
}

function resolveBase() {
    const base = window.PORTAL_API_BASE || '';
    return base ? base.replace(/\/api\/?$/, '') : window.location.origin;
}
