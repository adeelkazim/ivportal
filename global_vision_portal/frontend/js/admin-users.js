let allUsersData = [];
let sortCol = 'id';
let sortAsc  = true;
let _bulkParsed = [];
let pendingUserImageUrl = null; // tracks new photo chosen in the edit modal

document.addEventListener('DOMContentLoaded', async function() {
    checkAuth();
    if (!isManagerOrAdmin()) {
        window.location.href = 'dashboard.html';
        return;
    }

    document.getElementById('btnAddUser')?.addEventListener('click', () => openUserModal());
    document.getElementById('btnCancelUser')?.addEventListener('click', closeUserModal);
    document.getElementById('userForm')?.addEventListener('submit', saveUser);

    document.getElementById('userSearchFilter')?.addEventListener('input', applyUserFilters);
    document.getElementById('userRoleFilter')?.addEventListener('change', applyUserFilters);
    document.getElementById('userStatusFilter')?.addEventListener('change', applyUserFilters);

    document.getElementById('thId')?.addEventListener('click', () => toggleSort('id'));
    document.getElementById('thName')?.addEventListener('click', () => toggleSort('name'));

    document.getElementById('userModalImageInput')?.addEventListener('change', handleUserModalImageChange);

    // Bulk upload
    document.getElementById('btnBulkUpload')?.addEventListener('click', openBulkModal);
    document.getElementById('btnCancelBulk')?.addEventListener('click', closeBulkModal);
    document.getElementById('btnDownloadSample')?.addEventListener('click', downloadBulkSample);
    document.getElementById('btnSubmitBulk')?.addEventListener('click', submitBulkUpload);
    const dropZone = document.getElementById('bulkDropZone');
    const fileInput = document.getElementById('bulkFileInput');
    dropZone?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', e => handleBulkFile(e.target.files[0]));
    dropZone?.addEventListener('dragover', e => { e.preventDefault(); dropZone.style.borderColor = '#3b82f6'; });
    dropZone?.addEventListener('dragleave', () => { dropZone.style.borderColor = '#cbd5e1'; });
    dropZone?.addEventListener('drop', e => { e.preventDefault(); dropZone.style.borderColor = '#cbd5e1'; handleBulkFile(e.dataTransfer.files[0]); });

    // Team management
    document.getElementById('btnAddTeamUser')?.addEventListener('click', showTeamAddRow);
    document.getElementById('confirmTeamUser')?.addEventListener('click', submitNewTeam);
    document.getElementById('cancelTeamUser')?.addEventListener('click', hideTeamAddRow);
    document.getElementById('newTeamNameUser')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); submitNewTeam(); }
        if (e.key === 'Escape') hideTeamAddRow();
    });

    // Client management
    document.getElementById('btnAddClient')?.addEventListener('click', showClientAddRow);
    document.getElementById('confirmClient')?.addEventListener('click', submitNewClient);
    document.getElementById('cancelClient')?.addEventListener('click', hideClientAddRow);
    document.getElementById('newClientName')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); submitNewClient(); }
        if (e.key === 'Escape') hideClientAddRow();
    });

    initWorkingHours();
    initManagerTeams();

    await loadRolesAndTeams();
    await loadUsers();
    await loadTeamsPanel();
    await loadClientsPanel();
    await loadWorkingHours();
});

async function loadRolesAndTeams() {
    try {
        const rolesRes = await apiCall('/admin/roles');
        const roles = rolesRes.roles || [];

        const isSuperAdmin = (getUser()?.Email || '').toLowerCase() === 'admin1234@gmail.com';
        const visibleRoles = isSuperAdmin
            ? roles
            : roles.filter(r => r.name.toLowerCase() !== 'financemanager');

        const select = document.getElementById('userRole');
        if (select) {
            select.innerHTML = visibleRoles.map(r =>
                `<option value="${escapeHtml(r.name)}">${escapeHtml(r.name)}</option>`
            ).join('');
        }

        const roleFilter = document.getElementById('userRoleFilter');
        if (roleFilter) {
            roleFilter.innerHTML = '<option value="">All roles</option>' +
                visibleRoles.map(r => `<option value="${escapeHtml(r.name)}">${escapeHtml(r.name)}</option>`).join('');
        }
        const teamsRes = await apiCall('/teams');
        const teamSelect = document.getElementById('userTeam');
        if (teamSelect && teamsRes.teams) {
            teamSelect.innerHTML = '<option value="">— None —</option>' +
                teamsRes.teams.map(t => `<option value="${t.TeamID}">${escapeHtml(t.TeamName)}</option>`).join('');
        }
        const clientsRes = await apiCall('/clients');
        const clientSelect = document.getElementById('userClient');
        if (clientSelect && clientsRes.clients) {
            clientSelect.innerHTML = '<option value="">— None —</option>' +
                clientsRes.clients.map(c => `<option value="${c.cliClientID}">${escapeHtml(c.cliClientName)}</option>`).join('');
        }
    } catch (e) {
        showMsg(e.message, 'error');
    }
}

async function loadUsers() {
    const body = document.getElementById('usersBody');
    try {
        const res = await apiCall('/admin/users');
        allUsersData = res.users || [];

        const activeCount = allUsersData.filter(u => u.isActive !== false && u.IsActive !== 0).length;
        document.getElementById('statUsers').textContent = allUsersData.length;
        document.getElementById('statUsersActive').textContent = activeCount;
        document.getElementById('statUsersInactive').textContent = allUsersData.length - activeCount;

        applyUserFilters();
    } catch (e) {
        body.innerHTML = `<tr><td colspan="9" class="text-center">${escapeHtml(e.message)}</td></tr>`;
    }
}

function toggleSort(col) {
    if (sortCol === col) {
        sortAsc = !sortAsc;
    } else {
        sortCol = col;
        sortAsc = col === 'id';
    }
    updateSortHeaders();
    applyUserFilters();
}

function updateSortHeaders() {
    const thId   = document.getElementById('thId');
    const thName = document.getElementById('thName');
    if (thId)   thId.textContent   = 'ID'   + (sortCol === 'id'   ? (sortAsc ? ' ▲' : ' ▼') : '');
    if (thName) thName.textContent = 'Name' + (sortCol === 'name' ? (sortAsc ? ' ▲' : ' ▼') : '');
}

function applyUserFilters() {
    const body       = document.getElementById('usersBody');
    const search     = (document.getElementById('userSearchFilter')?.value || '').toLowerCase().trim();
    const roleFilter = (document.getElementById('userRoleFilter')?.value || '').toLowerCase();
    const status     = (document.getElementById('userStatusFilter')?.value || '');

    let filtered = allUsersData.filter(u => {
        const name     = (u.Name || u.name || '').toLowerCase();
        const email    = (u.Email || u.email || '').toLowerCase();
        const username = (u.Username || u.username || '').toLowerCase();
        const role     = (u.Role || u.role || '').toLowerCase();
        const active   = u.isActive !== false && u.IsActive !== 0;

        if (search && !name.includes(search) && !email.includes(search) && !username.includes(search)) return false;
        if (roleFilter && role !== roleFilter) return false;
        if (status === 'active' && !active) return false;
        if (status === 'inactive' && active) return false;
        return true;
    });

    filtered.sort((a, b) => {
        let va, vb;
        if (sortCol === 'id') {
            va = a.EmployeeID || a.id || 0;
            vb = b.EmployeeID || b.id || 0;
        } else {
            va = (a.Name || a.name || '').toLowerCase();
            vb = (b.Name || b.name || '').toLowerCase();
        }
        if (va < vb) return sortAsc ? -1 : 1;
        if (va > vb) return sortAsc ? 1 : -1;
        return 0;
    });

    const countEl = document.getElementById('usersFilterCount');
    if (countEl) {
        const showing = filtered.length !== allUsersData.length;
        countEl.style.display = showing ? 'block' : 'none';
        countEl.textContent = `Showing ${filtered.length} of ${allUsersData.length} users`;
    }

    if (!filtered.length) {
        body.innerHTML = '<tr><td colspan="9" class="text-center text-muted">No users match the current filters.</td></tr>';
        return;
    }

    body.innerHTML = filtered.map(u => {
        const active = u.isActive !== false && u.IsActive !== 0;
        const role   = u.Role || u.role || '—';
        const rolePillClass = role === 'Admin' ? 'admin-pill-danger' : role === 'Manager' ? 'admin-pill-warning' : 'admin-pill-info';
        const imgUrl = u.profileImageUrl || u.ProfileImageUrl || null;
        const initials = (u.Name || u.name || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
        const avatarHtml = imgUrl
            ? `<img src="${escapeHtml(imgUrl)}" alt="" style="width:32px;height:32px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:8px;">`
            : `<span style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;background:#dbeafe;color:#1e40af;font-size:12px;font-weight:700;vertical-align:middle;margin-right:8px;">${escapeHtml(initials)}</span>`;
        return `<tr>
            <td><strong>${u.EmployeeID || u.id}</strong></td>
            <td style="white-space:nowrap;">${avatarHtml}${escapeHtml(u.Name || u.name)}</td>
            <td>${escapeHtml(u.Email || u.email)}</td>
            <td>${escapeHtml(u.Username || u.username || '—')}</td>
            <td><span class="admin-pill ${rolePillClass}">${escapeHtml(role)}</span></td>
            <td>${escapeHtml(u.ClientName || u.clientName || '—')}</td>
            <td>${escapeHtml(u.TeamName || u.teamName || '—')}</td>
            <td><span class="admin-pill ${active ? 'admin-pill-success' : 'admin-pill-muted'}">${active ? 'Active' : 'Inactive'}</span></td>
            <td class="admin-actions-row">
                <button type="button" class="admin-link-btn" data-edit="${u.EmployeeID || u.id}">Edit</button>
                ${active ? `<button type="button" class="admin-link-btn danger" data-deactivate="${u.EmployeeID || u.id}">Deactivate</button>` : ''}
            </td>
        </tr>`;
    }).join('');

    body.querySelectorAll('[data-edit]').forEach(btn => {
        btn.addEventListener('click', () => editUser(parseInt(btn.dataset.edit, 10)));
    });
    body.querySelectorAll('[data-deactivate]').forEach(btn => {
        btn.addEventListener('click', () => deactivateUser(parseInt(btn.dataset.deactivate, 10)));
    });
}

function openUserModal(user) {
    pendingUserImageUrl = null;
    const input = document.getElementById('userModalImageInput');
    if (input) input.value = '';
    const msgEl = document.getElementById('userModalImgMsg');
    if (msgEl) msgEl.style.display = 'none';

    const modal = document.getElementById('userModal');
    modal.style.display = 'flex';
    modal.classList.add('is-open');
    document.getElementById('userModalTitle').textContent = user ? 'Edit user' : 'Add user';
    document.getElementById('userFormId').value = user ? (user.EmployeeID || user.id) : '';
    document.getElementById('userName').value = user ? (user.Name || user.name) : '';
    document.getElementById('userEmail').value = user ? (user.Email || user.email) : '';
    document.getElementById('userUsername').value = user ? (user.Username || user.username || '') : '';
    document.getElementById('userPassword').value = '';
    document.getElementById('userPassword').required = !user;
    document.getElementById('passwordHint').textContent = user ? '(leave blank to keep)' : '*';
    document.getElementById('userRole').value = user ? (user.Role || user.role) : 'Employee';
    document.getElementById('userClient').value = user && (user.ClientID || user.clientId) ? (user.ClientID || user.clientId) : '';
    document.getElementById('userContact').value = user ? (user.Contact || user.contact || '') : '';
    document.getElementById('userDesignation').value = user ? (user.Designation || user.designation || '') : '';
    document.getElementById('userTeam').value = user && (user.TeamID || user.teamId) ? (user.TeamID || user.teamId) : '';
    document.getElementById('userActive').checked = user ? (user.isActive !== false && user.IsActive !== 0) : true;

    // Avatar preview in modal
    const existingUrl = user ? (user.profileImageUrl || user.ProfileImageUrl || null) : null;
    setModalAvatar(existingUrl, user ? (user.Name || user.name || '') : '');
}

function setModalAvatar(imageUrl, name) {
    const img      = document.getElementById('userModalAvatarImg');
    const initials = document.getElementById('userModalAvatarInitials');
    if (!img || !initials) return;
    if (imageUrl) {
        img.src = imageUrl;
        img.style.display = '';
        initials.style.display = 'none';
    } else {
        img.style.display = 'none';
        initials.textContent = name
            ? name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
            : '?';
        initials.style.display = '';
    }
}

async function handleUserModalImageChange(e) {
    const file = e.target.files?.[0];
    const msgEl = document.getElementById('userModalImgMsg');
    if (!file) return;

    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.type)) {
        if (msgEl) { msgEl.textContent = 'Only JPEG, PNG, WebP or GIF allowed.'; msgEl.style.color = '#dc2626'; msgEl.style.display = ''; }
        e.target.value = '';
        return;
    }
    if (file.size > 2 * 1024 * 1024) {
        if (msgEl) { msgEl.textContent = 'Image must be under 2 MB.'; msgEl.style.color = '#dc2626'; msgEl.style.display = ''; }
        e.target.value = '';
        return;
    }

    try {
        if (msgEl) { msgEl.textContent = 'Processing…'; msgEl.style.color = '#6b7280'; msgEl.style.display = ''; }
        const compressed = await compressImageData(file, 320, 320, 0.85);
        pendingUserImageUrl = compressed;
        setModalAvatar(compressed, document.getElementById('userName')?.value || '');
        if (msgEl) { msgEl.textContent = 'Photo ready — save to apply.'; msgEl.style.color = '#16a34a'; msgEl.style.display = ''; }
    } catch (err) {
        if (msgEl) { msgEl.textContent = 'Could not process image.'; msgEl.style.color = '#dc2626'; msgEl.style.display = ''; }
    }
}

function compressImageData(file, maxW, maxH, quality) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Read failed'));
        reader.onload = (ev) => {
            const img = new Image();
            img.onerror = () => reject(new Error('Decode failed'));
            img.onload = () => {
                const scale  = Math.min(1, maxW / img.width, maxH / img.height);
                const canvas = document.createElement('canvas');
                canvas.width  = Math.round(img.width  * scale);
                canvas.height = Math.round(img.height * scale);
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    });
}

function closeUserModal() {
    const modal = document.getElementById('userModal');
    modal.style.display = 'none';
    modal.classList.remove('is-open');
}

function editUser(id) {
    const user = allUsersData.find(u => (u.EmployeeID || u.id) === id);
    openUserModal(user);
}

async function saveUser(e) {
    e.preventDefault();
    const id = document.getElementById('userFormId').value;
    const payload = {
        name: document.getElementById('userName').value.trim(),
        email: document.getElementById('userEmail').value.trim(),
        username: document.getElementById('userUsername').value.trim(),
        clientId: document.getElementById('userClient').value || null,
        contact: document.getElementById('userContact').value.trim(),
        role: document.getElementById('userRole').value,
        designation: document.getElementById('userDesignation').value.trim(),
        teamId: document.getElementById('userTeam').value || null,
        isActive: document.getElementById('userActive').checked,
    };
    const pwd = document.getElementById('userPassword').value;
    if (pwd) payload.password = pwd;
    if (pendingUserImageUrl !== null) payload.profileImageUrl = pendingUserImageUrl;

    try {
        if (id) {
            await apiCall(`/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
            showMsg('User updated', 'success');
        } else {
            if (!pwd) {
                showMsg('Password is required for new users', 'error');
                return;
            }
            await apiCall('/admin/users', { method: 'POST', body: JSON.stringify(payload) });
            showMsg('User created', 'success');
        }
        pendingUserImageUrl = null;
        closeUserModal();
        await loadUsers();
    } catch (err) {
        showMsg(err.message, 'error');
    }
}

async function deactivateUser(id) {
    if (!confirm('Deactivate this user? They will not be able to log in.')) return;
    try {
        await apiCall(`/admin/users/${id}`, { method: 'DELETE' });
        showMsg('User deactivated', 'success');
        await loadUsers();
    } catch (e) {
        showMsg(e.message, 'error');
    }
}

function showMsg(text, type) {
    const el = document.getElementById('usersMessage');
    if (!el) return;
    el.textContent = text;
    el.className = `message ${type}`;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 4000);
}

function escapeHtml(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

// ── Team Management ──────────────────────────────────────────

async function loadTeamsPanel() {
    const el = document.getElementById('teamListUser');
    if (!el) return;
    try {
        const res = await apiCall('/teams');
        const teams = (res && res.teams) || [];

        if (!teams.length) {
            el.innerHTML = '<p class="text-muted" style="font-size:13px;">No teams yet. Click "+ New Team" to add one.</p>';
            return;
        }

        el.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:10px;">` +
            teams.map(t => `
                <div class="team-chip" data-tid="${t.TeamID}">
                    <span class="team-chip-name">${escapeHtml(t.TeamName)}</span>
                    <button type="button" class="team-chip-btn edit" data-edit-tid="${t.TeamID}" data-edit-tname="${escapeHtml(t.TeamName)}" title="Rename">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button type="button" class="team-chip-btn delete" data-del-tid="${t.TeamID}" data-del-tname="${escapeHtml(t.TeamName)}" title="Delete">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                            <path d="M10 11v6M14 11v6"/>
                        </svg>
                    </button>
                </div>
            `).join('') + `</div>`;

        el.querySelectorAll('[data-edit-tid]').forEach(btn => {
            btn.addEventListener('click', () => startChipRename(btn.dataset.editTid, btn.dataset.editTname));
        });
        el.querySelectorAll('[data-del-tid]').forEach(btn => {
            btn.addEventListener('click', () => deleteTeamUser(btn.dataset.delTid, btn.dataset.delTname));
        });
    } catch (e) {
        el.innerHTML = `<p class="text-danger" style="font-size:13px;">${escapeHtml(e.message)}</p>`;
    }
}

function showTeamAddRow() {
    const row = document.getElementById('teamAddRowUser');
    const input = document.getElementById('newTeamNameUser');
    if (row) { row.style.display = 'block'; }
    if (input) { input.value = ''; input.focus(); }
}

function hideTeamAddRow() {
    const row = document.getElementById('teamAddRowUser');
    const input = document.getElementById('newTeamNameUser');
    if (row) row.style.display = 'none';
    if (input) input.value = '';
}

async function submitNewTeam() {
    const input = document.getElementById('newTeamNameUser');
    const name  = (input?.value || '').trim();
    if (!name) { input?.focus(); return; }
    try {
        await apiCall('/admin/teams', { method: 'POST', body: JSON.stringify({ name }) });
        hideTeamAddRow();
        showTeamMsg(`Team "${name}" created.`, 'success');
        await loadTeamsPanel();
        await loadRolesAndTeams();
    } catch (e) { showTeamMsg(e.message, 'error'); }
}

function startChipRename(id, currentName) {
    const chip = document.getElementById('teamListUser').querySelector(`[data-tid="${id}"]`);
    if (!chip || chip.querySelector('input')) return;

    const nameSpan = chip.querySelector('.team-chip-name');
    const orig     = nameSpan.textContent;

    nameSpan.innerHTML = `
        <input type="text" value="${escapeHtml(orig)}"
            style="padding:2px 6px;font-size:12px;border:1.5px solid #93c5fd;border-radius:6px;width:110px;outline:none;">
    `;
    const input = nameSpan.querySelector('input');
    input.focus(); input.select();

    const commit = async () => {
        const newName = input.value.trim();
        nameSpan.textContent = orig;
        if (!newName || newName === orig) return;
        try {
            await apiCall(`/admin/teams/${id}`, { method: 'PUT', body: JSON.stringify({ name: newName }) });
            showTeamMsg(`Renamed to "${newName}".`, 'success');
            await loadTeamsPanel();
            await loadRolesAndTeams();
        } catch (e) { showTeamMsg(e.message, 'error'); }
    };

    input.addEventListener('keydown', async e => {
        if (e.key === 'Enter') { e.preventDefault(); await commit(); }
        if (e.key === 'Escape') { nameSpan.textContent = orig; }
    });
    input.addEventListener('blur', commit);
}

async function deleteTeamUser(id, name) {
    if (!confirm(`Delete team "${name}"?\nEmployees in this team will become teamless.`)) return;
    try {
        await apiCall(`/admin/teams/${id}`, { method: 'DELETE' });
        showTeamMsg(`Team "${name}" deleted.`, 'success');
        await loadTeamsPanel();
        await loadRolesAndTeams();
    } catch (e) { showTeamMsg(e.message, 'error'); }
}

function showTeamMsg(text, type) {
    const el = document.getElementById('teamMsgUser');
    if (!el) return;
    el.textContent   = text;
    el.className     = `message ${type}`;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 4000);
}

// ── Client Management ─────────────────────────────────────────

async function loadClientsPanel() {
    const el = document.getElementById('clientListPanel');
    if (!el) return;
    try {
        const res = await apiCall('/clients');
        const clients = (res && res.clients) || [];

        if (!clients.length) {
            el.innerHTML = '<p class="text-muted" style="font-size:13px;">No clients yet. Click "+ New Client" to add one.</p>';
            return;
        }

        el.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:10px;">` +
            clients.map(c => `
                <div class="team-chip" data-cid="${c.cliClientID}">
                    <span class="team-chip-name">${escapeHtml(c.cliClientName)}</span>
                    <button type="button" class="team-chip-btn edit" data-edit-cid="${c.cliClientID}" data-edit-cname="${escapeHtml(c.cliClientName)}" title="Rename">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button type="button" class="team-chip-btn delete" data-del-cid="${c.cliClientID}" data-del-cname="${escapeHtml(c.cliClientName)}" title="Delete">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                            <path d="M10 11v6M14 11v6"/>
                        </svg>
                    </button>
                </div>
            `).join('') + `</div>`;

        el.querySelectorAll('[data-edit-cid]').forEach(btn => {
            btn.addEventListener('click', () => startClientRename(btn.dataset.editCid, btn.dataset.editCname));
        });
        el.querySelectorAll('[data-del-cid]').forEach(btn => {
            btn.addEventListener('click', () => deleteClient(btn.dataset.delCid, btn.dataset.delCname));
        });
    } catch (e) {
        el.innerHTML = `<p class="text-danger" style="font-size:13px;">${escapeHtml(e.message)}</p>`;
    }
}

function showClientAddRow() {
    const row = document.getElementById('clientAddRow');
    const input = document.getElementById('newClientName');
    if (row) { row.style.display = 'block'; }
    if (input) { input.value = ''; input.focus(); }
}

function hideClientAddRow() {
    const row = document.getElementById('clientAddRow');
    const input = document.getElementById('newClientName');
    if (row) row.style.display = 'none';
    if (input) input.value = '';
}

async function submitNewClient() {
    const input = document.getElementById('newClientName');
    const name  = (input?.value || '').trim();
    if (!name) { input?.focus(); return; }
    try {
        await apiCall('/admin/clients', { method: 'POST', body: JSON.stringify({ name }) });
        hideClientAddRow();
        showClientMsg(`Client "${name}" created.`, 'success');
        await loadClientsPanel();
        await loadRolesAndTeams();
    } catch (e) { showClientMsg(e.message, 'error'); }
}

function startClientRename(id, currentName) {
    const chip = document.getElementById('clientListPanel').querySelector(`[data-cid="${id}"]`);
    if (!chip || chip.querySelector('input')) return;

    const nameSpan = chip.querySelector('.team-chip-name');
    const orig     = nameSpan.textContent;

    nameSpan.innerHTML = `
        <input type="text" value="${escapeHtml(orig)}"
            style="padding:2px 6px;font-size:12px;border:1.5px solid #93c5fd;border-radius:6px;width:130px;outline:none;">
    `;
    const input = nameSpan.querySelector('input');
    input.focus(); input.select();

    const commit = async () => {
        const newName = input.value.trim();
        nameSpan.textContent = orig;
        if (!newName || newName === orig) return;
        try {
            await apiCall(`/admin/clients/${id}`, { method: 'PUT', body: JSON.stringify({ name: newName }) });
            showClientMsg(`Renamed to "${newName}".`, 'success');
            await loadClientsPanel();
            await loadRolesAndTeams();
        } catch (e) { showClientMsg(e.message, 'error'); }
    };

    input.addEventListener('keydown', async e => {
        if (e.key === 'Enter') { e.preventDefault(); await commit(); }
        if (e.key === 'Escape') { nameSpan.textContent = orig; }
    });
    input.addEventListener('blur', commit);
}

async function deleteClient(id, name) {
    if (!confirm(`Delete client "${name}"?\nEmployees assigned to this client will be unassigned.`)) return;
    try {
        await apiCall(`/admin/clients/${id}`, { method: 'DELETE' });
        showClientMsg(`Client "${name}" deleted.`, 'success');
        await loadClientsPanel();
        await loadRolesAndTeams();
    } catch (e) { showClientMsg(e.message, 'error'); }
}

function showClientMsg(text, type) {
    const el = document.getElementById('clientMsg');
    if (!el) return;
    el.textContent   = text;
    el.className     = `message ${type}`;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 4000);
}

// ── Bulk Upload ────────────────────────────────────────────────────

function openBulkModal() {
    _bulkParsed = [];
    document.getElementById('bulkPreview').style.display  = 'none';
    document.getElementById('bulkResults').style.display  = 'none';
    document.getElementById('bulkMsg').style.display      = 'none';
    document.getElementById('btnSubmitBulk').disabled     = true;
    document.getElementById('bulkFileInput').value        = '';
    document.getElementById('bulkDropLabel').innerHTML    = '<div style="font-size:28px;margin-bottom:8px;">📂</div>Click to choose XLSX file, or drag &amp; drop here';
    document.getElementById('bulkModal').style.display    = 'flex';
}

function closeBulkModal() {
    document.getElementById('bulkModal').style.display = 'none';
    loadUsers();
}

function downloadBulkSample() {
    const url = buildApiUrl('/admin/users/sample');
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bulk_users_sample.xlsx';
    document.body.appendChild(a);
    const headers = { Authorization: 'Bearer ' + getToken() };
    fetch(url, { headers })
        .then(r => r.blob())
        .then(blob => { a.href = URL.createObjectURL(blob); a.click(); document.body.removeChild(a); })
        .catch(() => { a.click(); document.body.removeChild(a); });
}

function handleBulkFile(file) {
    if (!file) return;
    const REQUIRED = ['Name','Email','Password','Role'];
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            if (typeof XLSX === 'undefined') throw new Error('XLSX library not loaded — check network.');
            const wb   = XLSX.read(new Uint8Array(e.target.result), { type:'array' });
            const ws   = wb.Sheets[wb.SheetNames[0]];
            _bulkParsed = XLSX.utils.sheet_to_json(ws, { defval: '' });

            if (!_bulkParsed.length) throw new Error('No data rows found in the file.');
            const missing = REQUIRED.filter(c => !(_bulkParsed[0].hasOwnProperty(c)));
            if (missing.length) throw new Error(`Missing required columns: ${missing.join(', ')}`);

            document.getElementById('bulkDropLabel').innerHTML = `<strong>${file.name}</strong> — ${_bulkParsed.length} rows ready`;
            renderBulkPreview();
            document.getElementById('bulkMsg').style.display = 'none';
            document.getElementById('bulkResults').style.display = 'none';
            document.getElementById('btnSubmitBulk').disabled = false;
        } catch (err) {
            _bulkParsed = [];
            document.getElementById('btnSubmitBulk').disabled = true;
            showBulkMsg(err.message, 'error');
        }
    };
    reader.readAsArrayBuffer(file);
}

function renderBulkPreview() {
    if (!_bulkParsed.length) return;
    const keys = Object.keys(_bulkParsed[0]);
    const headEl = document.getElementById('bulkPreviewHead');
    const bodyEl = document.getElementById('bulkPreviewBody');

    headEl.innerHTML = keys.map(k => `<th style="padding:7px 10px;text-align:left;border-bottom:1px solid #e5e7eb;white-space:nowrap;">${k}</th>`).join('');
    bodyEl.innerHTML = _bulkParsed.slice(0, 10).map(row =>
        `<tr>${keys.map(k => `<td style="padding:5px 10px;border-bottom:1px solid #f1f5f9;white-space:nowrap;">${row[k] || ''}</td>`).join('')}</tr>`
    ).join('');

    document.getElementById('bulkPreviewCount').textContent =
        `${_bulkParsed.length} row${_bulkParsed.length !== 1 ? 's' : ''} detected` +
        (_bulkParsed.length > 10 ? ' (showing first 10)' : '');
    document.getElementById('bulkPreview').style.display = 'block';
}

async function submitBulkUpload() {
    const btn = document.getElementById('btnSubmitBulk');
    const file = document.getElementById('bulkFileInput').files[0];
    if (!file) { showBulkMsg('Please select a file first.', 'error'); return; }

    btn.disabled = true;
    btn.textContent = 'Uploading…';
    document.getElementById('bulkResults').style.display = 'none';

    try {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(buildApiUrl('/admin/users/bulk'), {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + getToken() },
            body: formData,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);

        const tbody = document.getElementById('bulkResultsBody');
        tbody.innerHTML = (data.results || []).map(r => {
            const color = r.status === 'created' ? '#16a34a' : r.status === 'skipped' ? '#d97706' : '#dc2626';
            const icon  = r.status === 'created' ? '✓' : r.status === 'skipped' ? '—' : '✗';
            return `<tr>
                <td style="padding:5px 10px;border-bottom:1px solid #f1f5f9;">${r.name || '?'}</td>
                <td style="padding:5px 10px;border-bottom:1px solid #f1f5f9;color:${color};font-weight:700;">${icon} ${r.status}</td>
                <td style="padding:5px 10px;border-bottom:1px solid #f1f5f9;color:#6b7280;font-size:11px;">${r.message || ''}</td>
            </tr>`;
        }).join('');

        document.getElementById('bulkResultsSummary').textContent =
            `Done — ${data.created} created, ${data.total - data.created} skipped/failed out of ${data.total} rows.`;
        document.getElementById('bulkResults').style.display = 'block';
        document.getElementById('bulkPreview').style.display = 'none';
        showBulkMsg(`${data.created} user${data.created !== 1 ? 's' : ''} created successfully.`, 'success');
    } catch (err) {
        showBulkMsg(err.message, 'error');
        btn.disabled = false;
    }
    btn.textContent = 'Upload Users';
}

function showBulkMsg(text, type) {
    const el = document.getElementById('bulkMsg');
    el.textContent = text; el.className = `message ${type}`; el.style.display = 'block';
}

// ── Working Hours ──────────────────────────────────────────────────────────

let _whParsed = [];

function initWorkingHours() {
    document.getElementById('btnWhSample')?.addEventListener('click', downloadWhSample);
    document.getElementById('btnWhBulk')?.addEventListener('click', openWhBulkModal);
    document.getElementById('btnCancelWhBulk')?.addEventListener('click', closeWhBulkModal);
    document.getElementById('btnSubmitWhBulk')?.addEventListener('click', submitWhBulk);

    const dropZone  = document.getElementById('whBulkDropZone');
    const fileInput = document.getElementById('whBulkFileInput');
    dropZone?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', e => handleWhFile(e.target.files[0]));
    dropZone?.addEventListener('dragover', e => { e.preventDefault(); dropZone.style.borderColor = '#3b82f6'; });
    dropZone?.addEventListener('dragleave', () => { dropZone.style.borderColor = '#cbd5e1'; });
    dropZone?.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.style.borderColor = '#cbd5e1';
        handleWhFile(e.dataTransfer.files[0]);
    });
}

async function loadWorkingHours() {
    const tbody = document.getElementById('whTableBody');
    if (!tbody) return;
    try {
        const res  = await apiCall('/admin/working-hours');
        const rows = res.employees || [];
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No active employees.</td></tr>';
            return;
        }
        tbody.innerHTML = rows.map(e => {
            const start = e.ShiftStart || '';
            const end   = e.ShiftEnd   || '';
            const hrs   = calcHours(start, end);
            return `<tr>
                <td style="font-size:12px;color:#64748b;font-weight:600;">${e.EmployeeID}</td>
                <td><strong>${escapeHtml(e.Name)}</strong></td>
                <td>${escapeHtml(e.Role || '—')}</td>
                <td>${escapeHtml(e.TeamName || '—')}</td>
                <td>
                    <input type="time" class="form-control" style="max-width:110px;padding:4px 8px;font-size:13px;"
                        id="whStart-${e.EmployeeID}" value="${escapeHtml(start)}">
                </td>
                <td>
                    <input type="time" class="form-control" style="max-width:110px;padding:4px 8px;font-size:13px;"
                        id="whEnd-${e.EmployeeID}" value="${escapeHtml(end)}">
                </td>
                <td id="whHrs-${e.EmployeeID}" style="font-size:13px;color:#64748b;">${hrs}</td>
                <td>
                    <button type="button" class="admin-link-btn" data-save-wh="${e.EmployeeID}">Save</button>
                </td>
            </tr>`;
        }).join('');

        tbody.querySelectorAll('[data-save-wh]').forEach(btn => {
            btn.addEventListener('click', () => saveWorkingHours(parseInt(btn.dataset.saveWh, 10)));
        });

        // Live-update hours/day label as user types
        rows.forEach(e => {
            const startEl = document.getElementById(`whStart-${e.EmployeeID}`);
            const endEl   = document.getElementById(`whEnd-${e.EmployeeID}`);
            const hrsEl   = document.getElementById(`whHrs-${e.EmployeeID}`);
            const update  = () => { if (hrsEl) hrsEl.textContent = calcHours(startEl?.value, endEl?.value); };
            startEl?.addEventListener('change', update);
            endEl?.addEventListener('change', update);
        });
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center" style="color:#dc2626;">${escapeHtml(e.message)}</td></tr>`;
    }
}

function calcHours(start, end) {
    if (!start || !end) return '—';
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins <= 0) return '—';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
}

async function saveWorkingHours(empId) {
    const start = document.getElementById(`whStart-${empId}`)?.value || '';
    const end   = document.getElementById(`whEnd-${empId}`)?.value   || '';
    try {
        await apiCall(`/admin/working-hours/${empId}`, {
            method: 'PUT',
            body: JSON.stringify({ shiftStart: start || null, shiftEnd: end || null }),
        });
        showWhMsg('Hours saved.', 'success');
    } catch (e) {
        showWhMsg(e.message, 'error');
    }
}

function downloadWhSample() {
    const url = buildApiUrl('/admin/working-hours/sample');
    fetch(url, { headers: { Authorization: 'Bearer ' + getToken() } })
        .then(r => r.blob())
        .then(blob => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'working_hours_sample.xlsx';
            a.click();
            URL.revokeObjectURL(a.href);
        })
        .catch(() => showWhMsg('Download failed.', 'error'));
}

function openWhBulkModal() {
    _whParsed = [];
    document.getElementById('whBulkDropLabel').innerHTML = '<div style="font-size:28px;margin-bottom:8px;">📂</div>Click to choose XLSX file, or drag &amp; drop here';
    document.getElementById('whBulkPreview').style.display  = 'none';
    document.getElementById('whBulkResults').style.display  = 'none';
    document.getElementById('whBulkMsg').style.display      = 'none';
    document.getElementById('btnSubmitWhBulk').disabled     = true;
    document.getElementById('whBulkFileInput').value        = '';
    document.getElementById('whBulkModal').style.display    = 'flex';
}

function closeWhBulkModal() {
    document.getElementById('whBulkModal').style.display = 'none';
    loadWorkingHours();
}

function handleWhFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            if (typeof XLSX === 'undefined') throw new Error('XLSX library not loaded.');
            const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            _whParsed = XLSX.utils.sheet_to_json(ws, { defval: '' });
            if (!_whParsed.length) throw new Error('No data rows found.');
            const hasId = _whParsed[0].hasOwnProperty('EmployeeID') || _whParsed[0].hasOwnProperty('employeeId') || _whParsed[0].hasOwnProperty('Employee ID');
            if (!hasId) throw new Error('Missing required column: EmployeeID');

            document.getElementById('whBulkDropLabel').innerHTML = `<strong>${file.name}</strong> — ${_whParsed.length} rows ready`;

            // Preview
            const keys = Object.keys(_whParsed[0]);
            document.getElementById('whBulkPreviewHead').innerHTML =
                keys.map(k => `<th style="padding:7px 10px;border-bottom:1px solid #e5e7eb;">${k}</th>`).join('');
            document.getElementById('whBulkPreviewBody').innerHTML =
                _whParsed.slice(0, 8).map(row =>
                    `<tr>${keys.map(k => `<td style="padding:5px 10px;border-bottom:1px solid #f1f5f9;">${row[k] || ''}</td>`).join('')}</tr>`
                ).join('');
            document.getElementById('whBulkPreviewCount').textContent =
                `${_whParsed.length} row${_whParsed.length !== 1 ? 's' : ''} detected` +
                (_whParsed.length > 8 ? ' (showing first 8)' : '');

            document.getElementById('whBulkPreview').style.display  = 'block';
            document.getElementById('whBulkResults').style.display  = 'none';
            document.getElementById('whBulkMsg').style.display      = 'none';
            document.getElementById('btnSubmitWhBulk').disabled     = false;
        } catch (err) {
            _whParsed = [];
            document.getElementById('btnSubmitWhBulk').disabled = true;
            showWhBulkMsg(err.message, 'error');
        }
    };
    reader.readAsArrayBuffer(file);
}

async function submitWhBulk() {
    const btn  = document.getElementById('btnSubmitWhBulk');
    const file = document.getElementById('whBulkFileInput').files[0];
    if (!file) { showWhBulkMsg('Please select a file first.', 'error'); return; }

    btn.disabled = true;
    btn.textContent = 'Uploading…';
    document.getElementById('whBulkResults').style.display = 'none';

    try {
        const fd = new FormData();
        fd.append('file', file);
        const res  = await fetch(buildApiUrl('/admin/working-hours/bulk'), {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + getToken() },
            body: fd,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);

        const tbody = document.getElementById('whBulkResultsBody');
        tbody.innerHTML = (data.results || []).map(r => {
            const color = r.status === 'updated' ? '#16a34a' : '#d97706';
            const icon  = r.status === 'updated' ? '✓' : '—';
            return `<tr>
                <td style="padding:5px 10px;border-bottom:1px solid #f1f5f9;">${escapeHtml(r.name || '?')}</td>
                <td style="padding:5px 10px;border-bottom:1px solid #f1f5f9;color:${color};font-weight:700;">${icon} ${r.status}</td>
                <td style="padding:5px 10px;border-bottom:1px solid #f1f5f9;color:#6b7280;font-size:11px;">${escapeHtml(r.message || '')}</td>
            </tr>`;
        }).join('');
        document.getElementById('whBulkResultsSummary').textContent =
            `Done — ${data.updated} updated out of ${data.total} rows.`;
        document.getElementById('whBulkResults').style.display = 'block';
        document.getElementById('whBulkPreview').style.display = 'none';
        showWhBulkMsg(`${data.updated} record${data.updated !== 1 ? 's' : ''} updated.`, 'success');
    } catch (err) {
        showWhBulkMsg(err.message, 'error');
        btn.disabled = false;
    }
    btn.textContent = 'Upload';
}

function showWhMsg(text, type) {
    const el = document.getElementById('whMsg');
    if (!el) return;
    el.textContent = text; el.className = `message ${type}`; el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 4000);
}

function showWhBulkMsg(text, type) {
    const el = document.getElementById('whBulkMsg');
    el.textContent = text; el.className = `message ${type}`; el.style.display = 'block';
}

// ── Manager / TeamLead Team Assignments ──────────────────────────────────────

function initManagerTeams() {
    const empSelect = document.getElementById('mtEmpSelect');
    const loadBtn   = document.getElementById('mtLoadBtn');
    const saveBtn   = document.getElementById('mtSaveBtn');
    const panel     = document.getElementById('mtPanel');
    if (!empSelect || !loadBtn) return;

    // Populate the dropdown with Managers and TeamLeads
    populateMtEmpSelect(empSelect);

    loadBtn.addEventListener('click', async () => {
        const managerId = empSelect.value;
        if (!managerId) { showMtMsg('Select a Manager or Team Lead first.', 'error'); return; }
        await loadManagerTeams(managerId, panel);
    });

    saveBtn?.addEventListener('click', async () => {
        const managerId = empSelect.value;
        if (!managerId) return;
        const checked = Array.from(
            document.querySelectorAll('#mtTeamCheckboxes input[type="checkbox"]:checked')
        ).map(cb => parseInt(cb.value, 10));
        await saveManagerTeams(managerId, checked);
    });
}

async function populateMtEmpSelect(empSelect) {
    try {
        const res = await apiCall('/employees');
        const employees = (res?.employees || res || []).filter(
            e => e.Role === 'Manager' || e.Role === 'TeamLead'
        );
        employees.forEach(e => {
            const opt = document.createElement('option');
            opt.value = e.EmployeeID;
            opt.textContent = `${e.Name} (${e.Role})`;
            empSelect.appendChild(opt);
        });
    } catch (err) {
        console.warn('Could not load employees for team assignment:', err.message);
    }
}

async function loadManagerTeams(managerId, panel) {
    const container = document.getElementById('mtTeamCheckboxes');
    container.innerHTML = '<span style="color:#64748b;font-size:13px;">Loading…</span>';
    panel.style.display = 'block';
    showMtMsg('', '');

    try {
        const [teamsRes, assignedRes] = await Promise.all([
            apiCall('/teams'),
            apiCall(`/admin/manager-teams/${managerId}`),
        ]);

        const allTeams   = teamsRes?.teams    || [];
        const assignedIds = new Set((assignedRes?.teamIds || []).map(Number));

        if (!allTeams.length) {
            container.innerHTML = '<span style="color:#94a3b8;font-size:13px;">No teams found.</span>';
            return;
        }

        container.innerHTML = allTeams.map(t => {
            const checked = assignedIds.has(t.TeamID) ? 'checked' : '';
            return `<label style="display:flex;align-items:center;gap:6px;padding:6px 12px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-size:13px;background:${checked ? '#f0fdf4' : '#f8fafc'};">
                <input type="checkbox" value="${t.TeamID}" ${checked} style="accent-color:#16a34a;">
                ${escapeHtml(t.TeamName)}
            </label>`;
        }).join('');
    } catch (err) {
        container.innerHTML = '';
        showMtMsg(err.message || 'Failed to load teams.', 'error');
    }
}

async function saveManagerTeams(managerId, teamIds) {
    const saveBtn = document.getElementById('mtSaveBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    showMtMsg('', '');

    try {
        await apiCall(`/admin/manager-teams/${managerId}`, {
            method: 'PUT',
            body: JSON.stringify({ teamIds }),
        });
        showMtMsg('Team assignments saved.', 'success');
    } catch (err) {
        showMtMsg(err.message || 'Failed to save assignments.', 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Assignments';
    }
}

function showMtMsg(text, type) {
    const el = document.getElementById('mtMsg');
    if (!el) return;
    el.textContent = text;
    el.className = type === 'success' ? 'message success' : type === 'error' ? 'message error' : '';
    el.style.display = text ? 'inline' : 'none';
}
